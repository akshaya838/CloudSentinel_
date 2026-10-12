from app.core.config import settings


def summarize(severity: str | None = None, top_n: int = 5) -> dict:
    from ml.summarization.summarize import run_summarization
    if not settings.DATA_PROCESSED.exists():
        raise FileNotFoundError("Run ml.etl.etl_pipeline first")
    return run_summarization(str(settings.DATA_PROCESSED), severity, top_n)
