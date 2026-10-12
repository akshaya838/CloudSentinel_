def link_entities(text: str) -> dict:
    from ml.entity_linking.link_entities import link_entities_in_text
    return link_entities_in_text(text)
