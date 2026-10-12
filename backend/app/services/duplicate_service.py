from app.core.config import settings


def find_duplicates(threshold: float = 0.85) -> dict:
    from ml.similarity.duplicate_detection import run_duplicate_detection
    if not settings.DATA_PROCESSED.exists():
        raise FileNotFoundError("Run ml.etl.etl_pipeline first")
    return run_duplicate_detection(str(settings.DATA_PROCESSED), threshold)
