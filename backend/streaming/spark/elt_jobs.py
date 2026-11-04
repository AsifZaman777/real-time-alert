"""
Stage 3 & 4: Apache Spark Structured Streaming & Medallion Lakehouse Schemas and Jobs.
Implements the Bronze -> Silver -> Gold ELT pipeline defined in the BigWarn proposal.
"""
from __future__ import annotations

from pathlib import Path
from backend.app.core.config import settings


def get_spark_session(app_name: str = "BigWarn-Lakehouse-ELT"):
    """Creates or retrieves a SparkSession configured for Delta Lake / Parquet."""
    from pyspark.sql import SparkSession  # type: ignore

    return (
        SparkSession.builder.appName(app_name)
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        .config("spark.sql.shuffle.partitions", "8")
        .getOrCreate()
    )


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

