"""
CloudSentinel - ETL Pipeline (Stage 0: Data Collection & Preprocessing)

Extract  : load raw CVE records fetched by src/ingestion/fetch_cve.py
Transform: clean description text, normalize CVSS severity, explode the
           multi-valued cwe_ids field, derive text-length features, and
           join the CWE -> CIA business-impact map already defined in
           src/classification/severity_classifier.py (single source of
           truth, not duplicated here)
Load     : write a flat, analysis-ready CSV + JSON to data/processed/

Usage (run from repo root):
    python -m src.etl.etl_pipeline --in data/raw/cves_expanded.json --out data/processed/cves_clean.csv

Swap --in for a fresh data/raw/cves.json pulled via fetch_cve.py and the
rest of the pipeline (this + eda_analysis.py) runs unchanged.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import pandas as pd

# Make the repo root importable so we can reuse the CWE impact map already
# defined in Stage 3 instead of maintaining a second copy of it.
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
from ml.classification.severity_classifier import CWE_IMPACT_MAP  # noqa: E402

SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def extract(input_path: str) -> list[dict]:
    path = Path(input_path)
    if not path.exists():
        sys.exit(f"[extract] Input file not found: {input_path}")
    with open(path, "r", encoding="utf-8") as f:
        records = json.load(f)
    print(f"[extract] Loaded {len(records)} raw records from {input_path}")
    return records


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _impact_for_cwe_list(cwe_ids: list[str]) -> list[str]:
    """Union of CIA-triad impacts across all CWEs on a record."""
    impacts: set[str] = set()
    for cwe in cwe_ids or []:
        impacts.update(CWE_IMPACT_MAP.get(cwe, []))
    return sorted(impacts) if impacts else ["Unknown"]


def transform(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)

    # 1. Clean free-text description
    df["description"] = df["description"].apply(_clean_text)

    # 2. Normalize + validate severity
    df["cvss_severity"] = df["cvss_severity"].str.strip().str.upper()
    before = len(df)
    df = df[df["cvss_severity"].isin(SEVERITY_ORDER)].copy()
    if len(df) < before:
        print(f"[transform] Dropped {before - len(df)} records with invalid severity")
    df["cvss_severity"] = pd.Categorical(df["cvss_severity"], categories=SEVERITY_ORDER, ordered=True)

    # 3. Derived features
    df["description_length"] = df["description"].str.split().apply(len)
    df["cwe_count"] = df["cwe_ids"].apply(lambda x: len(x) if isinstance(x, list) else 0)
    df["primary_cwe"] = df["cwe_ids"].apply(lambda x: x[0] if isinstance(x, list) and x else None)

    # 4. Business-impact enrichment, reusing Stage 3's CWE_IMPACT_MAP
    df["business_impact"] = df["cwe_ids"].apply(_impact_for_cwe_list)

    # 5. Deduplicate on cve_id (idempotent re-runs)
    before = len(df)
    df = df.drop_duplicates(subset="cve_id", keep="first")
    if len(df) < before:
        print(f"[transform] Removed {before - len(df)} duplicate CVE records")

    print(f"[transform] {len(df)} records after cleaning and enrichment")
    return df


def load(df: pd.DataFrame, output_path: str) -> None:
    out_csv = Path(output_path)
    out_csv.parent.mkdir(parents=True, exist_ok=True)

    # Flatten list columns for CSV (JSON keeps them native)
    csv_df = df.copy()
    csv_df["cwe_ids"] = csv_df["cwe_ids"].apply(lambda x: ";".join(x) if isinstance(x, list) else "")
    csv_df["business_impact"] = csv_df["business_impact"].apply(lambda x: ";".join(x) if isinstance(x, list) else "")
    csv_df.to_csv(out_csv, index=False)

    out_json = out_csv.with_suffix(".json")
    df.to_json(out_json, orient="records", indent=2)

    print(f"[load] Wrote {len(df)} records -> {out_csv}")
    print(f"[load] Wrote {len(df)} records -> {out_json}")


def run_etl(input_path: str, output_path: str) -> pd.DataFrame:
    records = extract(input_path)
    df = transform(records)
    load(df, output_path)
    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel ETL pipeline")
    parser.add_argument("--in", dest="input_path", default="data/raw/cves_expanded.json")
    parser.add_argument("--out", dest="output_path", default="data/processed/cves_clean.csv")
    args = parser.parse_args()

    df = run_etl(args.input_path, args.output_path)
    print("\n[summary]")
    print(df["cvss_severity"].value_counts().sort_index())
