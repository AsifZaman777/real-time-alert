"""
Stage 3 & 4: Apache Spark Structured Streaming & Medallion Lakehouse Schemas and Jobs.
Implements the Bronze -> Silver -> Gold ELT pipeline defined in the BigWarn proposal.
"""
from __future__ import annotations

from pathlib import Path
from backend.app.core.config import settings


def get_spark_session(app_name: str = "BigWarn-Lakehouse-ELT"):
    """Creates or retrieves a SparkSession configured for Delta Lake / Parquet on Cloud (Azure ADLS Gen2 / S3 / R2) or Local."""
    from pyspark.sql import SparkSession  # type: ignore

    builder = (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        .config("spark.sql.shuffle.partitions", "8")
    )

    if settings.cloud_lakehouse_provider == "azure_adls" and settings.azure_storage_account and settings.azure_storage_key:
        builder = builder.config(
            f"spark.hadoop.fs.azure.account.key.{settings.azure_storage_account}.dfs.core.windows.net",
            settings.azure_storage_key,
        )
    elif settings.cloud_lakehouse_provider in ("s3", "s3_r2", "cloudflare_r2", "minio") and settings.aws_access_key_id:
        builder = (
            builder.config("spark.hadoop.fs.s3a.access.key", settings.aws_access_key_id)
            .config("spark.hadoop.fs.s3a.secret.key", settings.aws_secret_access_key)
            .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
            .config("spark.hadoop.fs.s3a.path.style.access", "true")
        )
        if settings.s3_endpoint_url:
            builder = builder.config("spark.hadoop.fs.s3a.endpoint", settings.s3_endpoint_url)

    return builder.getOrCreate()


def get_bronze_schema():
    """Returns the PySpark StructType for raw news ingestion (Bronze layer)."""
    from pyspark.sql.types import (  # type: ignore
        ArrayType,
        BooleanType,
        IntegerType,
        StringType,
        StructField,
        StructType,
    )

    return StructType(
        [
            StructField("event", StringType(), True),
            StructField("ingested_at", StringType(), True),
            StructField("source", StringType(), True),
            StructField("site_key", StringType(), True),
            StructField("lang", StringType(), True),
            StructField("url", StringType(), True),
            StructField("headline", StringType(), True),
            StructField("description", StringType(), True),
            StructField("body", StringType(), True),
            StructField("word_count", IntegerType(), True),
            StructField("keywords", ArrayType(StringType()), True),
            StructField("author", StringType(), True),
            StructField("section", StringType(), True),
            StructField("published", StringType(), True),
            StructField("updated", StringType(), True),
            StructField("duplicate_of", StringType(), True),
            StructField("is_disruption", BooleanType(), True),
            StructField("event_types", ArrayType(StringType()), True),
            StructField("locations", ArrayType(StringType()), True),
            StructField("time_windows", ArrayType(StringType()), True),
        ]
    )


def run_bronze_stream_job(
    bronze_out: Path = settings.bronze_path,
    checkpoint_dir: Path = settings.checkpoint_path / "bronze",
) -> None:
    """Stage 2 -> 4 (E & L): Streams raw articles from Kafka or JSONL directory into Bronze Parquet/Delta."""
    from pyspark.sql.functions import col, to_date, to_timestamp  # type: ignore

    spark = get_spark_session("BigWarn-Bronze-Loader")
    schema = get_bronze_schema()

    df_raw = (
        spark.readStream.schema(schema)
        .option("maxFilesPerTrigger", 10)
        .json(str(settings.logs_dir / "news_stream_*.jsonl"))
    )

    df_bronze = (
        df_raw.withColumn("ingested_ts", to_timestamp(col("ingested_at")))
        .withColumn("published_ts", to_timestamp(col("published")))
        .withColumn("date_partition", to_date(col("ingested_ts")))
    )

    query = (
        df_bronze.writeStream.format("parquet")
        .outputMode("append")
        .partitionBy("date_partition", "lang")
        .option("checkpointLocation", str(checkpoint_dir))
        .start(str(bronze_out))
    )
    query.awaitTermination()


