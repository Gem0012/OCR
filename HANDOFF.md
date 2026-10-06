# AI HANDOFF — `C:\OCR`, branch `OCR-ZCODE`

**Purpose:** this file hands this project to another AI session (or a human co-worker) with zero verbal context. It is written to be self-contained: everything critical is stated here; the deep specification lives in `BUILD_PLAN.md` (source of truth for contracts and phases). If this file and `BUILD_PLAN.md` ever disagree, `BUILD_PLAN.md` wins on spec details and this file wins on "what happened most recently".

**Read order for a new session:** this file top-to-bottom → skim `BUILD_PLAN.md` (especially §4 locked decisions, §5 contracts, phases) → verify any claim you're about to rely on against the actual code (memories and docs drift; disk doesn't).

**Rule written for every session:** update §9 "Session log" at the end of your session, and keep the rest of this file accurate as things change.

---

## 1. What this project is

A **reusable document-extraction HTTP service**. Any app can register a "profile" (a list of fields it wants extracted), then upload a document (image, PDF, DOCX, XLSX, CSV, TXT, RTF) to `POST /api/extract` and get back structured JSON matching those fields. It wraps the small **GLM-OCR** vision model (0.9B, GGUF Q8_0) served locally by llama.cpp, with a text-layer fast path for born-digital PDFs and office files, and supports pointing any profile at a cloud OpenAI-compatible endpoint instead.

- Owner: solo developer, GitHub account `Gem0012`, repo `github.com/Gem0012/OCR`, local clone at `C:\OCR`.
- Product stance: the OCR service **owns its own database**; consumer apps (his web app "elixir", "app B", …) talk to it purely via API. Per-app (really per-form) profiles namespace everything.
- Design religion: **privacy-first** — documents are processed in memory only; default profiles store nothing (`storage: "none"`); nothing is exposed to the public internet.

## 2. The owner and how to communicate

