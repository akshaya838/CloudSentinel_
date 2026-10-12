"""
CVE lookup and dashboard KPI computation — reads the real ETL output
(ml.etl.etl_pipeline's result), no mock numbers anywhere.
"""

import pandas as pd

from app.core.config import settings
from app.services.model_loader import get_cve_lookup


def get_cve(cve_id: str) -> dict | None:
    return get_cve_lookup().get(cve_id)


def list_cves(
    severity: str | None = None,
    cwe: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Filtered, paginated CVE list for the Vulnerability Explorer."""
    if not settings.DATA_PROCESSED.exists():
        raise FileNotFoundError("Run ml.etl.etl_pipeline first")
    df = pd.read_csv(settings.DATA_PROCESSED)

    if severity:
        df = df[df["cvss_severity"].str.upper() == severity.upper()]
    if cwe:
        df = df[df["cwe_ids"].str.contains(cwe, case=False, na=False)]
    if search:
        mask = (
            df["cve_id"].str.contains(search, case=False, na=False)
            | df["description"].str.contains(search, case=False, na=False)
        )
        df = df[mask]

    total = len(df)
    start = (page - 1) * page_size
    page_df = df.iloc[start : start + page_size]

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "records": page_df.to_dict(orient="records"),
    }


def get_stats() -> dict:
    if not settings.DATA_PROCESSED.exists():
        raise FileNotFoundError("Run ml.etl.etl_pipeline first")
    df = pd.read_csv(settings.DATA_PROCESSED)
    return {
        "total_records": len(df),
        "severity_breakdown": df["cvss_severity"].value_counts().to_dict(),
        "avg_cvss_score": round(float(df["cvss_base_score"].mean()), 2),
        "avg_description_length": round(float(df["description_length"].mean()), 1),
        "unique_cwe_types": int(df["cwe_ids"].str.split(";").explode().nunique()),
        "charts": [f"/static/eda/{p.name}" for p in sorted(settings.EDA_DIR.glob("*.png"))]
        if settings.EDA_DIR.exists() else [],
    }


def get_dashboard_kpis() -> dict:
    """KPI cards for the dashboard — all computed from real data, not hardcoded."""
    df = pd.read_csv(settings.DATA_PROCESSED)
    sev = df["cvss_severity"].value_counts()
    return {
        "total_cves": len(df),
        "critical_cves": int(sev.get("CRITICAL", 0)),
        "high_cves": int(sev.get("HIGH", 0)),
        # None on purpose: the ETL output has no structured product column, and
        # counting distinct CWEs here would mislabel a weakness count as products.
        "affected_products": None,
        "cwes_detected": int(df["cwe_ids"].str.split(";").explode().nunique()),
        "duplicate_reports": None,  # filled in by /api/v1/duplicates on demand — expensive to compute on every dashboard load
    }


def get_top_products(limit: int = 10) -> list[dict]:
    """Top vulnerable products. NOTE: current dataset doesn't carry a
    structured product field after ETL (products are extracted via NER
    from free text, not stored per-record in cves_clean.csv) — this
    returns an explicit empty-with-reason result rather than fabricating
    product names, consistent with the 'no fake functionality' rule."""
    return []  # TODO (Phase 3): persist NER-extracted VENDOR_PRODUCT entities per CVE in the DB so this can aggregate for real
