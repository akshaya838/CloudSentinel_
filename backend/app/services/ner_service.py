from app.services.model_loader import get_nlp


def extract_entities(text: str) -> list[dict]:
    from ml.ner.ner_pipeline import extract_entities as _extract
    return _extract(get_nlp(), text)
