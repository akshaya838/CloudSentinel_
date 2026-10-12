"""
CloudSentinel - Stage 5: Grounded Answer Generation (NLP Concept 4)
=====================================================================
Takes the ranked source chunks from Stage 4's RAG retrieval and generates
a composed, natural-language answer using a locally-hosted LLM via Ollama —
staying grounded in only the retrieved context (no open-ended generation),
so the auditability chain (answer -> source CVE -> CWE -> CIA impact) from
earlier stages carries all the way through to the final answer.

Why Ollama: keeps the "fully local, nothing leaves the org's infrastructure"
story intact — this is the same differentiator as the embedding model and
the translation model, just applied to generation instead of retrieval.

Requires Ollama installed and running locally with a model pulled:
    ollama pull llama3.1        (or mistral, etc.)
    ollama serve                (usually runs automatically after install)

Usage (run from repo root):
    python -m src.generation.generate_answer --query "What is the impact of Log4Shell?"
"""

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))

import os

DEFAULT_MODEL = "llama3.1"
OLLAMA_HOST = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
# Keep the model in memory between questions (Ollama's default is to unload it after 5 minutes,
# which makes the next question pay a long cold-start), and cap the answer length so the model
# stops when the 3-5 sentence answer is done.
KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "220"))
TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT", "90"))

SYSTEM_PROMPT = """You are CloudSentinel, a cloud security assistant. Answer ONLY using the \
provided CVE source context below. Do not use outside knowledge. If the context does not \
contain enough information to answer, say so explicitly rather than guessing. Keep the answer \
concise (3-5 sentences), mention the relevant CVE ID(s) and severity, and end with a one-line \
remediation recommendation."""


def _format_context(chunks: list[dict]) -> str:
    blocks = []
    for i, c in enumerate(chunks, 1):
        meta = c.get("metadata", {})
        blocks.append(
            f"[Source {i}] {meta.get('source_id', 'unknown')} "
            f"(severity={meta.get('cvss_severity', '?')}, impact={meta.get('business_impact', '?')})\n"
            f"{c['text']}"
        )
    return "\n\n".join(blocks)


def generate_answer(query: str, chunks: list[dict], model: str = DEFAULT_MODEL) -> dict:
    """Generate a grounded answer from retrieved chunks. Raises ConnectionError
    if Ollama isn't reachable — callers should catch this and degrade to
    showing raw sources instead of crashing (see src/api/main.py /query)."""
    try:
        import ollama
    except ImportError:
        raise RuntimeError("Run: pip install ollama") from None

    context = _format_context(chunks)
    user_prompt = f"Question: {query}\n\nContext:\n{context}\n\nAnswer:"

    try:
        response = ollama.Client(host=OLLAMA_HOST, timeout=TIMEOUT_S).chat(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            options={"num_predict": NUM_PREDICT, "temperature": 0.2},
            keep_alive=KEEP_ALIVE,
        )
    except Exception as e:
        raise ConnectionError(f"Could not reach Ollama ({e}). Is `ollama serve` running?") from e

    answer_text = response["message"]["content"].strip()

    return {
        "query": query,
        "answer": answer_text,
        "model": model,
        "source_ids": [c.get("metadata", {}).get("source_id") for c in chunks],
        "num_sources": len(chunks),
    }


def warm_up(model: str = DEFAULT_MODEL) -> None:
    """Load the model into memory with a one-token request so the first real question is fast."""
    import ollama
    ollama.Client(host=OLLAMA_HOST, timeout=TIMEOUT_S).chat(
        model=model, messages=[{"role": "user", "content": "hi"}],
        options={"num_predict": 1}, keep_alive=KEEP_ALIVE,
    )


if __name__ == "__main__":
    from retrieve import query_index  # flat import, matches retrieve.py's own style

    parser = argparse.ArgumentParser(description="CloudSentinel grounded answer generation")
    parser.add_argument("--query", required=True)
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--collection", default="cve_knowledge")
    parser.add_argument("--persist-dir", default=str(REPO_ROOT / "data" / "processed" / "chroma_store"))
    args = parser.parse_args()

    hits = query_index(args.query, args.collection, args.persist_dir, args.top_k)
    result = generate_answer(args.query, hits, model=args.model)

    print(f"\nQuestion: {result['query']}\n")
    print(f"Answer ({result['model']}):\n{result['answer']}\n")
    print(f"Grounded in: {', '.join(s for s in result['source_ids'] if s)}")
