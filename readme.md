# GLM OCR tester

A local OCR web application built with React, TypeScript, Express, and SQLite.
Upload an image or PDF, send it to a vision-capable llama-server, view the
extracted text, download the result as JSON, and store normalized person details
in SQLite.

## Requirements

- Node.js 20 or newer
- npm
- A vision-capable `llama-server`
- The GLM-OCR GGUF model and matching vision projector (`mmproj`)

## Start llama-server

Download the official GLM-OCR model files from
[`ggml-org/GLM-OCR-GGUF`](https://huggingface.co/ggml-org/GLM-OCR-GGUF).

Start llama-server with the model and matching projector:

```powershell
llama-server.exe `
  -m .\GLM-OCR-Q8_0.gguf `
  --mmproj .\mmproj-GLM-OCR-Q8_0.gguf `
  -c 12000 `
  -ngl 99 `
  --flash-attn off `
  -fit off
```

Alternatively, let llama-server download the model:

```powershell
llama-server.exe -hf ggml-org/GLM-OCR-GGUF:Q8_0
```

The model server should be available at:

```text
http://localhost:8080/v1
```

The OCR app can use a different URL through the **Server** field in the UI or
the `GLM_BASE_URL` environment variable.

## Install and run

From the project directory:

```powershell
npm install
npm start
```

Open:

```text
http://localhost:7860
```

`npm start` builds the React frontend and starts the TypeScript/Express server.
The server serves the production frontend from `dist/`.

## Development mode

Run the API server and Vite frontend in separate terminals.

Terminal 1:

```powershell
npm run server
```

Terminal 2:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

Vite proxies `/api` requests to `http://127.0.0.1:7860`.

## Available scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and build the React frontend |
| `npm run server` | Start the TypeScript/Express API server |
| `npm start` | Build the frontend and start the production server |
| `npm run preview` | Preview the Vite production build |

## Configuration

The server reads these optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7860` | Port used by the TypeScript server |
| `GLM_BASE_URL` | `http://localhost:8080/v1` | llama-server OpenAI-compatible API URL |
| `GLM_MODEL` | `glm-ocr` | Default model name sent to llama-server |

PowerShell example:

```powershell
$env:GLM_BASE_URL = "http://localhost:8080/v1"
$env:GLM_MODEL = "glm-ocr"
npm start
```

## Using the application

1. Start llama-server.
2. Start the OCR app with `npm start`.
3. Open `http://localhost:7860`.
4. Choose or drop an image/PDF.
5. Confirm the server URL, model, and extraction prompt.
6. Click **Read it**.
7. View the extracted text and download the complete response with **Download JSON**.

Supported uploads:

- PNG
- JPEG/JPG
- WebP
- PDF

PDFs are rendered server-side. The first eight pages are processed, one model
request per page.

## Extraction format

The default prompt asks the model to return JSON with these fields:

```json
{
  "name": null,
  "date_of_birth": null,
  "address": null,
  "phone": null,
  "email": null,
  "details": null
}
```

Missing values should be returned as `null`. If a document contains multiple
people, each person is stored as a separate row in the `people` table.

## SQLite storage

The local database is:

```text
ocr.db
```

The server creates and maintains these tables:

### `ocr_records`

Stores the complete OCR request and response:

- `id`
- `source_file`
- `extracted_text`
- `extracted_json`
- `raw_response`
- `created_at`

### `people`

Stores normalized person data:

- `id`
- `ocr_record_id`
- `name`
- `date_of_birth`
- `address`
- `phone`
- `email`
- `details`

The database uses SQLite WAL mode. Do not delete `ocr.db` unless you intend to
remove the stored OCR records and normalized people data.

## API endpoints

### `GET /api/config`

Returns the configured default llama-server URL, model, and extraction prompt.

### `GET /api/models?base_url=...`

Loads available models from the configured llama-server.

### `POST /api/ocr`

Accepts a multipart form upload with:

- `file`
- `prompt`
- `model`
- `base_url`
- `temperature`

Returns the extracted text, parsed fields, database record ID, reasoning, page
count, and token usage.

## Troubleshooting

### No server answered at `/v1`

Start llama-server and verify that it is listening on port `8080`. The OCR
application and llama-server are separate processes.

### The model refuses image input

Make sure the matching `--mmproj` vision projector is included when starting
llama-server.

### Garbled OCR output

Use a compatible GLM-OCR model/projector pair, keep temperature at `0`, and
start llama-server with:

```text
--flash-attn off -fit off
```

### Native dependency installation fails

`better-sqlite3` and `@napi-rs/canvas` include native components. Use a current
Node.js LTS release and rerun:

```powershell
npm install
```
