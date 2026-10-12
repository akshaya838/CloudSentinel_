from app.services.model_loader import get_translator


def translate(text: str, target_lang: str, source_lang: str | None = None) -> dict:
    return get_translator().translate(text, target_lang=target_lang, source_lang=source_lang)
