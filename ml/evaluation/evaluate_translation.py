"""
CloudSentinel - Evaluation of NLP Concept 5: Multilingual Translation
=========================================================================
Measures translation reliability using round-trip consistency: translate
English -> target language -> back to English, and compare against the
original using the same MiniLM embedding model Stage 4 already uses.

Usage (run from repo root, first run downloads ~1.9GB translation model):
    python -m src.evaluation.evaluate_translation
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))

from ml.multilingual.translate_module import Translator  # noqa: E402

SIMILARITY_THRESHOLD = 0.75

TEST_SENTENCES = [
    "A remote attacker can execute arbitrary code via a crafted HTML page.",
    "This vulnerability allows privilege escalation to SYSTEM level.",
    "The flaw affects versions prior to 8.4.0 and has been patched.",
    "An authentication bypass lets an attacker create administrator accounts.",
]


def _cosine_similarity(a, b) -> float:
    import numpy as np
    a, b = np.array(a), np.array(b)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def evaluate_round_trip(translator: Translator, embed_fn, sentence: str, target_lang: str) -> dict:
    forward = translator.translate(sentence, target_lang=target_lang, source_lang="en")
    back = translator.translate(forward["translated_text"], target_lang="en", source_lang=target_lang)

    emb_original = embed_fn([sentence])[0]
    emb_roundtrip = embed_fn([back["translated_text"]])[0]
    similarity = _cosine_similarity(emb_original, emb_roundtrip)

    return {
        "original": sentence,
        "target_lang": target_lang,
        "translated": forward["translated_text"],
        "round_tripped": back["translated_text"],
        "similarity": round(similarity, 4),
        "passed": similarity >= SIMILARITY_THRESHOLD,
    }


def run_evaluation() -> None:
    from build_index import get_embedding_fn  # reuse Stage 4's embedding model, not a new one

    translator = Translator()
    embed_fn = get_embedding_fn()

    results = []
    for sentence in TEST_SENTENCES:
        for lang in ["ta", "hi"]:
            print(f"[{lang}] {sentence[:50]}...")
            results.append(evaluate_round_trip(translator, embed_fn, sentence, lang))

    by_lang = {}
    for r in results:
        by_lang.setdefault(r["target_lang"], []).append(r["similarity"])

    lines = ["# Stage: Multilingual Translation Evaluation (NLP Concept 5)\n"]
    lines.append(f"Round-trip similarity threshold: {SIMILARITY_THRESHOLD}\n")
    for lang, scores in by_lang.items():
        avg = sum(scores) / len(scores)
        passed = sum(1 for s in scores if s >= SIMILARITY_THRESHOLD)
        lines.append(f"## {lang.upper()}: avg similarity {avg:.3f}, {passed}/{len(scores)} passed threshold\n")

    for r in results:
        lines.append(f"- [{r['target_lang']}] \"{r['original']}\"")
        lines.append(f"  -> \"{r['translated']}\"")
        lines.append(f"  -> back: \"{r['round_tripped']}\" (similarity={r['similarity']}, passed={r['passed']})\n")

    report = "\n".join(lines)
    print("\n" + report)

    out_path = REPO_ROOT / "outputs" / "evaluation" / "translation_eval.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    (out_path.with_suffix(".json")).write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nWritten to {out_path}")


if __name__ == "__main__":
    run_evaluation()
