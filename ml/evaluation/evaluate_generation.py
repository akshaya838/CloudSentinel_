"""
CloudSentinel - Evaluation of NLP Concept 4: Grounded Answer Generation
==========================================================================
Measures whether generated answers stay faithful to the retrieved source
context (groundedness) rather than hallucinating.

Metrics:
  - Groundedness: fraction of CVE/CWE IDs mentioned in the generated answer
    that also appear in the retrieved source chunks.
  - Source-severity consistency: whether the severity word used in the
    answer (if any) matches the severity of the top-ranked source.
  - Appropriate refusal: whether the model says "not enough information"
    on an out-of-scope query rather than hallucinating an answer.

Usage (run from repo root, requires Ollama running with a model pulled):
    python -m src.evaluation.evaluate_generation
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))

from ml.generation.generate_answer import generate_answer  # noqa: E402

ID_PATTERN = re.compile(r"CVE-\d{4}-\d{4,7}|CWE-\d+")

TEST_QUERIES = [
    "What is the impact of Log4Shell?",
    "How severe is the curl SOCKS5 vulnerability?",
    "What is the capital of France?",  # out-of-scope: should refuse, not hallucinate
]


def evaluate_query(query: str, top_k: int = 3) -> dict:
    from retrieve import query_index

    hits = query_index(
        query, collection_name="cve_knowledge",
        persist_dir=str(REPO_ROOT / "data" / "processed" / "chroma_store"),
        top_k=top_k,
    )
    source_ids = {h.get("metadata", {}).get("source_id") for h in hits}
    source_text = " ".join(h["text"] for h in hits)
    source_ids_in_context = set(ID_PATTERN.findall(source_text)) | source_ids

    result = generate_answer(query, hits)
    answer = result["answer"]

    ids_in_answer = set(ID_PATTERN.findall(answer))
    hallucinated_ids = ids_in_answer - source_ids_in_context
    grounded = len(hallucinated_ids) == 0

    top_severity = hits[0].get("metadata", {}).get("cvss_severity", "").lower() if hits else None
    severity_mentioned = top_severity and top_severity in answer.lower()

    refused = any(phrase in answer.lower() for phrase in
                  ["not enough information", "cannot answer", "no relevant", "don't have information"])

    return {
        "query": query,
        "answer": answer,
        "ids_in_answer": sorted(ids_in_answer),
        "hallucinated_ids": sorted(hallucinated_ids),
        "grounded": grounded,
        "top_source_severity": top_severity,
        "severity_mentioned_in_answer": bool(severity_mentioned),
        "appropriately_refused": refused,
    }


def run_evaluation() -> None:
    results = []
    for q in TEST_QUERIES:
        print(f"Evaluating: {q}")
        try:
            results.append(evaluate_query(q))
        except (ConnectionError, RuntimeError) as e:
            print(f"  [skipped] {e}")
            return

    grounded_count = sum(r["grounded"] for r in results if "capital of France" not in r["query"])
    total_scored = sum(1 for r in results if "capital of France" not in r["query"])

    lines = ["# Stage 5 Generation Evaluation (NLP Concept 4)\n"]
    lines.append(f"Groundedness: {grounded_count}/{total_scored} answers had zero hallucinated CVE/CWE IDs\n")
    for r in results:
        lines.append(f"## {r['query']}")
        lines.append(f"- Answer: {r['answer']}")
        lines.append(f"- IDs in answer: {r['ids_in_answer']}")
        lines.append(f"- Hallucinated IDs: {r['hallucinated_ids'] or 'none'}")
        lines.append(f"- Grounded: {r['grounded']}")
        lines.append(f"- Appropriately refused (out-of-scope query only): {r['appropriately_refused']}\n")

    report = "\n".join(lines)
    print("\n" + report)

    out_path = REPO_ROOT / "outputs" / "evaluation" / "generation_eval.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    (out_path.with_suffix(".json")).write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nWritten to {out_path}")


if __name__ == "__main__":
    run_evaluation()
