from app.core.config import settings


def get_topics(k: int = 5) -> dict:
    from ml.topic_modeling.topic_model import run_topic_modeling
    if not settings.DATA_PROCESSED.exists():
        raise FileNotFoundError("Run ml.etl.etl_pipeline first")
    return run_topic_modeling(str(settings.DATA_PROCESSED), k)