def run_silver_elt_job(
    bronze_in: Path = settings.bronze_path,
    silver_out: Path = settings.silver_path,
) -> None:
    """Stage 3 (T - Filter & Enrich): Reads Bronze, filters disruption events, deduplicates,
    and enriches with OpenStreetMap area coordinates."""
    from pyspark.sql.functions import (  # type: ignore
        col,
        create_map,
        element_at,
        lit,
        lower,
        regexp_replace,
        size,
        substring,
        trim,
    )
    from pyspark.sql.types import StructField, StructType, DoubleType, StringType  # type: ignore
    from itertools import chain
    from backend.ingestion.enrichment.taxonomy import AREA_METADATA

    spark = get_spark_session("BigWarn-Silver-ELT")
    df_bronze = spark.read.parquet(str(bronze_in))

    # Filter only disruption-relevant records
    df_filtered = df_bronze.filter((col("is_disruption") == True) | (size(col("event_types")) > 0))  # noqa: E712

    # Deduplicate on normalized headline key
    df_dedup = df_filtered.withColumn(
        "headline_norm",
        substring(trim(regexp_replace(lower(col("headline")), r"[^\w]+", " ")), 1, 65),
    ).dropDuplicates(["date_partition", "headline_norm", "source"])

    # Assign primary area and map OpenStreetMap (lat, lon, city)
    df_with_area = df_dedup.withColumn(
        "primary_area",
        element_at(col("locations"), 1),
    )

    lat_map = create_map(*list(chain.from_iterable((lit(k), lit(float(v["lat"]))) for k, v in AREA_METADATA.items())))
    lon_map = create_map(*list(chain.from_iterable((lit(k), lit(float(v["lon"]))) for k, v in AREA_METADATA.items())))
    city_map = create_map(*list(chain.from_iterable((lit(k), lit(str(v["city"]))) for k, v in AREA_METADATA.items())))

    df_silver = (
        df_with_area.withColumn("lat", lat_map[col("primary_area")])
        .withColumn("lon", lon_map[col("primary_area")])
        .withColumn("city", city_map[col("primary_area")])
    )

    df_silver.write.mode("overwrite").partitionBy("date_partition").parquet(str(silver_out))


def run_gold_elt_job(
    silver_in: Path = settings.silver_path,
    gold_out: Path = settings.gold_path,
) -> None:
    """Stage 3 & 4 (Gold Veracity Scoring): Aggregates Silver disruptions by (date, area, event_type),
    computes multi-source corroboration & veracity score, and writes Gold area alerts."""
    from pyspark.sql.functions import (  # type: ignore
        collect_set,
        col,
        countDistinct,
        explode,
        first,
        least,
        lit,
        max as spark_max,
        min as spark_min,
        round as spark_round,
        struct,
        collect_list,
        when,
    )

    spark = get_spark_session("BigWarn-Gold-Veracity-ELT")
    df_silver = spark.read.parquet(str(silver_in))

    df_exploded = (
        df_silver.withColumn("area", explode(col("locations")))
        .withColumn("event_type", explode(col("event_types")))
    )

    df_grouped = df_exploded.groupBy("date_partition", "area", "event_type").agg(
        first("city").alias("city"),
        first("lat").alias("lat"),
        first("lon").alias("lon"),
        countDistinct("source").alias("source_count"),
        countDistinct("lang").alias("lang_count"),
        collect_set("source").alias("sources"),
        collect_set("lang").alias("languages"),
        spark_min("published").alias("first_reported"),
        spark_max("updated").alias("last_updated"),
        collect_list(struct("headline", "source", "lang", "url", "published")).alias("articles"),
    )

    # Veracity / Credibility score: 0.45 + 0.18 * source_count + 0.08 if bilingual
    df_gold = df_grouped.withColumn(
        "credibility_score",
        least(
            lit(0.99),
            spark_round(
                lit(0.45) + lit(0.18) * col("source_count") + when(col("lang_count") > 1, lit(0.08)).otherwise(lit(0.0)),
                2,
            ),
        ),
    ).withColumn(
        "veracity_status",
        when(col("source_count") >= 3, lit("VERIFIED (Multi-Source)"))
        .when(col("source_count") == 2, lit("CONFIRMED"))
        .otherwise(lit("UNCONFIRMED (Single Source)")),
    )

    df_gold.write.mode("overwrite").partitionBy("date_partition").parquet(str(gold_out))


def run_batch_medallion_elt() -> None:
    """Runs the full Bronze -> Silver -> Gold Spark batch ELT pipeline."""
    from pyspark.sql.functions import col, to_date, to_timestamp  # type: ignore

    spark = get_spark_session("BigWarn-Full-Medallion-ELT")
    schema = get_bronze_schema()
    df_raw = spark.read.schema(schema).json(str(settings.logs_dir / "news_stream_*.jsonl"))
    df_bronze = (
        df_raw.withColumn("ingested_ts", to_timestamp(col("ingested_at")))
        .withColumn("published_ts", to_timestamp(col("published")))
        .withColumn("date_partition", to_date(col("ingested_ts")))
    )
    df_bronze.write.mode("overwrite").partitionBy("date_partition", "lang").parquet(str(settings.bronze_path))
    run_silver_elt_job()
    run_gold_elt_job()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="BigWarn Spark Medallion ELT Pipeline")
    parser.add_argument("--stage", choices=["bronze", "silver", "gold", "batch"], default="batch")
    args = parser.parse_args()
    if args.stage == "bronze":
        run_bronze_stream_job()
    elif args.stage == "silver":
        run_silver_elt_job()
    elif args.stage == "gold":
        run_gold_elt_job()
    else:
        run_batch_medallion_elt()

