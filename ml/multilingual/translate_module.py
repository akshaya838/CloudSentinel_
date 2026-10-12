"""
CloudSentinel - Multilingual Translation Module
==================================================
Adds 3-language support (English, Tamil, Hindi) on top of the RAG pipeline
so a query in any of the three languages can retrieve English CVE/CWE
knowledge and get an answer back in the query's own language.

Model choice & why:
  We use facebook/m2m100_418M, a single pretrained many-to-many multilingual
  translation model covering 100 languages including Tamil (ta) and Hindi (hi).
  Rationale for the project write-up:
    - One model handles all 3 languages instead of 3 separate language-pair
      models, which keeps the local-deployment footprint smaller.
    - 418M parameters runs comfortably on CPU for short security-query text,
      consistent with the "fully local deployment" differentiator.
    - This is an HONEST framing: we are integrating a pretrained model into
      the pipeline (like Stage 3's TF-IDF+LogReg or Stage 4's MiniLM
      embeddings), not claiming to have trained a translation model from
      scratch — that is not feasible with a 38-record security dataset.

Supported languages: English (en), Tamil (ta), Hindi (hi)

IMPORTANT - first run needs internet access on YOUR machine:
  `pip install transformers sentencepiece torch`
  The model (~1.9GB) downloads automatically from Hugging Face on first use
  and is cached locally afterward (fully offline from then on).

Usage (run from repo root):
    python -m src.multilingual.translate_module --text "How do I patch CVE-2023-4863?" --target ta
    python -m src.multilingual.translate_module --text "இந்த பாதிப்பு எவ்வளவு தீவிரமானது?" --target en

    # Or import as a module elsewhere in the pipeline (e.g. before/after
    # ml/rag/retrieve.py so a Tamil or Hindi query can hit the English index):
    from ml.multilingual.translate_module import Translator
    t = Translator()
    t.translate("What is the severity of this CVE?", target_lang="hi")
"""

import argparse
import os
import re
import sys
import threading
from collections import OrderedDict

LANG_CODES = {
    "en": "English",
    "ta": "Tamil",
    "hi": "Hindi",
}


CVE_ID = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)
_SENTENCE_END = re.compile(r"(?<=[.!?\u0964\u0965])\s+")  # . ! ? and the Devanagari danda
MAX_CHARS_PER_PIECE = 400
NUM_BEAMS = int(os.getenv("TRANSLATION_BEAMS", "2"))  # 1 = fastest (greedy), 4-5 = slowest/best
CACHE_SIZE = 512


def split_sentences(text: str) -> list[str]:
    """Translate sentence by sentence: M2M-100 is trained on sentences, long paragraphs get
    truncated or dropped, and short pieces batch efficiently."""
    pieces: list[str] = []
    for part in _SENTENCE_END.split(text.strip()):
        part = part.strip()
        while len(part) > MAX_CHARS_PER_PIECE:  # a very long run-on: cut at the last space
            cut = part.rfind(" ", 0, MAX_CHARS_PER_PIECE)
            cut = cut if cut > 0 else MAX_CHARS_PER_PIECE
            pieces.append(part[:cut].strip())
            part = part[cut:].strip()
        if part:
            pieces.append(part)
    return pieces


def restore_cve_ids(source: str, translated: str) -> str:
    """Translation models sometimes mangle identifiers. A CVE id in the source must survive."""
    present = {m.upper() for m in CVE_ID.findall(translated)}
    missing = [m for m in dict.fromkeys(x.upper() for x in CVE_ID.findall(source)) if m not in present]
    return f"{translated} ({', '.join(missing)})" if missing else translated


def detect_script_lang(text: str) -> str:
    """Language from the Unicode script: Tamil block -> ta, Devanagari -> hi, otherwise en.
    Counts characters so a mostly-English sentence with one Tamil word is not misrouted."""
    ta = hi = other = 0
    for ch in text:
        code = ord(ch)
        if 0x0B80 <= code <= 0x0BFF:
            ta += 1
        elif 0x0900 <= code <= 0x097F:
            hi += 1
        elif ch.isalpha():
            other += 1
    if ta == hi == 0:
        return "en"
    if ta >= hi:
        return "ta" if ta >= other * 0.25 else "en"
    return "hi" if hi >= other * 0.25 else "en"


