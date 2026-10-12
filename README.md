# CloudSentinel

Privacy-first, locally processed CVE vulnerability intelligence — NER, severity
classification, semantic search, grounded AI generation, multilingual (EN/TA/HI)
support, topic discovery, duplicate detection, and voice I/O, all running on
local infrastructure with no CVE data sent to third-party AI APIs.

This is a rebuild of an earlier working prototype (Streamlit UI) into a
production-shaped architecture: React/TypeScript frontend, modular FastAPI
backend, PostgreSQL-ready database layer. **It is being built in explicit
phases (see below), not delivered complete in one drop** — that is a
deliberate decision, not a shortcut: this spec is genuinely multi-week scope
for a real engineering team, and claiming otherwise would mean shipping
untested or fake functionality, which this project explicitly refuses to do.

## Current status: Phase 1 complete, Phase 2 (sign-in + access control) done

| Phase | Scope | Status |
|---|---|---|
| **1** | Architecture + frontend shell + backend skeleton | ✅ Done, tested |
| 2 | Authentication + database | ✅ Done and tested: login page, bcrypt-hashed users in SQL (SQLite by default; PostgreSQL URL supported but **untested**), JWT sessions, 3 roles enforced on the backend, audit log, login throttling. **Not done:** Alembic migrations (tables are created at startup), password-reset email, CVE data in the database (still CSV/JSON files) |
| 3 | CVE ingestion + explorer persistence (structured product/vendor storage) | Partially done (explorer UI works off CSV; DB-backed version is Phase 2+3) |
| 4-11 | NER, classification, embeddings, search, RAG, translation, topics, duplicates, summarization | ✅ ML logic done and evaluated (inherited from the working prototype); ✅ wired into this new backend's API; ⚠️ frontend pages built and type-checked, not yet visually verified in a browser |
| 12 | Voice | ✅ Voice-first assistant (microphone → Whisper → answer → spoken reply, EN/TA/HI, follow-up questions, hands-free mode) and speech input on Severity Analysis. Backend and UI logic are tested with stand-in models, and the chat was driven in a real Chromium with a simulated microphone. ⚠️ The real Whisper, M2M-100 and Ollama models have **not** been run in the build environment, so real-world speed and Tamil/Hindi accuracy are unmeasured |
| 13 | Reports | Weekly briefing works (live); PDF/CSV export NOT built (honest 501, not faked) |
| 14 | Admin panel | Not started |
| 15 | Testing | 121 backend pytest tests (auth/RBAC, voice, translation, assistant pipeline, warm-up, entity tagging) + 94 frontend Vitest tests, all passing. One manual browser run of the voice chat; no automated e2e suite. |
| 16 | Docker | Dockerfiles + compose written, **NOT verified** — no Docker daemon available in this dev environment |
| 17 | Cloud deployment | Not started |
| 18 | UI polish + performance + security audit | Not started |

## What's genuinely real right now

Every endpoint below was tested with real requests against the real 38-CVE
dataset (see `data/raw/cves_expanded.json`) during development:

- `GET /health` — honest system status (not hardcoded "all green")
- `GET /api/v1/dashboard`, `GET /api/v1/cves`, `GET /api/v1/cves/{id}`, `GET /api/v1/cves/stats`
- `POST /api/v1/classification` — real TF-IDF+LogReg severity prediction with LIME
- `POST /api/v1/entities/link` — real MITRE/NVD reference linking
- `GET /api/v1/pipeline/status`
- `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/change-password`, `/api/v1/admin/*` — real (see Sign-in below)
- `POST /api/v1/reports/export` — **honestly returns 501 Not Implemented**, not faked

These five need a populated ChromaDB index + (for generation) Ollama running,
which this dev environment doesn't have — they correctly return a clear 503
with a fix-it message rather than crashing, same tested behavior as before:
`POST /api/v1/search`, `POST /api/v1/assistant`, `GET /api/v1/topics`,
`GET /api/v1/duplicates`, `GET /api/v1/reports/weekly-brief`

## Architecture

```
cloudsentinel/
├── ml/            Pure NLP/ML modules — UNCHANGED from the working prototype
│                  (etl, eda, ner, classification, rag, generation, multilingual,
│                   topic_modeling, summarization, entity_linking, similarity, voice)
├── backend/       FastAPI, modular: core/ api/routes/ services/ — thin wrappers
│                  around ml/, never duplicating its logic
├── frontend/      React + TypeScript + Vite + Tailwind v4, enterprise light theme
├── docker/        Dockerfiles + nginx config (untested — see status table)
├── data/          Raw + processed CVE data
└── outputs/       Generated EDA charts
```

