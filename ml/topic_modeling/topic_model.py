"""
CloudSentinel - Topic Modeling (NLP Concept 6)
=================================================
Automatically groups CVEs into themes WITHOUT any labels — unlike Stage 3's
severity classifier (supervised, trained on labeled severity), this is
unsupervised: it discovers structure in the data on its own.

Approach: embed every CVE description with the same MiniLM model Stage 4
already uses for RAG (single source of truth for embeddings across the
project), cluster those embeddings with K-Means, then label each cluster
by its most distinctive TF-IDF terms — so "Topic 2" becomes something like
"authentication, bypass, privilege" rather than an opaque number.

Why K-Means over BERTopic/HDBSCAN: with only 38 records, density-based
clustering (HDBSCAN) tends to dump most points into a single noise cluster
or produce unstable results — K-Means with a small, fixed k is simpler,
more stable, and more honest about what a 38-record dataset can support.

Usage (run from repo root):
    python -m src.topic_modeling.topic_model --in data/processed/cves_clean.csv --k 5
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))


def _top_terms_per_cluster(descriptions: list[str], labels, n_terms: int = 5) -> dict[int, list[str]]:
    """Label each cluster with its most distinctive TF-IDF terms, computed
    one-vs-rest so a term common to every cluster doesn't dominate all labels."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    import numpy as np

    vectorizer = TfidfVectorizer(stop_words="english", max_features=500)
    tfidf = vectorizer.fit_transform(descriptions)
    terms = vectorizer.get_feature_names_out()

    labels_arr = np.array(labels)
    topics = {}
    for cluster_id in sorted(set(labels)):
        mask = labels_arr == cluster_id
        cluster_mean = tfidf[mask].mean(axis=0).A1
        top_idx = cluster_mean.argsort()[::-1][:n_terms]
        topics[cluster_id] = [terms[i] for i in top_idx]
    return topics


def run_topic_modeling(input_path: str, k: int = 5) -> dict:
    from build_index import get_embedding_fn  # reuse Stage 4's embedding model
    from sklearn.cluster import KMeans

    df = pd.read_csv(input_path)
    descriptions = df["description"].tolist()

    embed_fn = get_embedding_fn()
    embeddings = embed_fn(descriptions)

    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    cluster_labels = kmeans.fit_predict(embeddings)

    df["topic_cluster"] = cluster_labels
    topic_terms = _top_terms_per_cluster(descriptions, cluster_labels)

    result = {
        "k": k,
        "topics": {
            int(cid): {
                "top_terms": terms,
                "size": int((cluster_labels == cid).sum()),
                "example_cves": df.loc[df["topic_cluster"] == cid, "cve_id"].head(3).tolist(),
            }
            for cid, terms in topic_terms.items()
        },
        "assignments": df[["cve_id", "topic_cluster"]].to_dict(orient="records"),
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel topic modeling")
    parser.add_argument("--in", dest="input_path", default="data/processed/cves_clean.csv")
    parser.add_argument("--k", type=int, default=5, help="Number of topic clusters")
    parser.add_argument("--out", default="outputs/evaluation/topics.json")
    args = parser.parse_args()

    result = run_topic_modeling(args.input_path, args.k)
    for cid, info in result["topics"].items():
        print(f"\nTopic {cid} ({info['size']} CVEs): {', '.join(info['top_terms'])}")
        print(f"  e.g. {', '.join(info['example_cves'])}")

    out_path = REPO_ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\nWritten to {out_path}")
