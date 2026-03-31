"""
Rhizomatic Processor Service

NLP processing worker that consumes jobs from the Redis queue.
Pipeline: receive content → chunk text → run NER → extract relationships
         → resolve entities → return structured results.

Each stage is a pure function. The service is a thin wrapper
connecting the queue to the pipeline.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import redis

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types (mirror @rhizomatic/common types)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExtractedEntity:
    """A raw extracted entity before resolution."""
    surface_form: str
    canonical_name: str
    kind: str
    confidence: float


@dataclass(frozen=True)
class ExtractedTriple:
    """An entity-relationship triple extracted from text."""
    subject: ExtractedEntity
    predicate: str
    object: ExtractedEntity
    confidence: float
    source_chunk_id: str


@dataclass(frozen=True)
class ProcessedChunk:
    """A chunk with extracted entities."""
    content: str
    position: int
    heading: str | None
    entities: list[ExtractedEntity] = field(default_factory=list)
    embedding_id: str | None = None


@dataclass(frozen=True)
class ProcessingResult:
    """Complete result of processing a document."""
    job_id: str
    document_id: str
    chunks: list[ProcessedChunk]
    entities: list[ExtractedEntity]
    triples: list[ExtractedTriple]


# ---------------------------------------------------------------------------
# Pipeline stages (pure functions)
# ---------------------------------------------------------------------------


def chunk_text(text: str, max_chunk_size: int = 1000) -> list[dict[str, Any]]:
    """
    Split text into semantically coherent chunks.
    Breaks at paragraph boundaries, not arbitrary character positions.
    """
    paragraphs = text.split("\n\n")
    chunks: list[dict[str, Any]] = []
    current_chunk = ""
    current_heading: str | None = None
    position = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Detect headings (simple heuristic: short lines without periods)
        if len(para) < 80 and "." not in para:
            current_heading = para

        if len(current_chunk) + len(para) > max_chunk_size and current_chunk:
            chunks.append({
                "content": current_chunk.strip(),
                "position": position,
                "heading": current_heading,
            })
            position += 1
            current_chunk = para + "\n\n"
        else:
            current_chunk += para + "\n\n"

    if current_chunk.strip():
        chunks.append({
            "content": current_chunk.strip(),
            "position": position,
            "heading": current_heading,
        })

    return chunks


def extract_entities(text: str) -> list[ExtractedEntity]:
    """
    Extract named entities from text using spaCy.
    Falls back to simple heuristics if spaCy is not available.
    """
    try:
        import spacy
        nlp = spacy.load("en_core_web_sm")
        doc = nlp(text)

        entities = []
        for ent in doc.ents:
            kind_map = {
                "PERSON": "person",
                "ORG": "organization",
                "GPE": "place",
                "LOC": "place",
                "PRODUCT": "technology",
                "WORK_OF_ART": "concept",
                "EVENT": "event",
                "LAW": "concept",
                "LANGUAGE": "technology",
            }
            kind = kind_map.get(ent.label_, "concept")
            entities.append(ExtractedEntity(
                surface_form=ent.text,
                canonical_name=ent.text.strip().title(),
                kind=kind,
                confidence=0.8,
            ))

        return entities

    except (ImportError, OSError):
        logger.warning("spaCy not available, using fallback entity extraction")
        return []


def extract_relationships(
    entities: list[ExtractedEntity],
    chunk_id: str,
) -> list[ExtractedTriple]:
    """
    Extract relationships between co-occurring entities.
    Basic approach: entities in the same chunk are co-occurring.
    """
    triples: list[ExtractedTriple] = []

    for i, subj in enumerate(entities):
        for obj in entities[i + 1 :]:
            if subj.canonical_name != obj.canonical_name:
                triples.append(ExtractedTriple(
                    subject=subj,
                    predicate="RELATED_TO",
                    object=obj,
                    confidence=0.6,
                    source_chunk_id=chunk_id,
                ))

    return triples


# ---------------------------------------------------------------------------
# Worker (queue consumer)
# ---------------------------------------------------------------------------


def process_job(job_data: dict[str, Any]) -> ProcessingResult:
    """Process a single job from the queue."""
    document_id = job_data["documentId"]
    job_id = job_data["id"]
    content = job_data["content"]
    text = content.get("text", "")

    # Stage 1: Chunk
    raw_chunks = chunk_text(text)

    # Stage 2: Extract entities from each chunk
    all_entities: list[ExtractedEntity] = []
    all_triples: list[ExtractedTriple] = []
    processed_chunks: list[ProcessedChunk] = []

    for chunk_data in raw_chunks:
        chunk_id = f"{document_id}_chunk_{chunk_data['position']}"
        entities = extract_entities(chunk_data["content"])
        triples = extract_relationships(entities, chunk_id)

        all_entities.extend(entities)
        all_triples.extend(triples)

        processed_chunks.append(ProcessedChunk(
            content=chunk_data["content"],
            position=chunk_data["position"],
            heading=chunk_data.get("heading"),
            entities=entities,
        ))

    return ProcessingResult(
        job_id=job_id,
        document_id=document_id,
        chunks=processed_chunks,
        entities=all_entities,
        triples=all_triples,
    )


def run_worker(redis_url: str = "redis://localhost:6379") -> None:
    """Main worker loop — consume jobs from the Redis queue."""
    logger.info(f"Processor worker starting, connecting to {redis_url}")
    # TODO: Implement BullMQ-compatible job consumption
    # For now, this is a placeholder for the worker loop
    logger.info("Processor worker ready (waiting for jobs)")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