- He is a **self-described newbie**. Explain in plain language, use analogies, give step-by-step checklists. Avoid jargon without a one-line explanation.
- **Telegram relay:** a ZCode Bots bot (`ZCode_bot_Ai`, chat `1769786730`) is connected with `replyMode: assistant_changes` — the final assistant message of each turn is automatically relayed to his phone. No manual Telegram API calls needed; do not go hunting for tokens.
- **Stop protocol:** when he says "stop", halt immediately and report state (what was done, what wasn't, why). Any further action waits for his reply.
- **Read-only gate:** when he says "read only" (or "still planning"), do analysis/design/discussion only — zero file changes, zero commands that mutate state.
- **Reporting rhythm:** he asked for a milestone report at each phase boundary and an immediate alert on any blocker. He also knows you cannot meter your own token usage — agreed scheme is milestone-based reporting, not usage reporting.
- **Approval gates:** new build work needs his explicit go-ahead. Commits/pushes happen per phase once he has approved the work ("push after every phase" was granted during the phase build; for anything *new*, ask before committing).

## 3. Environment — how to run everything

Windows 10, Git Bash shell, Node.js + npm installed. Repo root `C:\OCR`.

**Two separate processes must both be running for OCR to work:**

1. **The model server** (llama.cpp, port **8080** — this is the AI model, *not* a website):
   ```
   llama-server -hf ggml-org/GLM-OCR-GGUF:Q8_0 -c 12000 -ngl 99 --flash-attn off -fit off
   ```
   → serves `http://localhost:8080/v1`. Model + vision projector (mmproj) are already cached at `C:\Users\USer\.cache\huggingface\hub\models--ggml-org--GLM-OCR-GGUF` — no download needed. It runs on an AMD Vega 11 iGPU (2 GB) via Vulkan; the CLIP vision encoder partially falls back to CPU ("CLIP graph uses unsupported operators" warning is **expected**, not a bug).

2. **The OCR service** (API + dashboard in one Express server, port **7860**):
   ```
   npm run server        # tsx server.ts — serves API + built dashboard on :7860
   npm run build         # tsc -b (app) + tsc --noEmit (server) + vite build — run before server for UI changes
   npm start             # build + server in one
   npm run dev           # Vite dev server for frontend work, proxies /api → 127.0.0.1:7860
   ```
   Verify: `curl http://localhost:7860/api/config` → JSON including `supabase_configured`.

**Environment variables** (all optional; copy `.env.example` → `.env`; `.env` is gitignored and must never be committed):

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `7860` | service port |
| `GLM_BASE_URL` | `http://localhost:8080/v1` | default model endpoint |
| `GLM_MODEL` | `glm-ocr` | default model name |
| `MAX_PDF_PAGES` | `8` | per-upload PDF page cap |
| `MAX_UPLOAD_MB` | `25` | upload size cap |
| `MAX_TOKENS` | `4096` | model completion cap |
| `REQUEST_TIMEOUT_MS` | `900000` | per-request model timeout |
| `LLM_API_KEY` | unset | sent as `Authorization: Bearer` to the model endpoint; only needed for cloud providers (local llama-server ignores it) |
| `SUPABASE_DB_URL` | unset | Supabase Postgres connection string (URI). When set, `storage:"supabase"` profiles write real rows and the table auto-creates |

**Hardware reality (measured):** ~22 tok/s JSON generation, ~3–5 s per page, ceiling roughly 12–20 pages/min. Pages process sequentially. llama-server exposes 4 slots (parallelism unused). Scaling path is decided (D12): async job queue → better GPU → stateless replicas. Do not "optimize" this without the owner asking.

## 4. Repo, branches, commit rules

- Branch `OCR-ZCODE` = **all development**. `main` = stable checkpoints only. Both exist on the remote; push works via Windows Credential Manager (token stored for owner `Gem0012`). `gh` CLI is not installed and not needed.
- Commit message style: `Phase N: <what>` (or descriptive imperative). Push after every approved phase.
- `.gitignore` covers `.env`, `.env.*`, `*.db-shm`, `*.db-wal`, `.zcode/`. Note: `ocr.db-wal` was tracked *before* the ignore rule existed, so it still shows as "modified" in `git status` — that is a runtime scratch file; leave it out of commits unless the owner explicitly asks for a database checkpoint (he has done that once: commit `331dc04`).
- Quirk: `node_modules` is committed to this repo (owner's choice historically) — don't "clean that up" unprompted. 1 pre-existing high-severity `npm audit` finding exists; noted, not ours to fix unprompted.
- Known cosmetic debt: commit `9b526f2` ("Phase 2+3") accidentally also contains the Phase 4 component. Disclosed to owner; do not rebase/rewrite history over it.

## 5. Architecture

### 5.1 Server (`src/server/`) — one Express app, API + dashboard

| Module | Role |
|---|---|
| `main.ts` | builds the Express app, loads config, opens DB, creates Supabase store only if `SUPABASE_DB_URL` set (fails soft), serves `dist/` |
| `config.ts` | env loading incl. a tiny zero-dependency `.env` reader |
| `db.ts` | better-sqlite3 `ocr.db`; **any new column must use the `addMissingColumn` pattern** so existing DBs self-migrate |
| `profiles.ts` | profile CRUD + validation; seeded `devconsole` profile is service-owned (re-upserted each boot, cannot be deleted) |
| `prompt.ts` | prompt generation from field list (**JSON-shape template** — see §7) + `repairCommonSlips` parser repairs |
| `files.ts` + `pipeline.ts` | file-type router `convertUpload()`: digital PDF (pdfjs text layer ≥60 chars) → `text`; scanned PDF → rendered images → `vision`; DOCX (mammoth), XLSX/XLS (SheetJS, one page per sheet), CSV/TXT/MD, RTF (stripped) → `text`; GIF/BMP → data URL; HEIC/TIFF → rejected (deferred, D10); unknown → 400 |
| `extract.ts` | page loop, `extractData` normalization (keeps only declared field keys; types string/number/boolean) |
| `llm.ts` | `completeChat` shared core + `runModelPages` (vision) / `runTextPages` (text, wraps pages in `<document>` tags); carries `apiKey` → `LLM_API_KEY` |
| `storage.ts` | SQLite `extractions` store: save / list (filter by app_id, reference_id) / get / `updateExtractionData` (PATCH) |
| `supabase.ts` | same interface over postgres.js (`prepare:false` for Supabase poolers); writes jsonb via `${JSON.stringify(data)}::jsonb`; auto-creates `ocr_extractions` with SQL identical to the committed migration |
| `routes.ts` | all HTTP endpoints (table in §6) |
| `legacy.ts` | old `/api/ocr` person-extraction path (writes `ocr_records`+`people`), now routed through the file-type router |

### 5.2 Dashboard (`src/dashboard/`) — React, served by the same server

`App.tsx` is the sidebar shell (existing gray-green "bench" theme, IBM Plex). Components: `ProfilesPage`, `ProfileEditor` (fields builder + **paste-JSON import** + live prompt preview via `POST /api/prompt-preview` + branding + API-key generator, shown once, stored masked as `has_api_key`), `RecordsPage` (filter by profile/reference_id, detail panel, source toggle Local/Supabase), `PlaygroundPage` (upload + result), `ReviewForm.tsx` (**Phase 4 editable review form**, wired into both Playground and Records; missing values flagged "not found — check the document"; Save → `PATCH /api/extractions/:id`), `SettingsPage` (model-server health check + `supabase_configured` indicator), `api.ts` (typed client), `ui.tsx` (primitives).

### 5.3 Data flow of `POST /api/extract` (read `routes.ts` lines ~202–286 for the real thing)

1. Auth: if the profile has an `api_key`, request must send matching `X-API-Key` header → else 401.
2. `convertUpload()` routes the file by extension/MIME (§5.1).
3. Vision path: images → GLM-OCR with the profile's prompt. Text path: pages wrapped in `<document>` tags → same model (or the profile's cloud override).
4. `extractData` keeps only declared keys (this is deliberate — the model cannot invent fields).
5. Storage: `none` → nothing persisted; `local`/`devconsole` → SQLite `extractions`; `supabase` → `ocr_extractions` via postgres.js, **fail-soft** (write failure → `warning` in response, result still returned; unconfigured → warning, no write).
6. Response: `{ text, data, record_id?, stored_in?, warning?, profile, reasoning, pages, pipeline: "vision"|"text", usage }`.

## 6. API reference (as implemented in `routes.ts`)

| Method & path | Notes |
|---|---|
| `GET /api/config` | port, model, `supabase_configured` flag |
| `GET /api/models` | model-server health check |
| `POST /api/prompt-preview` | generated prompt for fields, no model call |
| `GET /api/profiles` | list (api_key masked as `has_api_key`) |
| `POST /api/profiles` | create (validate: id `^[a-z0-9][a-z0-9_-]{0,63}$`, fields typed string/number/boolean) |
| `GET/PUT/DELETE /api/profiles/:id` | read / update / delete (`devconsole` cannot be deleted) |
| `GET /api/extractions` | `?app_id=&reference_id=&source=local|supabase` |
| `GET /api/extractions/:id` | detail; 404 path tested |
| `PATCH /api/extractions/:id` | `{data, source}` — human corrections from the review form |
| `POST /api/extract` | main endpoint — multipart `file` + `profile` (+ optional `reference_id`, `owner_id`, or fully ad-hoc `fields`/`prompt`/`model`/`base_url`/`temperature` in the body) |
| `POST /api/ocr` | legacy person-extraction, kept working |

## 7. GLM-OCR model quirks — do not break these

This small model **mimics prompt formatting**, so:

- The prompt must stay the **literal JSON-shape template** (`JSON shape: {"key":""}` + `Field notes:` lines, generated in `prompt.ts`). Prose-style bullet field lists make it emit invalid JSON like `vendor (string): "..."` or unquoted keys.
- It emits **bare unquoted ISO dates** and **thousands separators in JSON numbers** (`"total": 3,420.75`). `repairCommonSlips` in `prompt.ts` repairs both — any parser change must keep these fallbacks intact (test with a value like `3,420.75`).
- Temperature 0 on profiles is the sane default for extraction.

## 8. Current state (verify against `git log` — this section ages)

**Done, live-tested, and pushed on `OCR-ZCODE`** (newest first): `331dc04` DB checkpoint → `9b526f2` Phase 2+3 (+ Phase 4 component) → `7f643ae` Phase 1 → `08c18e0` refactor + console + build plan.

- **Phase 1 — Dashboard UI** (replaced the single-page console; all screens listed in §5.2).
- **Phase 2 — Supabase storage mode**: code complete, fail-soft paths tested live. **The real write test is still pending** because the owner has not yet created the dedicated Supabase project (see §10.1).
- **Phase 3 — File-type router + `LLM_API_KEY`**: digital-PDF fast path, office/text files, scanned-PDF vision routing; response includes `pipeline`.
- **Phase 4 — Editable review form** (`ReviewForm.tsx`): browser-verified end-to-end (records edited and persisted via PATCH).

Profiles existing on this install: `devconsole` (person fields, storage local, service-owned, api_key none), `invoice-app` (demo, api_key `s3cret`, storage none), `elixir-intake` (5 fields, created via paste-JSON import during Phase 1 verification).

**Nothing executable remains in BUILD_PLAN.md.** What's left is owner-gated (§10). BUILD_PLAN.md §6 ("frozen work") is stale — everything in it was later verified; clean it up next time that file is edited.

## 9. What's next — in order

1. **Phase 2 live test (needs owner):** owner creates the dedicated Supabase project (free tier is fine), Dashboard → Settings → Database → Connection string → URI, replaces `[YOUR-PASSWORD]`, and puts it in `.env` as `SUPABASE_DB_URL`. Then: restart service, upload once with a `storage:"supabase"` profile, confirm the row lands in `ocr_extractions`, test `?source=supabase` reads and PATCH with `source:"supabase"`.
2. **Phase 5 — elixir pre-fill B (blocked):** needs the elixir codebase (repo URL or local path) + form field schemas. Shape when unblocked: elixir backend endpoint forwards multipart to `/api/extract` (`profile=elixir-<form>`, `reference_id`/`owner_id` from elixir's context, `X-API-Key` from elixir env) → frontend fills form state from `data` → human review. **Do not start without the codebase.**
3. **Optional backlog (only if the owner asks; from BUILD_PLAN.md §9):** async job queue (the big concurrency unlock), MCP server wrapper (lets AI assistants use the service as a tool), webhook callbacks, multi-tenant dashboard login, HEIC/TIFF via `sharp` (deferred by D10 — owner is new; avoid the setup friction unless he asks), GPU upgrade for speed.

## 10. Testing playbook

- Type-check everything: `npm run build` (runs `tsc -b` + server `tsc --noEmit` + vite). Server-only: `npx tsc -p tsconfig.server.json --noEmit`.
- **Never trust a running service after code edits** — tsx holds old code in memory. Restart sequence: kill orphan (`netstat -ano | findstr 7860` → `taskkill /PID <pid> /F`), then `npm run server`.
- File uploads: the in-session browser **cannot** do file uploads. Test via curl, and mind the Windows gotcha: **curl cannot read Git Bash `/tmp` paths** — always use `C:/...` paths:
  ```
  node make-test-files.cjs        # writes test digital PDF, XLSX, CSV into C:\OCR
  curl -s -X POST http://localhost:7860/api/extract \
    -F "profile=devconsole" -F "reference_id=test-1" -F "file=@C:/OCR/sample-digital.pdf"
  ```
- Regression list whenever server logic changes: reference_id round-trip (tag → filter → get by id), PATCH correction persistence, legacy `/api/ocr` still works, supabase-unconfigured fail-soft warning, a `3,420.75`-style number and an ISO date parse correctly.
- After frontend changes: build, restart, click through Profiles → Editor (paste-JSON import + prompt preview) → Playground (upload → review form → Save) → Records → Settings health check.

## 11. Rules for the next AI (condensed)

1. Don't relitigate locked decisions D1–D12 (BUILD_PLAN.md §4). Highlights: no n8n; one profile per form (`app-form` naming); OCR service owns its own dedicated Supabase project, JSON-only, migration file + auto-create with identical SQL; HEIC/TIFF deferred; scale path later.
2. Don't start Phase 5 without the elixir codebase in hand.
3. Don't commit/push without the owner's approval for new work; never commit secrets or WAL files.
4. Don't touch `main` except checkpoint pushes the owner approves.
5. Don't weaken the security posture: localhost binding, `X-API-Key` on extraction when set, secrets only in `.env`, sensitive docs keep `storage:"none"`.
6. When the owner says "read only" or "stop" — see §2. Those words mean exactly one thing.
7. If you're a ZCode session: the persistent memory index at `C:\Users\USer\.zcode\cli\memories\projects\ocr-14ad36293f309271\memory\` carries deeper history (read `ocr-app-setup.md` if you need the full decision narrative). If you're another platform: this file + BUILD_PLAN.md are all you get — verify against disk.
8. End every session with: §9 snapshot/log updated, memory updated (ZCode), tree clean (only `ocr.db*` may show dirty), owner told the state.

## 12. Session log

- **2026-10-06 (build session):** Phases 1–4 built, tested, pushed (details in §8). Telegram bot connected and live-tested (`/workspace C:\OCR` binding works from his phone).
- **2026-10-06 (this session):** status check; services found down (post-reboot, expected); wrote this HANDOFF.md (owner asked for a maximally detailed AI handoff; early short version replaced by this file). No code changes. `ocr.db-wal` dirty as usual. Awaiting owner on §9.1 (Supabase project) and §9.2 (elixir codebase).
