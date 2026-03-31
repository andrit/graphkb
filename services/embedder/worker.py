"""
Rhizomatic Embedder Service

Generates dense vector embeddings using sentence-transformers.
Separate service because embedding models are memory-intensive
and benefit from GPU acceleration.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "all-MiniLM-L6-v2"


@dataclass(frozen=True)
class EmbeddingResult:
    """A text chunk with its computed embedding."""
    chunk_id: str
    embedding: list[float]
    dimensions: int


def load_model(model_name: str = DEFAULT_MODEL):
    """Load the sentence-transformers model."""
    try:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading embedding model: {model_name}")
        return SentenceTransformer(model_name)
    except ImportError:
        logger.error("sentence-transformers not installed")
        raise


def embed_texts(
    texts: list[str],
    chunk_ids: list[str],
    model_name: str = DEFAULT_MODEL,
) -> list[EmbeddingResult]:
    """Generate embeddings for a batch of text chunks."""
    model = load_model(model_name)
    embeddings = model.encode(texts, show_progress_bar=False)

    return [
        EmbeddingResult(
            chunk_id=chunk_id,
            embedding=embedding.tolist(),
            dimensions=len(embedding),
        )
        for chunk_id, embedding in zip(chunk_ids, embeddings)
    ]


def run_worker(redis_url: str = "redis://localhost:6379") -> None:
    """Main worker loop — consume embedding jobs from Redis queue."""
    logger.info(f"Embedder worker starting, connecting to {redis_url}")
    logger.info("Embedder worker ready (waiting for jobs)")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
