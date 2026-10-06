# GLM OCR service

A local, reusable document-extraction service. Apps register a **profile**
declaring the fields they want; the service builds the extraction prompt from
that field list, runs the document through a vision-capable llama-server, and
returns normalized JSON. The apps keep their own data — the service is
stateless for them by default.

Built with React, TypeScript, Express, and SQLite. `OCR_FEATURE_GUIDE.md`
is the original prototype's feature doc, kept for reference.

**Roadmap & handoff:** see [`BUILD_PLAN.md`](./BUILD_PLAN.md) — the master
build plan (dashboard, Supabase storage, file-type router). Development
happens on the `OCR-ZCODE` branch; `main` holds the latest stable checkpoint.

## Requirements

- Node.js 20 or newer and npm
- A vision-capable `llama-server`
- The GLM-OCR GGUF model and matching vision projector (`mmproj`)

## Start llama-server

```powershell
llama-server.exe -hf ggml-org/GLM-OCR-GGUF:Q8_0 -c 12000 -ngl 99 --flash-attn off -fit off
```

Or point at downloaded files:

```powershell
llama-server.exe `
  -m .\GLM-OCR-Q8_0.gguf `
  --mmproj .\mmproj-GLM-OCR-Q8_0.gguf `
  -c 12000 -ngl 99 --flash-attn off -fit off
```

Model files: [`ggml-org/GLM-OCR-GGUF`](https://huggingface.co/ggml-org/GLM-OCR-GGUF).
Default model-server URL: `http://localhost:8080/v1` (change via `GLM_BASE_URL`
or per profile).

## Install and run

```powershell
npm install
npm start
```

Open `http://localhost:7860` for the developer console.

## How apps use it

An app registers a profile once, then just sends files.

**1. Register a profile** (fields drive the generated prompt and the output
normalization — no prompt writing required):

```bash
curl -X POST http://localhost:7860/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "id": "invoice-app",
    "name": "Invoice Processor",
    "fields": [
      { "key": "vendor", "type": "string", "description": "Company that issued the invoice" },
      { "key": "total", "type": "number", "description": "Total amount due" },
      { "key": "invoice_date", "type": "string" },
      { "key": "invoice_number", "type": "string" }
    ],
    "storage": "none"
  }'
```

**2. Extract** (multipart upload; the model reads the file, the response
carries normalized `data`):

```bash
curl -X POST http://localhost:7860/api/extract \
  -F "file=@scan.png" \
  -F "profile=invoice-app"
```

```json
{
  "text": "{ \"vendor\": \"Acme Supplies Ltd\", ... }",
  "data": { "vendor": "Acme Supplies Ltd", "total": 1249.5, "invoice_date": "2026-09-30", "invoice_number": "INV-2026-0042" },
  "profile": "invoice-app",
  "pages": 1,
  "usage": { "prompt_tokens": 366, "completion_tokens": 68 }
}
```

The app persists `data` wherever it wants (its own database, e.g. Supabase).
With `storage: "none"` (the default) the service keeps nothing.

**Ad-hoc, no registration:** send `fields` (JSON) and/or `prompt` directly —
`-F 'fields=[{"key":"vendor"},{"key":"total","type":"number"}]'`.

### Profile fields

| Field | Default | Purpose |
| --- | --- | --- |
| `id` | required | Slug used in API calls (`[a-z0-9][a-z0-9_-]{0,63}`) |
| `name` | required | Display name |
| `fields` | `[]` | Extraction fields: `{ key, description?, type? }`, type `string` \| `number` \| `boolean` |
| `prompt` | auto | Custom prompt; overrides field-based generation when set |
| `model` | service default | Model name sent to the model server |
| `base_url` | service default | Per-app llama-server URL |
| `temperature` | `0` | Sampling temperature |
| `storage` | `"none"` | `"local"` also stores each result in the service's `extractions` table |
| `branding` | `null` | `{ title?, subtitle?, accent? }` for UI consumers |
| `api_key` | `null` | When set, extractions with this profile require the `X-API-Key` header |

