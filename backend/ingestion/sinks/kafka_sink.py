"""
Stage 2 Kafka Producer Sink & Stage 1 Daily Rolling JSONL Sink.
Decouples scraping from downstream Spark Structured Streaming & Lakehouse ELT.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from backend.app.core.config import settings

logger = logging.getLogger("bigwarn.kafka_sink")


class KafkaArticleSink:
    """Publishes scraped raw article payloads to Apache Kafka (`bigwarn.raw.news`).
    Gracefully degrades to no-op when Kafka is disabled or unreachable."""

    def __init__(self, bootstrap_servers: str | None = None, topic: str | None = None):
        self.bootstrap_servers = bootstrap_servers or settings.kafka_bootstrap_servers
        self.topic = topic or settings.kafka_raw_topic
        self.enabled = settings.kafka_enabled
        self._producer = None
        if self.enabled:
            self._init_producer()

    def _init_producer(self) -> None:
        try:
            from kafka import KafkaProducer  # type: ignore
            self._producer = KafkaProducer(
                bootstrap_servers=self.bootstrap_servers.split(","),
                value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
                key_serializer=lambda k: k.encode("utf-8") if k else None,
                acks="all",
                retries=3,
            )
            logger.info("Connected Kafka producer to %s (topic=%s)", self.bootstrap_servers, self.topic)
        except Exception as exc:
            logger.warning("Kafka producer unavailable (%s); continuing with local JSONL sink only.", exc)
            self._producer = None

    def publish(self, key: str, payload: dict[str, Any]) -> bool:
        if not self._producer:
            return False
        try:
            self._producer.send(self.topic, key=key, value=payload)
            return True
        except Exception as exc:
            logger.warning("Failed to publish article %s to Kafka: %s", key, exc)
            return False

    def close(self) -> None:
        if self._producer:
            try:
                self._producer.flush(timeout=5)
                self._producer.close()
            except Exception:
                pass

