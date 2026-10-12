"""
Feature endpoint tests against the REAL 38-CVE dataset and real NER/classifier/linking code
(no mocks). Every request is authenticated, as in production.
Endpoints needing the ChromaDB index, Ollama or Hugging Face are only checked for
*correct degradation* when those are unavailable (structured 503, never a stack trace).
Prerequisite: run the ETL once (python -m ml.etl.etl_pipeline ...).
"""
import pytest

from app.core.config import settings

needs_etl = pytest.mark.skipif(not settings.DATA_PROCESSED.exists(), reason="run ml.etl.etl_pipeline first")


def test_health_is_public_and_reports_real_status(client):
    body = client.get("/health").json()
    assert body["success"] is True
    assert body["data"]["database"] == "operational"  # the test DB is really being queried


@needs_etl
def test_dashboard_kpis_come_from_data(client, tokens):
    data = client.get("/api/v1/dashboard", headers=tokens["viewer"]).json()["data"]
    assert data["kpis"]["total_cves"] == 38
    assert data["kpis"]["critical_cves"] == 17
    # Not tracked structurally yet: must be null, never a number borrowed from another field
    assert data["kpis"]["affected_products"] is None
    assert data["kpis"]["duplicate_reports"] is None


@needs_etl
def test_cve_list_filter_and_search(client, tokens):
    h = tokens["viewer"]
    assert client.get("/api/v1/cves", headers=h).json()["data"]["total"] == 38
    assert client.get("/api/v1/cves?severity=CRITICAL", headers=h).json()["data"]["total"] == 17
    assert client.get("/api/v1/cves?search=log4j", headers=h).json()["data"]["total"] == 1


@needs_etl
def test_cve_lookup_and_not_found_envelope(client, tokens):
    h = tokens["viewer"]
    ok = client.get("/api/v1/cves/CVE-2021-44228", headers=h)
    assert ok.status_code == 200 and ok.json()["data"]["cvss_severity"] == "CRITICAL"
    missing = client.get("/api/v1/cves/CVE-0000-0000", headers=h)
    assert missing.status_code == 404
    assert missing.json()["detail"]["error"]["code"] == "CVE_NOT_FOUND"


def test_entity_linking_builds_official_references(client, tokens):
    r = client.post("/api/v1/entities/link", json={"text": "CVE-2021-44228 involves CWE-502"},
                    headers=tokens["viewer"])
    data = r.json()["data"]
    assert data["cves"][0]["url"] == "https://nvd.nist.gov/vuln/detail/CVE-2021-44228"
    assert data["cwes"][0]["url"] == "https://cwe.mitre.org/data/definitions/502.html"
    assert data["cwes"][0]["name"] == "Deserialization of Untrusted Data"


def test_classification_returns_prediction_and_lime_features(client, tokens):
    pytest.importorskip("spacy")
    r = client.post("/api/v1/classification",
                    json={"text": "Remote code execution via CWE-502 in CVE-2021-44228."},
                    headers=tokens["analyst"])
    assert r.status_code == 200
    pred = r.json()["data"]["severity_prediction"]
    assert pred["predicted_severity"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert 0 <= pred["confidence"] <= 1
    assert len(pred["contributing_words"]) > 0


def test_unbuilt_report_export_returns_501_not_fake_success(client, tokens):
    r = client.post("/api/v1/reports/export", json={}, headers=tokens["analyst"])
    assert r.status_code == 501
    assert r.json()["detail"]["error"]["code"] == "NOT_IMPLEMENTED"


def test_openapi_docs_available(client):
    assert client.get("/docs").status_code == 200
    assert len(client.get("/openapi.json").json()["paths"]) >= 15
