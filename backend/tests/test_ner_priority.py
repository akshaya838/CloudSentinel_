"""
Regression tests for a bug found while preparing the demo: spaCy's statistical model sometimes tagged
a CVE or CWE ID as PERSON / ORG / GPE, and that label beat the exact regex label (so "CVE-2021-44228"
showed up as a person, and a CWE written that way was missed by the business-impact lookup).
The Phase I gold set had no CVE/CWE examples, so the scores never covered this.
"""
import pytest

pytest.importorskip("spacy")

from ml.classification.severity_classifier import tag_business_impact  # noqa: E402
from ml.ner.ner_pipeline import build_pipeline, extract_entities  # noqa: E402

SENTENCE = ("CVE-2021-44228 in Apache Log4j2 allows remote code execution through deserialization, "
            "related to CWE-502 and CWE-20. See also CVE-2024-3094 in XZ Utils.")


@pytest.fixture(scope="module")
def nlp():
    try:
        return build_pipeline()
    except SystemExit:
        pytest.skip("spaCy model en_core_web_sm is not installed")


def tagged(nlp, text):
    return {e["text"]: e["label"] for e in extract_entities(nlp, text)}


def test_ids_are_tagged_as_ids_never_as_people_or_places(nlp):
    got = tagged(nlp, SENTENCE)
    assert got["CVE-2021-44228"] == "CVE_ID"
    assert got["CVE-2024-3094"] == "CVE_ID"
    assert got["CWE-502"] == "CWE_ID"
    assert got["CWE-20"] == "CWE_ID"


@pytest.mark.parametrize("identifier,label", [
    ("CVE-2014-0160", "CVE_ID"), ("CVE-2016-5195", "CVE_ID"), ("CVE-2021-34527", "CVE_ID"),
    ("CVE-2023-4863", "CVE_ID"), ("CWE-787", "CWE_ID"), ("CWE-269", "CWE_ID"), ("CWE-89", "CWE_ID"),
])
@pytest.mark.parametrize("template", [
    "Details are in {x}.", "The flaw, tracked as {x}, was patched.", "{x} affects several vendors.",
    "Please review {x} and {x} again.",
])
def test_an_id_is_recognised_whatever_the_sentence_around_it(nlp, identifier, label, template):
    got = tagged(nlp, template.format(x=identifier))
    assert got[identifier] == label


def test_entities_never_overlap(nlp):
    ents = extract_entities(nlp, SENTENCE)
    for a, b in zip(ents, ents[1:]):
        assert a["end"] <= b["start"]


def test_spacy_entities_that_do_not_touch_an_id_are_kept(nlp):
    got = tagged(nlp, "Microsoft released a patch for CVE-2021-34527 last week.")
    assert got["Microsoft"] == "ORG"
    assert got["CVE-2021-34527"] == "CVE_ID"


def test_custom_product_and_attack_labels_still_work(nlp):
    got = tagged(nlp, SENTENCE)
    assert got["Apache Log4j2"] == "VENDOR_PRODUCT"
    assert got["remote code execution"] == "ATTACK_VECTOR"
    assert got["XZ Utils"] == "VENDOR_PRODUCT"


def test_classification_endpoint_uses_the_cwe_ids_in_the_text(client, tokens):
    r = client.post("/api/v1/classification", headers=tokens["analyst"], json={"text": SENTENCE})
    assert r.status_code == 200
    data = r.json()["data"]
    assert {e["text"] for e in data["entities"] if e["label"] == "CWE_ID"} == {"CWE-502", "CWE-20"}
    assert data["business_impact"] == tag_business_impact(["CWE-502", "CWE-20"])
    assert data["business_impact"] != ["Unclassified"]
