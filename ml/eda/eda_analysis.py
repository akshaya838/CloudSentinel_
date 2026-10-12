"""
CloudSentinel - Exploratory Data Analysis (Stage 0)

Reads the cleaned dataset from src/etl/etl_pipeline.py and produces:
  1. CVSS severity distribution
  2. Top CWE (vulnerability type) frequency, exploded from the cwe_ids list
  3. CVSS base score distribution
  4. Description length distribution (informs Stage 4's chunking strategy)
  5. Business-impact category frequency (Confidentiality/Integrity/Availability)
  6. A printed + saved summary-statistics table

Usage (run from repo root):
    python -m src.eda.eda_analysis --in data/processed/cves_clean.csv --outdir outputs/eda
"""

import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

sns.set_theme(style="whitegrid")
SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
SEVERITY_COLORS = {"LOW": "#4CAF50", "MEDIUM": "#FFC107", "HIGH": "#FF7043", "CRITICAL": "#C62828"}


def load_data(input_path: str) -> pd.DataFrame:
    df = pd.read_csv(input_path)
    df["cvss_severity"] = pd.Categorical(df["cvss_severity"], categories=SEVERITY_ORDER, ordered=True)
    df["cwe_ids"] = df["cwe_ids"].fillna("").apply(lambda x: x.split(";") if x else [])
    df["business_impact"] = df["business_impact"].fillna("").apply(lambda x: x.split(";") if x else [])
    return df


def plot_severity_distribution(df: pd.DataFrame, outdir: Path) -> None:
    counts = df["cvss_severity"].value_counts().reindex(SEVERITY_ORDER)
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(counts.index, counts.values, color=[SEVERITY_COLORS[s] for s in counts.index])
    ax.set_title(f"CVE Severity Distribution (n={len(df)})")
    ax.set_xlabel("CVSS Severity")
    ax.set_ylabel("Count")
    for i, v in enumerate(counts.values):
        ax.text(i, v + 0.2, str(v), ha="center", fontweight="bold")
    fig.tight_layout()
    fig.savefig(outdir / "01_severity_distribution.png", dpi=150)
    plt.close(fig)


def plot_cwe_frequency(df: pd.DataFrame, outdir: Path) -> None:
    exploded = df.explode("cwe_ids")
    counts = exploded["cwe_ids"].value_counts().head(10)
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh(counts.index[::-1], counts.values[::-1], color="#3F51B5")
    ax.set_title("Top 10 CWE (Vulnerability Type) Frequency")
    ax.set_xlabel("Count")
    fig.tight_layout()
    fig.savefig(outdir / "02_cwe_frequency.png", dpi=150)
    plt.close(fig)


def plot_cvss_score_distribution(df: pd.DataFrame, outdir: Path) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hist(df["cvss_base_score"], bins=10, color="#00897B", edgecolor="white")
    ax.set_title("CVSS Base Score Distribution")
    ax.set_xlabel("CVSS Base Score (0-10)")
    ax.set_ylabel("Number of CVEs")
    fig.tight_layout()
    fig.savefig(outdir / "03_cvss_score_distribution.png", dpi=150)
    plt.close(fig)


def plot_description_length(df: pd.DataFrame, outdir: Path) -> None:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hist(df["description_length"], bins=10, color="#7B1FA2", edgecolor="white")
    ax.set_title("CVE Description Length Distribution")
    ax.set_xlabel("Word count")
    ax.set_ylabel("Number of CVEs")
    fig.tight_layout()
    fig.savefig(outdir / "04_description_length.png", dpi=150)
    plt.close(fig)


def plot_business_impact_frequency(df: pd.DataFrame, outdir: Path) -> None:
    exploded = df.explode("business_impact")
    counts = exploded["business_impact"].value_counts()
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(counts.index, counts.values, color="#1976D2")
    ax.set_title("Business Impact Category Frequency (CIA Triad)")
    ax.set_ylabel("Count")
    fig.tight_layout()
    fig.savefig(outdir / "05_business_impact_frequency.png", dpi=150)
    plt.close(fig)


def print_summary(df: pd.DataFrame) -> str:
    lines = []
    lines.append(f"Total records: {len(df)}")
    lines.append(f"Unique CWE types: {df.explode('cwe_ids')['cwe_ids'].nunique()}")
    lines.append(f"Avg CVSS base score: {df['cvss_base_score'].mean():.2f}")
    lines.append(f"Avg description length: {df['description_length'].mean():.1f} words")
    lines.append(f"Avg CWEs per record: {df['cwe_count'].mean():.2f}")
    lines.append("\nSeverity breakdown:")
    lines.append(df["cvss_severity"].value_counts().reindex(SEVERITY_ORDER).to_string())
    summary = "\n".join(lines)
    print(summary)
    return summary


def run_eda(input_path: str, outdir: str) -> None:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    df = load_data(input_path)

    plot_severity_distribution(df, out)
    plot_cwe_frequency(df, out)
    plot_cvss_score_distribution(df, out)
    plot_description_length(df, out)
    plot_business_impact_frequency(df, out)
    summary = print_summary(df)

    (out / "summary_stats.txt").write_text(summary, encoding="utf-8")
    print(f"\n[eda] Charts and summary written to {out.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel EDA")
    parser.add_argument("--in", dest="input_path", default="data/processed/cves_clean.csv")
    parser.add_argument("--outdir", default="outputs/eda")
    args = parser.parse_args()
    run_eda(args.input_path, args.outdir)