class Translator:
    """Thin wrapper around facebook/m2m100_418M for CloudSentinel's 3 languages."""

    MODEL_NAME = "facebook/m2m100_418M"

    def __init__(self, model_name: str | None = None):
        try:
            import torch
            from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
        except ImportError:
            sys.exit(
                "Missing dependencies. Run:\n"
                "  pip install transformers sentencepiece torch"
            )
        self._torch = torch
        self.model_name = model_name or self.MODEL_NAME
        print(f"[translate_module] Loading {self.model_name} (first run downloads ~1.9GB)...")
        self.tokenizer = M2M100Tokenizer.from_pretrained(self.model_name)
        self.model = M2M100ForConditionalGeneration.from_pretrained(self.model_name)
        self.model.eval()
        self._lock = threading.Lock()  # the tokenizer's src_lang is shared state: one translation at a time
        self._cache: OrderedDict[tuple[str, str, str], str] = OrderedDict()
        print("[translate_module] Model ready.")

    def detect_source_lang(self, text: str) -> str:
        """Lightweight script-based language detection (no extra model, instant)."""
        return detect_script_lang(text)

    # ---- cache -------------------------------------------------------------
    def _cache_get(self, key):
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def _cache_put(self, key, value):
        self._cache[key] = value
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)

    # ---- core --------------------------------------------------------------
    def _translate_pieces(self, pieces: list[str], source_lang: str, target_lang: str) -> list[str]:
        """Translate short pieces in ONE batched forward pass (much faster than one by one)."""
        with self._lock:
            results: dict[int, str] = {}
            todo: list[tuple[int, str]] = []
            for i, piece in enumerate(pieces):
                hit = self._cache_get((source_lang, target_lang, piece))
                if hit is not None:
                    results[i] = hit
                else:
                    todo.append((i, piece))

            if todo:
                self.tokenizer.src_lang = source_lang
                encoded = self.tokenizer([p for _, p in todo], return_tensors="pt", padding=True,
                                         truncation=True, max_length=256)
                with self._torch.inference_mode():
                    generated = self.model.generate(
                        **encoded,
                        forced_bos_token_id=self.tokenizer.get_lang_id(target_lang),
                        num_beams=NUM_BEAMS,
                        max_new_tokens=256,
                    )
                decoded = self.tokenizer.batch_decode(generated, skip_special_tokens=True)
                for (i, piece), out in zip(todo, decoded):
                    out = out.strip()
                    results[i] = out
                    self._cache_put((source_lang, target_lang, piece), out)
        return [results[i] for i in range(len(pieces))]

    def _check(self, target_lang: str, source_lang: str | None, text: str) -> str:
        if target_lang not in LANG_CODES:
            raise ValueError(f"target_lang must be one of {list(LANG_CODES)}")
        source_lang = source_lang or self.detect_source_lang(text)
        if source_lang not in LANG_CODES:
            raise ValueError(f"source_lang must be one of {list(LANG_CODES)}")
        return source_lang

    def translate_many(self, texts: list[str], target_lang: str, source_lang: str | None = None) -> list[str]:
        """Translate several independent texts together. Same-language texts are returned as is,
        sentences are batched across ALL texts in one model call, and repeats come from the cache."""
        src = [self._check(target_lang, source_lang, t) for t in texts]
        out: list[str | None] = [None] * len(texts)
        for lang in dict.fromkeys(src):  # the tokenizer needs one src_lang per batch
            idx = [i for i, l in enumerate(src) if l == lang]
            if lang == target_lang:
                for i in idx:
                    out[i] = texts[i]
                continue
            pieces, owner = [], []
            for i in idx:
                parts = split_sentences(texts[i])
                pieces.extend(parts)
                owner.extend([i] * len(parts))
            translated = self._translate_pieces(pieces, lang, target_lang) if pieces else []
            joined: dict[int, list[str]] = {i: [] for i in idx}
            for i, t in zip(owner, translated):
                joined[i].append(t)
            for i in idx:
                out[i] = restore_cve_ids(texts[i], " ".join(joined[i]).strip())
        return [o if o is not None else "" for o in out]

    def translate(self, text: str, target_lang: str, source_lang: str | None = None) -> dict:
        source_lang = self._check(target_lang, source_lang, text)
        translated_text = text if source_lang == target_lang else \
            self.translate_many([text], target_lang, source_lang)[0]
        return {
            "source_lang": source_lang,
            "target_lang": target_lang,
            "source_text": text,
            "translated_text": translated_text,
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel multilingual translation (en/ta/hi)")
    parser.add_argument("--text", required=True, help="Text to translate")
    parser.add_argument("--target", required=True, choices=list(LANG_CODES), help="Target language code")
    parser.add_argument("--source", default=None, choices=list(LANG_CODES), help="Source language code (auto-detected if omitted)")
    args = parser.parse_args()

    translator = Translator()
    result = translator.translate(args.text, target_lang=args.target, source_lang=args.source)
    print(f"\n[{LANG_CODES[result['source_lang']]} -> {LANG_CODES[result['target_lang']]}]")
    print(f"  Source : {result['source_text']}")
    print(f"  Result : {result['translated_text']}")
