"""
Structured logging setup. Phase 1: console logging with request context.
Phase 2+: route this to a file/aggregator and add audit-log persistence.
"""

import logging
import sys


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        stream=sys.stdout,
    )
    # Quiet noisy third-party loggers so API logs stay readable
    for noisy in ("httpx", "chromadb", "sentence_transformers"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


logger = logging.getLogger("cve_intelligence")
