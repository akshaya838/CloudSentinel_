"""
CloudSentinel - Entity Linking (NLP Concept 8)
=================================================
Named Entity Recognition (Stage 2) finds a mention like "CWE-502" in text.
Entity linking is the next NLP step after that: connecting that mention to
a single, canonical real-world knowledge-base entry — in this case, the
official MITRE CWE definition and the official NVD CVE record — rather
than leaving it as a bare string. This is the same core task as linking
"Paris" in a sentence to the specific Wikipedia/Wikidata entry for the
city, applied to the security domain.

Design choice: canonical reference URLs are constructed deterministically
from the ID itself (MITRE and NVD both use predictable URL patterns), and
human-readable CWE names are a small local lookup table built from the
CWEs actually present in this project's dataset — NOT a live API call.
This keeps the "fully local" story intact: no request leaves the machine
to resolve a link, only to optionally fetch more detail if the user clicks
through themselves.

Usage (run from repo root):
    python -m src.entity_linking.link_entities --text "CVE-2021-44228 involves CWE-502"
"""

import argparse
import re

# Human-readable names for the CWE IDs present in this project's 38-record
# dataset (see outputs/eda/02_cwe_frequency.png for the full distribution).
# Sourced from the official MITRE CWE list.
CWE_NAMES = {
    "CWE-787": "Out-of-bounds Write",
    "CWE-122": "Heap-based Buffer Overflow",
    "CWE-502": "Deserialization of Untrusted Data",
    "CWE-284": "Improper Access Control",
    "CWE-119": "Improper Restriction of Operations within Memory Buffer Bounds",
    "CWE-89": "SQL Injection",
    "CWE-78": "OS Command Injection",
    "CWE-290": "Authentication Bypass by Spoofing",
    "CWE-287": "Improper Authentication",
    "CWE-94": "Code Injection",
    "CWE-288": "Authentication Bypass Using an Alternate Path or Channel",
    "CWE-20": "Improper Input Validation",
    "CWE-22": "Path Traversal",
    "CWE-294": "Authentication Bypass by Capture-replay",
    "CWE-269": "Improper Privilege Management",
    "CWE-843": "Type Confusion",
    "CWE-200": "Exposure of Sensitive Information to an Unauthorized Actor",
    "CWE-345": "Insufficient Verification of Data Authenticity",
    "CWE-416": "Use After Free",
    "CWE-190": "Integer Overflow or Wraparound",
    "CWE-347": "Improper Verification of Cryptographic Signature",
    "CWE-98": "Improper Control of Filename for Include/Require Statement (File Inclusion)",
    "CWE-829": "Inclusion of Functionality from Untrusted Control Sphere",
}

CVE_PATTERN = re.compile(r"CVE-\d{4}-\d{4,7}")
CWE_PATTERN = re.compile(r"CWE-\d+")


def link_cve(cve_id: str) -> dict:
    return {
        "id": cve_id,
        "kb": "NVD",
        "url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
    }


def link_cwe(cwe_id: str) -> dict:
    number = cwe_id.replace("CWE-", "")
    return {
        "id": cwe_id,
        "name": CWE_NAMES.get(cwe_id),
        "kb": "MITRE CWE",
        "url": f"https://cwe.mitre.org/data/definitions/{number}.html",
    }


def link_entities_in_text(text: str) -> dict:
    """Find and link every CVE/CWE mention in a block of text."""
    cve_ids = sorted(set(CVE_PATTERN.findall(text)))
    cwe_ids = sorted(set(CWE_PATTERN.findall(text)))

    return {
        "cves": [link_cve(c) for c in cve_ids],
        "cwes": [link_cwe(c) for c in cwe_ids],
    }


def link_entities_from_ner(entities: list[dict]) -> dict:
    """Same linking, but driven off Stage 2's NER output (entities with a
    'label' of CVE_ID / CWE_ID) instead of re-scanning raw text."""
    cve_ids = sorted({e["text"] for e in entities if e.get("label") == "CVE_ID"})
    cwe_ids = sorted({e["text"] for e in entities if e.get("label") == "CWE_ID"})

    return {
        "cves": [link_cve(c) for c in cve_ids],
        "cwes": [link_cwe(c) for c in cwe_ids],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel entity linking")
    parser.add_argument("--text", required=True)
    args = parser.parse_args()

    result = link_entities_in_text(args.text)
    for cve in result["cves"]:
        print(f"{cve['id']} -> {cve['url']}")
    for cwe in result["cwes"]:
        name = cwe["name"] or "(name not in local lookup table)"
        print(f"{cwe['id']} ({name}) -> {cwe['url']}")
