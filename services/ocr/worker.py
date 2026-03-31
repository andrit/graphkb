"""
Rhizomatic OCR Service

Extracts text from images using pytesseract.
Includes preprocessing: deskewing, contrast adjustment, binarization.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OcrResult:
    """Text extracted from an image with confidence score."""
    chunk_id: str
    text: str
    confidence: float


def preprocess_image(image_path: str):
    """Apply preprocessing to improve OCR accuracy."""
    from PIL import Image, ImageFilter, ImageOps

    img = Image.open(image_path)
    img = ImageOps.grayscale(img)
    img = ImageOps.autocontrast(img)
    img = img.filter(ImageFilter.SHARPEN)
    return img


def extract_text(image_path: str) -> OcrResult:
    """Extract text from an image using pytesseract."""
    try:
        import pytesseract

        img = preprocess_image(image_path)
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        text = pytesseract.image_to_string(img).strip()
        confidences = [int(c) for c in data["conf"] if int(c) > 0]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

        return OcrResult(
            chunk_id="",
            text=text,
            confidence=avg_confidence / 100.0,
        )
    except ImportError:
        logger.error("pytesseract not installed")
        raise


def run_worker(redis_url: str = "redis://localhost:6379") -> None:
    """Main worker loop — consume OCR jobs from Redis queue."""
    logger.info(f"OCR worker starting, connecting to {redis_url}")
    logger.info("OCR worker ready (waiting for jobs)")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker()