```
User → React Frontend → (dev: Vite proxy / prod: Nginx) → FastAPI Backend
                                                               ↓
                                              services/ → ml/ (NER, classifier,
                                              RAG, generation, translation, ...)
                                                               ↓
                                          ChromaDB (embedded) · Ollama (local LLM)
```

Users and audit events live in a SQL database (`data/app.db` SQLite by default;
set `DATABASE_URL` for PostgreSQL). CVE records and embeddings are still files /
ChromaDB, not in SQL.

## Running locally (Phase 1 — no Docker needed yet)

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn app.main:app --reload --port 8000
```
Swagger docs: http://localhost:8000/docs

Before the search/assistant/topics/duplicates/reports endpoints will work,
build the data + index once (from repo root):
```bash
python -m ml.etl.etl_pipeline --in data/raw/cves_expanded.json --out data/processed/cves_clean.csv
python -m ml.eda.eda_analysis --in data/processed/cves_clean.csv --outdir outputs/eda
cd ml/rag
python build_index.py --in ../../data/raw/cves_expanded.json --source-type cve --collection cve_knowledge --persist-dir ../../data/processed/chroma_store
cd ../..
```

For AI-generated answers (not just ranked sources), also run `ollama serve`
with `llama3.1` pulled.

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
Opens at http://localhost:5173, proxies `/api/*` to the backend on :8000.

## Tests

```bash
cd backend && pytest          # 121 tests incl. auth, roles, lockout, voice upload, entity tagging; needs ml.etl.etl_pipeline run once
cd frontend && npm test       # 94 tests: login, redirects, session expiry, roles, voice input, pages (jsdom)
```
The frontend tests render every key page and flow (including backend-down, 503 and
refusal paths) but run in jsdom, not a real browser — visual layout is still unverified.

## Sign-in and roles

Every screen requires sign-in. The backend enforces roles on each route; the UI
only hides what you can't use.

| Role | Can use |
|---|---|
| **Viewer** | Dashboard, Vulnerability Explorer + CVE detail, API docs link, Settings |
| **Security Analyst** | everything above + Semantic Search, Voice Assistant, Entity Intelligence, Severity Analysis, Topic Discovery, Duplicate Detection, Reports, voice endpoints |
| **Admin** | everything above + Data Pipeline, Admin page (users, audit log) |

**Local demo accounts** are created automatically on first start when
`ENVIRONMENT=development` (the default) and the user table is empty:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cloudco.example` | `Admin#2026Demo` |
| Security Analyst | `analyst@cloudco.example` | `Analyst#2026Demo` |
| Viewer | `viewer@cloudco.example` | `Viewer#2026Demo` |

The login page also offers these under "Demo accounts" in dev builds
(`frontend/.env.development`). They are for local demos only: with
`ENVIRONMENT=production` the backend requires `JWT_SECRET`, never seeds demo users,
and you create real users with:

```bash
python scripts/create_user.py --email you@company.com --name "Your Name" --role admin
```

To call protected endpoints from Swagger (`/docs`): run `POST /api/v1/auth/login`,
copy `access_token`, click **Authorize** and paste it.

## Voice Assistant (voice-first chat)

Open **Voice Assistant**, tap the microphone and ask. Recording stops by itself about 1.4 seconds after you
stop talking (tap the button again to send sooner), your words are transcribed, the assistant answers from the
CVE records, and the answer is read aloud.

- **Languages:** Auto, English, Tamil or Hindi. *Auto* detects what you speak (restricted to these three) and
  answers in the same language. Choosing a language forces both recognition and the reply into it, which is
  faster and more accurate than detection.
- **Follow-ups:** "How do I patch it?" after a question about CVE-2021-44228 is tied to that CVE.
- **Hands-free:** after each spoken reply the microphone opens again. It switches itself off on any error or
  when nothing is heard. Talking over a reply stops it.
- **Typing** works too, and every reply shows its sources and how long it took.

How the speed is kept up (the "no delay" part, honestly stated):

| What used to be slow | What happens now |
|---|---|
| Embedding model reloaded on every question | Loaded once per process |
| Answer, then each source, translated one at a time (about 4 translations) | Answer translated in one batched call; sources are not translated unless asked for |
| Text already in the target language | Never sent to the translator |
| Models loaded on the first request | Loaded in a background thread at server start (`WARMUP_ON_START`); `/health/warmup` shows progress and the page shows a banner meanwhile |
| Ollama unloaded the model after 5 minutes | Kept loaded (`OLLAMA_KEEP_ALIVE`, default 30m) and warmed at start; answers capped at `OLLAMA_NUM_PREDICT` tokens |
| Whisper beam search and language detection | Greedy decoding, language hint from the selector, silence trimmed (VAD), retry without VAD if it removes everything |
| Reading the answer needed a server round trip | Spoken by the browser's own speech engine, instantly |

Failure handling: if Ollama is not running the assistant quotes the best matching record instead of erroring;
if translating the answer fails you get it in English; a CVE id named in the question is looked up exactly;
a stalled speech engine cannot freeze the page.

Tuning (environment variables): `WHISPER_MODEL` (default `small`; use `base` for speed, `medium` for Tamil/Hindi
accuracy), `WHISPER_BEAM_SIZE` (1), `TRANSLATION_BEAMS` (2; 1 is fastest), `OLLAMA_KEEP_ALIVE`, `OLLAMA_NUM_PREDICT`,
`OLLAMA_TIMEOUT`, `WARMUP_ON_START`.

What is unavoidable: the first run downloads models (Whisper `small` about 460 MB, M2M-100 about 1.9 GB), and on a
CPU-only machine a Llama 3.1 answer takes a few seconds and translation a second or two. After warm-up a typical
English question should be answered in a few seconds and Tamil/Hindi a little longer; the per-stage timings in each
reply (`timings_ms`) show where time goes on your machine.

Spoken replies need a voice for the language on the device. Windows, macOS, Android and iOS include Tamil and
Hindi voices (Edge adds natural ones); if none is installed the page says so and shows the text. Speech
*recognition* stays local (Whisper), so audio never goes to a third-party service. The browser only allows the
microphone on `localhost` or HTTPS.

## Voice input (Severity Analysis)

On the **Severity Analysis** page, click **Speak**, say the vulnerability description, and click **Stop**.
The recording is sent to the backend, transcribed, and the text appears in the box. By default the
severity result follows automatically ("Classify automatically after I speak"); untick it to review the
text first.

How it works:

1. The browser records with the microphone (`MediaRecorder`, up to 60 seconds) and uploads it to
   `POST /api/v1/voice/transcribe` (Analysts and Admins).
2. The backend checks the file (audio type, at most `MAX_AUDIO_BYTES`, default 10 MB), writes it to a
   private temp file that is always deleted, and transcribes it with faster-whisper's `base` model in a
   worker thread so other requests keep flowing. Whisper detects the spoken language.
3. English text goes straight into the box. **Tamil or Hindi** is first translated to English with
   `POST /api/v1/translation` (the same `m2m100` model the AI Assistant uses), because the severity
   classifier only understands English. The original words are shown under the box.
4. If translation fails, or the language is not English/Tamil/Hindi, the text is left in the box with a
   warning and is **not** auto-classified.

First use is slow: faster-whisper downloads the `base` model (about 140 MB, one time), and the first Tamil
or Hindi request loads the translation model. Later requests reuse both. The browser only allows the
microphone on `localhost` or HTTPS.

Limits: speech recognition can mishear CVE and CWE numbers, so check the text. Text-to-speech
(`POST /api/v1/voice/speak`) is not used by any screen; the assistant speaks through the browser instead.

## Honest limitations

- The Phase I NER scores (precision 1.00, recall 0.93, F1 0.96) cover only the product, attack-vector and version-range labels: the 15 hand-labelled examples contained no CVE or CWE IDs. IDs are matched by pattern and are covered by regression tests instead. Those tests came from a bug found while preparing the demo, where spaCy tagged some IDs as PERSON, ORG or GPE and that label won; regex matches now always take priority.

- Evaluated on a 38-record demonstration dataset — architecture supports
  larger datasets (CSV/JSON import), but current metrics are proof-of-concept
  scale, not production-validated.
- Sign-in is real, but this is a single-process build: the login throttle is in
  memory (use a shared store like Redis behind multiple workers), the token is kept
  in browser storage (any XSS on the page could read it; HttpOnly cookies are the
  stricter option), and there is no email-based password reset (admins create users).
  Put it behind HTTPS before exposing it beyond localhost.
- Docker Compose is written but not run end-to-end in this dev environment —
  verify with `docker compose up --build` before depending on it.
- "Affected Products" and "Top Vulnerable Products" are honestly empty right
  now (`null` / `[]`) rather than faked — the current ETL output doesn't
  persist a structured product field per CVE (products are extracted via NER
  on demand, not stored). Fixing this is Phase 3 work.

## Next steps

Next candidates: move CVE data into the database (which also fixes the empty
"Affected Products" card), Alembic migrations, PDF/CSV report export, browser
(e2e) tests, and a verified Docker build.
