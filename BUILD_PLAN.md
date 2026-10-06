# OCR Service — Master Build Plan

> **Purpose of this document.** This is the single source of truth for evolving the
> GLM OCR prototype (in this repository) into a standalone, reusable
> document-extraction service with its own dashboard, its own Supabase project,
> and per-app profiles. It is written so a developer **or another AI agent** with
> zero prior context can execute the work.
>
> **Rules for whoever executes this:**
> 1. Do not `git commit` or push unless the owner explicitly asks.
> 2. Do not start a phase before the previous phase's acceptance criteria pass.
> 3. The owner approves the start of work; this document is the plan, not a
>    green light.
> 4. `OCR_FEATURE_GUIDE.md` is a historical prototype document — do not follow
>    it where it contradicts this plan (it predates the profile system).

---

## 1. Product vision

A standalone web service, "Document Extraction Service":

- Uploads documents (images, PDFs, office/text files) and returns **structured
  JSON** shaped by **per-form profiles**.
- Has a **web dashboard** for everything: creating/editing profiles, testing
  uploads, browsing stored records, service settings. No configuration via curl.
- Persists results in **its own dedicated Supabase project** (per-profile choice
  of: store nowhere, local SQLite, or Supabase).
- Serves **many apps** (the owner's projects "elixir", "app B", …) over a clean
  HTTP API. Each app registers one profile per form. Apps never share code with
  the service; n8n is explicitly dropped as middleware.
- Runs the GLM-OCR vision model locally via llama.cpp, with per-profile option
  to point at any OpenAI-compatible endpoint (cloud, pay-per-token) instead.

---

## 2. Current state (already working, verified end-to-end)

Repository: `C:\OCR` (cloned from `github.com/Gem0012/OCR`). Windows 10,
Git Bash shell, Node v24, npm 11.

The prototype was already refactored from a single-file app into:

```
server.ts                  thin entry: computes rootDir, calls startServer()
src/server/
  config.ts   AppConfig from env: PORT, GLM_BASE_URL, GLM_MODEL, MAX_PDF_PAGES,
              MAX_UPLOAD_MB, MAX_TOKENS, REQUEST_TIMEOUT_MS
  db.ts       better-sqlite3 open + schema + column checks
  types.ts    FieldDef, Profile, ExtractionRecord
  prompt.ts   LEGACY_PROMPT, parseModelJson (tolerant), buildExtractionPrompt
              (JSON-shape template), isPlainObject
  extract.ts  normalizeKey, coerceValue, matchRecords, normalizeAllRecords,
              extractData (per-page parse + merge)
  profiles.ts validateProfileInput, CRUD (list/get/upsert/delete), publicProfile
              (strips api_key), seedProfiles (devconsole, refreshed every boot)
  llm.ts      runModelPages: sequential per-page OpenAI-compatible
              chat/completions with image_url + text
  files.ts    multer upload (25MB limit, MIME/extension filter), imageDataUrls
              (PDF→PNG pages at scale 2 via pdfjs-dist + @napi-rs/canvas)
  storage.ts  saveLegacyRecord (legacy ocr_records+people), saveExtraction,
              listExtractions, getExtraction
  routes.ts   all endpoints + SPA fallback + multer error handler
  main.ts     startServer(): config → db → seed → listen
src/App.tsx  dev console (single page): profile dropdown, settings, upload,
             results (text + structured JSON + reasoning), branding applies
             title/subtitle/accent
```

**Verified working (tested live against the model):**
- `POST /api/extract` with a profile id returns `{ text, data, record_id?,
  profile, reasoning, pages, usage }`; `data` is normalized to the profile's
  field list, with type coercion (numbers become JSON numbers, etc.).
- Profiles CRUD; `GET /api/profiles/:id` returns `effective_prompt` and never
  the stored `api_key`; `PUT` that omits `api_key` keeps the stored key;
  `DELETE` of `devconsole` is blocked (400).
- Profile-level API key auth: wrong/missing `X-API-Key` → 401; correct → 200.
- Upload hardening: wrong type → 400 with clear message; >25 MB → 400.
- Legacy `POST /api/ocr` still works (writes legacy `ocr_records` + `people`
  tables) and now populates person rows properly.
- `GET /api/extractions?app_id=...` returns only that app's rows.
- Dashboard branding switches per profile (tested in browser).
- Devconsole profile is auto-seeded/refreshed at boot with person fields
  (name, date_of_birth, address, phone, email, details) and `storage: "local"`.

**Model:** GLM-OCR-GGUF Q8_0 (~0.9B params) served by llama.cpp on
`http://localhost:8080/v1` via Vulkan on an AMD Vega 11 iGPU (2 GB). Startup
command that works on this machine:

```
llama-server -hf ggml-org/GLM-OCR-GGUF:Q8_0 -c 12000 -ngl 99 --flash-attn off -fit off
```

Model files are cached locally (Hugging Face cache
`models--ggml-org--GLM-OCR-GGUF`), so startup needs no download. ~3–5 s per
page on this hardware; ~22 tokens/s generation.

---

## 3. Critical environment notes (Windows specifics)

- Shell is **Git Bash** on Windows. Paths like `/c/OCR` work in bash; Windows
  programs need `C:/OCR` style (e.g. `curl -F "file=@C:/OCR/test.png"` — a
  `/tmp/...` path will silently fail with curl exit 26).
- **Restarting the service:** `npm run server` (tsx) runs the server **from
  source** — no build step needed for server code; restart = stop + start.
  Stopping the npm background task does **not** kill the node child. Correct
  procedure:
  1. `PID=$(netstat -ano | grep ":7860" | grep LISTENING | head -1 | awk '{print $NF}')`
  2. `taskkill //PID $PID //F` (double slash in Git Bash)
  3. start again in background, then `curl http://localhost:7860/api/config`
     to confirm.
- **Type-checking:** server code is checked with
  `npx tsc -p tsconfig.server.json --noEmit` (NodeNext module resolution —
  relative imports inside `src/server/` must use `.js` extensions).
  Frontend: `npm run build` runs `tsc -b` (app config: `tsconfig.app.json`
  excludes `src/server`) + Vite bundle to `dist/`.
- `node_modules` and `dist/` are **committed to the repo** (owner's choice) —
  `npm install` still works and should be run after pulling changes.
- `ocr.db` (SQLite, WAL mode) at repo root holds legacy tables
  (`ocr_records`, `people`) with real history — **never delete it**. New tables
  (`app_profiles`, `extractions`) live in the same file.
- Test images: none are committed. Generate with `@napi-rs/canvas` (already a
  dependency) when testing, e.g. text on white canvas → PNG. Delete test
  artifacts afterward.

---

## 4. Locked decisions (owner approved — do not relitigate)

| # | Decision |
|---|----------|
| D1 | Standalone HTTP API service; **no n8n**; apps integrate via API only |
| D2 | **One profile per form**, naming `app-form` (e.g. `elixir-intake`, `elixir-invoice`, `appb-orders`); 5 elixir forms = 5 profiles |
| D3 | Apps own their data by default (`storage: "none"`); optional `"local"` (SQLite) and `"supabase"` modes per profile |
| D4 | Supabase: **dedicated project owned by the OCR service** (NOT elixir's project). JSON records only — **no file bucket** for now |
| D5 | Supabase table exists both as a **migration file in the repo** and **auto-created by the service at startup** using the identical SQL |
| D6 | `owner_id` nullable column exists from day one (apps may pass their own user id); per-user RLS deferred — phase-1 reads go through app backends / the OCR API |
| D7 | Dashboard is the only configuration surface; **paste-JSON import** button for profile fields (no AI-parse mode) |
| D8 | Pre-fill: **A first** (editable review form in the dashboard after upload), **B later** (elixir's own forms auto-fill; needs elixir codebase, not yet shared) |
| D9 | Per-profile model choice (local llama.cpp or any OpenAI-compatible/cloud endpoint); per-profile `api_key` auth on extraction |
| D10 | File support: common images (PNG/JPG/WebP/BMP), PDFs with digital-text fast path, office/text files. **HEIC/TIFF deferred** (owner is new; avoid `sharp` setup friction for now) |
| D11 | Security: `.env` + `.gitignore` before any key exists; service stays off the public internet (localhost now, Tailscale/HTTPS when split across machines) |
| D12 | Scale path later (async job queue → GPU → stateless replicas); cloud models as overflow. Not part of this build |

---

## 5. Contracts (implement exactly to these)

### 5.1 Profile schema

```jsonc
{
  "id": "elixir-intake",            // ^[a-z0-9][a-z0-9_-]{0,63}$
  "name": "Elixir Client Intake",
  "fields": [                       // drives prompt generation + normalization
    { "key": "client_name", "type": "string", "description": "Full legal name" },
    { "key": "total", "type": "number" }
    // type: "string" | "number" | "boolean" (default string)
  ],
  "prompt": null,                   // null → auto-generate; string → full override
  "model": null,                    // null → service default
  "base_url": null,                 // null → service default
  "temperature": 0,
  "storage": "none",                // "none" | "local" | "supabase" (phase 2)
  "owner_id": null,                 // reserved: see Supabase phase
  "branding": { "title": "...", "subtitle": "...", "accent": "#2563eb" },
  "api_key": null                   // when set: extractions require X-API-Key
}
```

### 5.2 Prompt generation (critical — do not change the style)

GLM-OCR Q8_0 **mimics prose and emits invalid JSON** if given bullet-style
field lists (observed: `vendor (string): "Acme"`, unquoted dates
`2026-09-30`). The working prompt is a **literal JSON template** plus notes:

```
Extract the requested information from this document. Return only valid JSON
in exactly this shape, filling in the values from the document. Use null for
any value that is not visible. If the document contains several records,
return an array of such objects. Do not use markdown or commentary.
JSON shape: {"vendor":"","total":0,"invoice_date":""}
Field notes: vendor = Company that issued the invoice; total = Total amount due
```

(String fields → `""`, number → `0`, boolean → `false` placeholders. `null`
placeholders were tested and made the model drop date quotes — do not use.)

The parser (`parseModelJson`) must stay tolerant, in order: fenced/trimmed
text → JSON.parse → outermost `{...}` or `[...]` slice → retry all candidates
with `repairCommonSlips` (regex quoting bare ISO dates:
`/(:\s*)((?:\d{4})-(?:\d{2})-(?:\d{2}))(?=\s*[,}\]])/g` → `'$1"$2"'`).

### 5.3 API endpoints

Existing (implemented, tested):

| Endpoint | Notes |
|---|---|
| `POST /api/extract` | multipart `file` + optional `profile` id, or inline `fields` (JSON) / `prompt`; optional `model`, `base_url`, `temperature` overrides (body > profile > service default). Returns `{ text, data, record_id?, profile, reasoning, pages, usage }` |
| `GET/POST /api/profiles`, `GET/PUT/DELETE /api/profiles/:id` | `GET` includes `effective_prompt`, never `api_key`; PUT keeps stored key if `api_key` omitted; `devconsole` delete blocked |
| `GET /api/extractions` | `?app_id=&limit=` |
| `GET /api/extractions/:id` | single record (see §6 — pending verification) |
| `GET /api/config` | defaults + `max_pdf_pages`, `max_upload_mb` |
| `GET /api/models?base_url=` | proxies model list |
| `POST /api/ocr` | legacy shim (person extraction + legacy tables). Keep working; do not extend |

Planned additions:

| Endpoint | Phase |
|---|---|
| `POST /api/extract` gains optional `reference_id` and `owner_id` form fields | 0 |
| `GET /api/extractions` gains `?reference_id=` filter | 0 |
| Supabase storage mode (profile `storage: "supabase"`) writes to `ocr_extractions` | 2 |
| Optional: `GET /api/health` (llama-server reachability, DB ok) | 1 |

### 5.4 SQLite (local mode)

`ocr.db` tables: `ocr_records`, `people` (legacy — keep, never drop),
`app_profiles (id TEXT PK, name, config JSON, created_at, updated_at)`,
`extractions (id, app_id, reference_id, source_file, extracted_text, data_json,
raw_response, created_at)`. Migrations via `PRAGMA table_info` checks +
`ALTER TABLE` for added columns (pattern exists in `db.ts::addMissingColumn`).

### 5.5 Supabase (dedicated project) — migration file

Owner creates a fresh free-tier Supabase project (e.g. name `ocr-service`).
The repo ships this migration (also executed by the service at startup with
the service-role key — keep the two identical):

```sql
-- supabase/migrations/0001_ocr_extractions.sql
create table if not exists public.ocr_extractions (
  id bigint generated always as identity primary key,
  app_id text not null,
  reference_id text,
  owner_id text,
  source_file text,
  extracted_text text,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ocr_extractions_app_ref_idx
  on public.ocr_extractions (app_id, reference_id);
```

Service env additions: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service role).
Implementation suggestion: REST via PostgREST (`POST /rest/v1/ocr_extractions`)
with headers `apikey` + `Authorization: Bearer <service key>` — no extra
dependency needed. Behavior: fail soft (log + still return data to caller) if
Supabase is unreachable. Reads by the dashboard Records screen use the service
key. RLS: leave table closed to anon by default; all access is service-key or
backend-mediated.

### 5.6 Environment variables

| Var | Default | Phase |
|---|---|---|
| `PORT` / `GLM_BASE_URL` / `GLM_MODEL` | `7860` / `http://localhost:8080/v1` / `glm-ocr` | done |
| `MAX_PDF_PAGES` / `MAX_UPLOAD_MB` / `MAX_TOKENS` / `REQUEST_TIMEOUT_MS` | 8 / 25 / 4096 / 900000 | done |
| `LLM_API_KEY` | unset | phase 3 (sent as `Authorization: Bearer` when set; replaces hardcoded `Bearer not-needed` in `llm.ts`) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | unset | phase 2 |

`.env` loading: add a tiny dotenv-style loader (parse `.env` in `config.ts`;
**no new npm dependency required**) and commit `.gitignore` containing `.env`,
`.env.*`, `*.db-shm`, `*.db-wal` before any key is created.

---

## 6. Pending uncommitted work — verify before anything else

**Important:** the working tree contains a full, verified refactor (all of §2)
**plus one half-finished feature** frozen mid-task when the owner said stop:

- `db.ts` — `extractions.reference_id` column + `addMissingColumn` migration
- `storage.ts` — `saveExtraction(..., referenceId)`, `?reference_id` filter,
  `getExtraction(id)`
- `routes.ts` — accepts `reference_id` on extract, filter param,
  `GET /api/extractions/:id`

These are **not** type-checked, **not** tested, and the running service
predates them (it runs the older code from memory). The README does not
document them yet.

Phase 0 must: run `npx tsc -p tsconfig.server.json --noEmit`; restart the
service (see §3); test reference_id round-trip end-to-end (extract with
`reference_id=client-42` on a `storage:"local"` profile → row visible via
`GET /api/extractions?reference_id=client-42` → `GET /api/extractions/:id`
returns it); document the two additions in `readme.md`. Also add `.gitignore`
+ `.env` scaffolding. If verification fails irrecoverably, `git diff` shows the
three touched files; reverting just those hunks is safe.

---

## 7. Build phases

### Phase 0 — Housekeeping & pending additions
1. Verify/activate the pending `reference_id` work (see §6), update README.
2. `.gitignore` (`.env`, `.env.*`, `*.db-shm`, `.db-wal`) + `.env.example`
   documenting every variable.
3. Acceptance: type-check clean; full restart; E2E reference_id test passes;
   `POST /api/ocr` and `POST /api/extract` regression-tested with a generated
   test image; dashboard still loads.

### Phase 1 — Dashboard UI (replaces the single-page console; same visual identity)
Keep the existing "bench" theme (warm gray-green, IBM Plex Sans/Mono, CSS
variables in `src/styles.css`). Layout: left sidebar + content area. Screens:

1. **Profiles** (default): card grid — name, id, field count, chips (storage
   mode, model target, API-key set). "New profile" button.
2. **Profile editor**: id (slug), name; **fields builder** (rows: key, type
   dropdown string/number/boolean, description; add/remove/reorder) with live
   `effective_prompt` preview (fetch from server); prompt toggle (auto vs
   custom textarea); model settings (`base_url`, model `<datalist>` from
   `/api/models`, temperature); storage radio (none/local/supabase);
   branding (title, subtitle, accent color) with mini preview; API key
   generate/clear; **Paste-JSON import** button (D7): accepts
   `[{"key":...}]` or `{"fields":[...]}` or a form-definition object with a
   `fields` array — parse leniently, populate the builder, owner reviews
   before save. Errors shown inline.
3. **Records**: table (id, profile, filename, created, JSON preview), filters
   by profile + reference_id search, row → detail view (structured JSON +
   extracted text, copy/download). Reads `/api/extractions*`.
4. **Playground**: current upload screen, moved. Profile picker applies
   branding; shows structured `data` (editable pre-fill form comes in phase 4).
5. **Settings**: service defaults from `/api/config`, llama-server health
   check (call `/api/models`), Supabase connection status (phase 2).

Routing: simple client-side tabs or `react-router` (prefer plain state tabs —
no new dependency). Split `App.tsx` into `src/dashboard/` components
(`ProfilesPage`, `ProfileEditor`, `RecordsPage`, `PlaygroundPage`,
`SettingsPage`, shared `api.ts` client). Keep `GET /api/profiles/:id` as the
editor's data source; PUT for saves.

Acceptance: create/edit/delete a profile entirely in the UI; paste-JSON import
populates fields; records screen lists seeded history; playground extraction
works; branding preview matches applied branding; `npm run build` passes.

### Phase 2 — Supabase storage mode
1. Owner creates the dedicated Supabase project and puts `SUPABASE_URL` +
   `SUPABASE_SERVICE_KEY` in `.env` (never committed).
2. Migration file committed (`supabase/migrations/0001_ocr_extractions.sql`,
   SQL in §5.5); service auto-creates the identical table at startup when
   Supabase env is present (idempotent `create table if not exists`).
3. Profile `storage: "supabase"`: on extract (and only for stored profiles),
   insert row `{app_id, reference_id, owner_id, source_file, extracted_text,
   data, created_at}` via PostgREST; extend `POST /api/extract` to accept
   `owner_id`; local SQLite row not written in this mode.
4. Records screen: if Supabase configured, add a source toggle (Local /
   Supabase) reading via the service key; else hide the toggle.
5. Acceptance: with Supabase env set, an extraction appears in the Supabase
   table (verify in Supabase dashboard SQL editor); with env unset, behavior
   identical to today + clear log line "Supabase not configured".

### Phase 3 — File-type router + model API key
1. Router in `files.ts`/new `pipeline.ts`, by true type (MIME + extension +
   magic bytes where cheap):
   - **Digital PDF** (has text layer): extract text per page with
     `pdfjs.getTextContent()` (dependency already present) → join → **text-only
     chat completion** to the configured model with the same profile prompt →
     parse with existing `parseModelJson`. No canvas rendering. Target < 1 s/page.
   - **Scanned PDF** (no/sparse text layer): existing render→vision path.
   - **Images** PNG/JPG/WebP/BMP: vision path. GIF: first frame via canvas.
     HEIC/TIFF: rejected with a clear "not supported yet" message (D10).
   - **Office/text** DOCX/XLSX/CSV/TXT/MD/RTF: extract text with local
     libraries (`mammoth` for DOCX, `xlsx`/SheetJS for XLSX/CSV, plain read
     for TXT/MD) → text-only path. New dependencies only here.
   - Everything else: 400 with clear message.
2. Response gains `pipeline: "vision" | "text"` for observability.
3. `LLM_API_KEY` support in `llm.ts` (D: replaces `Bearer not-needed` when
   set) so cloud OpenAI-compatible endpoints become usable; per-profile key
   override optional (`model_api_key` on profile) — only if trivial.
4. Acceptance: same invoice as PDF (digital) extracts via text path
   (`pipeline:"text"`, noticeably faster); a scanned/rasterized PDF goes
   vision; a DOCX with a small table extracts; unsupported file → clean 400.

### Phase 4 — Pre-fill A: editable review form in the dashboard
After a successful Playground (and optionally Records-detail) extraction,
render an editable form generated from the profile's fields — one labeled
input per field (text/number/checkbox by type), prefilled with extracted
values, `null`/empty flagged visually ("not found — check the document").
Buttons: Save (writes an updated record when storage ≠ none; otherwise just a
corrected download payload), Copy JSON, Download JSON. This is the human
verification step — treat as core (real-world scans will misread).

Acceptance: upload a test image with a deliberate OCR-hard value; fix it in
the form; downloaded JSON reflects the fix.

### Phase 5 — Pre-fill B: elixir integration (blocked on owner input)
Requires the elixir codebase (repo URL or local path) + its form definitions.
Shape: elixir backend endpoint forwarding multipart to `/api/extract`
(`profile=elixir-<form>`, `reference_id`/`owner_id` from elixir's context,
`X-API-Key` from elixir env) → frontend fills form state from `data`.
Do not start without the codebase.

---

## 8. Security model (summary)

- Service-role key + profile API keys live only in server `.env` (gitignored).
- Service binds localhost; when split across machines use Tailscale/WireGuard
  + HTTPS reverse proxy before exposing anything.
- Per-profile `api_key` → `X-API-Key` required on `/api/extract`.
- Supabase table not exposed to anon; all reads service-mediated (phase-1).
- Documents processed in memory (`multer.memoryStorage`); nothing written to
  disk; `storage: "none"` profiles leave no trace. Devconsole logs results —
  keep sensitive documents out of it (or on profiles with storage none).
- Sensitive-client flows should pin `storage` + local model (data never
  leaves the machine); cloud models are the owner's per-profile decision.

## 9. Out of scope / future

Async job queue (upload → pending id → poll/realtime) for high concurrency;
GPU hardware or cloud-model overflow for scale; service replicas behind a load
balancer; HEIC/TIFF; MCP server wrapper (lets AI assistants use the service as
a tool — candidate once core is stable); webhook callbacks; multi-tenant
dashboard login (the dashboard is owner-only for now).

## 10. Troubleshooting quick reference

- **Empty response / curl exit 26 on upload test** → Windows curl can't read
  Git Bash `/tmp` paths; use `C:/...` paths.
- **Service "already running" but old behavior** → orphaned node process owns
  port 7860; kill via netstat+taskkill (§3).
- **Model returns prose/unquoted JSON** → prompt must be the JSON-shape
  template (§5.2); parser fallbacks must stay intact.
- **New SQLite column missing on owner's machine** → `addMissingColumn`
  pattern in `db.ts`; bump it alongside any schema change.
- **Vision encoder slow + "CLIP graph uses unsupported operators"** → expected
  on Vulkan/iGPU; hardware-bound, not a bug.
