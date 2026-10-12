"""
CloudSentinel - Extractive Summarization (NLP Concept 7)
============================================================
Condenses a batch of CVEs (e.g. "all Critical severity this week") into a
short briefing — WITHOUT calling an LLM. This is a deliberately different
technique from Stage 5's generation: extractive summarization selects and
ranks existing sentences by importance, rather than generating new text,
so it's fast, fully deterministic, and needs no model download at all.

Algorithm: TextRank — build a graph where each CVE description is a node,
edges are weighted by cosine similarity between descriptions (reusing
Stage 4's MiniLM embeddings), then run PageRank over that graph so
descriptions that are most "central" (most similar to the most other
descriptions) rank highest. The top-N ranked descriptions become the
briefing. This is the same core idea as Google's original PageRank,
applied to sentences instead of web pages.

Usage (run from repo root):
    python -m src.summarization.summarize --severity CRITICAL --top-n 5
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))


def _cosine_similarity_matrix(embeddings: np.ndarray) -> np.ndarray:
    norm = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    return norm @ norm.T


def _pagerank(similarity_matrix: np.ndarray, damping: float = 0.85, iterations: int = 100) -> np.ndarray:
    """Minimal PageRank via power iteration — no networkx dependency needed."""
    n = similarity_matrix.shape[0]
    # Zero the diagonal (a node shouldn't vote for itself) and row-normalize
    adj = similarity_matrix.copy()
    np.fill_diagonal(adj, 0)
    row_sums = adj.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1  # avoid divide-by-zero for isolated nodes
    transition = adj / row_sums

    scores = np.ones(n) / n
    for _ in range(iterations):
        scores = (1 - damping) / n + damping * (transition.T @ scores)
    return scores


def summarize_cves(descriptions: list[str], cve_ids: list[str], top_n: int = 5) -> list[dict]:
    """Rank CVE descriptions by centrality and return the top-N as a briefing."""
    from build_index import get_embedding_fn  # reuse Stage 4's embedding model

    if len(descriptions) <= top_n:
        return [{"cve_id": c, "description": d, "centrality_score": 1.0} for c, d in zip(cve_ids, descriptions)]

    embed_fn = get_embedding_fn()
    embeddings = np.array(embed_fn(descriptions))
    sim_matrix = _cosine_similarity_matrix(embeddings)
    scores = _pagerank(sim_matrix)

    ranked_idx = np.argsort(scores)[::-1][:top_n]
    return [
        {"cve_id": cve_ids[i], "description": descriptions[i], "centrality_score": round(float(scores[i]), 4)}
        for i in ranked_idx
    ]


def run_summarization(input_path: str, severity: str | None, top_n: int) -> dict:
    df = pd.read_csv(input_path)
    if severity:
        df = df[df["cvss_severity"].str.upper() == severity.upper()]

    if df.empty:
        return {"severity_filter": severity, "total_candidates": 0, "briefing": []}

    briefing = summarize_cves(df["description"].tolist(), df["cve_id"].tolist(), top_n)
    return {
        "severity_filter": severity,
        "total_candidates": len(df),
        "briefing_size": len(briefing),
        "briefing": briefing,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel extractive summarization")
    parser.add_argument("--in", dest="input_path", default="data/processed/cves_clean.csv")
    parser.add_argument("--severity", default=None, help="Filter to one severity level, e.g. CRITICAL")
    parser.add_argument("--top-n", type=int, default=5)
    args = parser.parse_args()

    result = run_summarization(args.input_path, args.severity, args.top_n)
    print(f"\nBriefing from {result['total_candidates']} candidate CVEs"
          + (f" (severity={args.severity})" if args.severity else "") + ":\n")
    for item in result["briefing"]:
        print(f"[{item['cve_id']}] (centrality={item['centrality_score']})")
        print(f"  {item['description']}\n")
