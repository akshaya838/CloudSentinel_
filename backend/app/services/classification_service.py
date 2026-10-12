from app.services.model_loader import get_classifier
from app.services.ner_service import extract_entities


def classify_text(text: str) -> dict:
    from ml.classification.severity_classifier import explain_prediction, tag_business_impact

    pipeline = get_classifier()
    entities = extract_entities(text)
    cwe_ids = [e["text"] for e in entities if e["label"] == "CWE_ID"]

    prediction = explain_prediction(pipeline, text)
    business_impact = tag_business_impact(cwe_ids) if cwe_ids else ["Unclassified"]

    return {
        "text": text,
        "entities": entities,
        "severity_prediction": prediction,
        "business_impact": business_impact,
    }
