"""
CloudSentinel - Duplicate / Similarity Detection (NLP Concept 9)
====================================================================
Flags pairs of CVEs that are near-duplicates or closely related — useful
for a security team deduplicating alerts, or spotting that two advisories
describe variants of the same underlying bug. Reuses Stage 4's MiniLM
embeddings (the same ones powering RAG retrieval), so this is a second,
complementary use of an embedding already being computed, not a new model.

This is a different NLP task from RAG retrieval even though both use
embeddings: retrieval matches a QUERY against documents; this matches
documents against EACH OTHER, all-pairs, with no query at all.

Usage (run from repo root):
    python -m src.similarity.duplicate_detection --in data/processed/cves_clean.csv --threshold 0.85
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))

DEFAULT_THRESHOLD = 0.85


def _cosine_similarity_matrix(embeddings: np.ndarray) -> np.ndarray:
    norm = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    return norm @ norm.T


def find_near_duplicates(cve_ids: list[str], descriptions: list[str], threshold: float = DEFAULT_THRESHOLD) -> list[dict]:
    from build_index import get_embedding_fn  # reuse Stage 4's embedding model

    embed_fn = get_embedding_fn()
    embeddings = np.array(embed_fn(descriptions))
    sim_matrix = _cosine_similarity_matrix(embeddings)

    n = len(cve_ids)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):  # upper triangle only, no self-pairs or duplicate pairs
            score = float(sim_matrix[i, j])
            if score >= threshold:
                pairs.append({
                    "cve_a": cve_ids[i],
                    "cve_b": cve_ids[j],
                    "similarity": round(score, 4),
                })
    pairs.sort(key=lambda p: p["similarity"], reverse=True)
    return pairs


def run_duplicate_detection(input_path: str, threshold: float) -> dict:
    df = pd.read_csv(input_path)
    pairs = find_near_duplicates(df["cve_id"].tolist(), df["description"].tolist(), threshold)
    return {"threshold": threshold, "total_records": len(df), "near_duplicate_pairs": pairs}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel near-duplicate CVE detection")
    parser.add_argument("--in", dest="input_path", default="data/processed/cves_clean.csv")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    args = parser.parse_args()

    result = run_duplicate_detection(args.input_path, args.threshold)
    print(f"Checked {result['total_records']} CVEs at similarity threshold {result['threshold']}\n")
    if not result["near_duplicate_pairs"]:
        print("No near-duplicate pairs found above threshold.")
    for p in result["near_duplicate_pairs"]:
        print(f"{p['cve_a']} <-> {p['cve_b']}  (similarity={p['similarity']})")