The generated prompt is a literal JSON template plus field notes — small OCR
models follow that far more reliably than prose instructions. Multi-page PDFs
are parsed per page and merged into one result.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/extract` | Multipart: `file` + `profile` id, or inline `fields`/`prompt`. Optional overrides: `model`, `base_url`, `temperature`. Optional tags: `reference_id`, `owner_id` (your app's own record/user id, stored with results kept by the service). Body values beat profile values beat service defaults. |
| `GET/POST /api/profiles` | List / register profiles |
| `GET/PUT/DELETE /api/profiles/:id` | Read / replace / remove a profile (`devconsole` is protected). `GET` responses include the computed `effective_prompt` and never the stored `api_key`. On `PUT`, omitting `api_key` keeps the stored key. |
| `GET /api/extractions?app_id=&reference_id=&limit=` | Rows stored by profiles with local storage, filterable by your `reference_id` |
| `GET /api/extractions/:id` | One record, including the raw extracted text (404 if missing) |
| `GET /api/config` | Service defaults (URL, model, prompt, page/upload limits) |
| `GET /api/models?base_url=` | Models offered by a model server |
| `POST /api/ocr` | Legacy prototype endpoint (writes `ocr_records` + `people`); kept for compatibility — prefer `/api/extract` |

Uploads: PNG, JPEG, WebP, or PDF (first `MAX_PDF_PAGES` pages), up to
`MAX_UPLOAD_MB` per file. Errors: `400` bad request/file, `401` missing or
wrong `X-API-Key`, `404` unknown profile, `409` duplicate profile id, `502`
model-server failure.

## Developer console

`http://localhost:7860` is a testing UI: pick a profile (its branding and
generated prompt load in), drop an image/PDF, click **Read it**, and inspect
the raw text plus the structured `data` JSON. It is a tool for humans — apps
should call the API.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7860` | Service port |
| `GLM_BASE_URL` | `http://localhost:8080/v1` | Default llama-server URL |
| `GLM_MODEL` | `glm-ocr` | Default model name |
| `MAX_PDF_PAGES` | `8` | PDF pages processed per document |
| `MAX_UPLOAD_MB` | `25` | Upload size limit |
| `MAX_TOKENS` | `4096` | `max_tokens` per model request |
| `REQUEST_TIMEOUT_MS` | `900000` | Per-request model timeout |

## Development mode

Terminal 1: `npm run server` — API on `http://127.0.0.1:7860`.
Terminal 2: `npm run dev` — Vite on `http://localhost:5173`, proxying `/api`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run build` | Type-check app + server, build the frontend |
| `npm run server` | Start the API server |
| `npm start` | Build, then serve production |

Server code lives in `src/server/`: `config.ts` (env), `db.ts` (SQLite),
`profiles.ts` (profile CRUD + seeding), `prompt.ts` (prompt generation +
tolerant JSON parsing), `extract.ts` (field normalization), `llm.ts` (model
client), `files.ts` (uploads, PDF rasterizing), `storage.ts` (record writes),
`routes.ts` (endpoints), `main.ts` (wiring).

## SQLite storage

`ocr.db` (WAL mode). Tables:

- `app_profiles` — registered app profiles (JSON config per row)
- `extractions` — results of profiles with local storage
- `ocr_records`, `people` — legacy prototype tables, only written by the
  legacy `POST /api/ocr` endpoint; kept so old data stays readable

## Supabase (dedicated project, planned)

The service will support `storage: "supabase"` profiles that write each
extraction into an `ocr_extractions` table in the service's own Supabase
project. The schema ships as
[`supabase/migrations/0001_ocr_extractions.sql`](./supabase/migrations/0001_ocr_extractions.sql)
— run it once in your project's SQL editor, or set `SUPABASE_DB_URL`
(see `.env.example`) and let the service create the identical table at
startup. Runtime wiring is in progress — see `BUILD_PLAN.md` Phase 2.

## Troubleshooting

- **No server answered at `/v1`** — llama-server is a separate process; verify
  it listens on port `8080`.
- **Model refuses image input** — start llama-server with the matching
  `--mmproj` vision projector.
- **Garbled or non-JSON output** — keep temperature at `0`, use a matching
  model/projector pair, start llama-server with `--flash-attn off -fit off`.
- **Native dependency install fails** — `better-sqlite3` and `@napi-rs/canvas`
  ship native components; use a current Node LTS and rerun `npm install`.
