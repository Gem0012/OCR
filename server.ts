import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request } from "express";
import multer from "multer";
import Database from "better-sqlite3";
import { createCanvas } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 7860);
const dist = join(here, "dist");
const databasePath = join(here, "ocr.db");
const baseUrl = process.env.GLM_BASE_URL || "http://localhost:8080/v1";
const defaultModel = process.env.GLM_MODEL || "glm-ocr";
const defaultPrompt =
  "Extract the person information from this image and return only valid JSON. " +
  "Use exactly these keys: name, date_of_birth, address, phone, email, details. " +
  "Use null for missing values. Preserve all other visible text in details. " +
  "Do not use markdown or commentary.";
const maxPdfPages = 8;
const upload = multer({ storage: multer.memoryStorage() });
const app = express();

type Fields = Record<string, unknown>;
type UploadedRequest = Request & { file?: Express.Multer.File };

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS ocr_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file TEXT,
    extracted_text TEXT NOT NULL,
    extracted_json TEXT NOT NULL,
    raw_response TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ocr_record_id INTEGER NOT NULL,
    name TEXT,
    date_of_birth TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    details TEXT
  );
`);

function parseJsonObject(text: string): Fields {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value: unknown = JSON.parse(candidate);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : {};
  } catch {
    return {};
  }
}

function personRecords(fields: Fields): Fields[] {
  const keys = ["name", "date_of_birth", "address", "phone", "email", "details"];
  if (keys.some((key) => Object.keys(fields).some((field) => field.toLowerCase() === key))) return [fields];
  return Object.values(fields).filter((value): value is Fields =>
    Boolean(value && typeof value === "object" && !Array.isArray(value) &&
      keys.some((key) => Object.keys(value).some((field) => field.toLowerCase() === key))));
}

function normalizedPerson(fields: Fields) {
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    const normalized = key.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
    if (["name", "date_of_birth", "address", "phone", "email", "details"].includes(normalized)) {
      result[normalized] = typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
    }
  }
  return result;
}

function saveRecord(filename: string, text: string, rawResponse: string) {
  const fields = parseJsonObject(text);
  const storedFields = Object.keys(fields).length ? fields : { extracted_text: text };
  const insert = db.prepare(`
    INSERT INTO ocr_records (source_file, extracted_text, extracted_json, raw_response, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const record = insert.run(filename, text, JSON.stringify(storedFields), rawResponse, new Date().toISOString());
  const recordId = Number(record.lastInsertRowid);
  const peopleInsert = db.prepare(`
    INSERT INTO people (ocr_record_id, name, date_of_birth, address, phone, email, details)
    VALUES (@ocr_record_id, @name, @date_of_birth, @address, @phone, @email, @details)
  `);
  for (const person of personRecords(storedFields)) {
    const normalized = normalizedPerson(person);
    peopleInsert.run({
      ocr_record_id: recordId,
      name: normalized.name ?? null,
      date_of_birth: normalized.date_of_birth ?? null,
      address: normalized.address ?? null,
      phone: normalized.phone ?? null,
      email: normalized.email ?? null,
      details: normalized.details ?? null,
    });
  }
  return { recordId, fields: storedFields };
}

async function imageDataUrls(buffer: Buffer, filename: string): Promise<string[]> {
  if (!filename.toLowerCase().endsWith(".pdf")) {
    const mime = filename.toLowerCase().endsWith(".jpg") || filename.toLowerCase().endsWith(".jpeg")
      ? "image/jpeg" : filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/png";
    return [`data:${mime};base64,${buffer.toString("base64")}`];
  }
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const urls: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPdfPages); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
    urls.push(`data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`);
  }
  return urls;
}

app.get("/api/config", (_request, response) => response.json({ base_url: baseUrl, model: defaultModel, prompt: defaultPrompt }));
app.get("/api/models", async (request, response) => {
  try {
    const url = String(request.query.base_url || baseUrl).replace(/\/$/, "");
    const result = await fetch(`${url}/models`);
    if (!result.ok) throw new Error(`Model server returned ${result.status}`);
    const data = await result.json() as { data?: Array<{ id: string }> };
    response.json({ models: (data.data || []).map((model) => model.id) });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Could not load models." });
  }
});

app.post("/api/ocr", upload.single("file"), async (request: UploadedRequest, response) => {
  const file = request.file;
  if (!file?.buffer.length) return response.status(400).json({ error: "That file came through empty." });
  const prompt = String(request.body.prompt || defaultPrompt);
  const model = String(request.body.model || defaultModel);
  const target = String(request.body.base_url || baseUrl).replace(/\/$/, "");
  const temperature = Number(request.body.temperature || 0);
  try {
    const urls = await imageDataUrls(file.buffer, file.originalname);
    const pages: string[] = [];
    const reasoning: string[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    for (let index = 0; index < urls.length; index += 1) {
      const result = await fetch(`${target}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer not-needed" },
        body: JSON.stringify({
          model, temperature, max_tokens: 4096,
          messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: urls[index] } },
            { type: "text", text: prompt },
          ] }],
        }),
        signal: AbortSignal.timeout(900_000),
      });
      if (!result.ok) throw new Error(`Server returned ${result.status}: ${(await result.text()).slice(0, 500)}`);
      const data = await result.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }>; reasoning_content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("Unexpected response shape from the model server.");
      const text = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : message.content || "";
      pages.push(text.trim());
      if (message.reasoning_content) reasoning.push(message.reasoning_content.trim());
      promptTokens += data.usage?.prompt_tokens || 0;
      completionTokens += data.usage?.completion_tokens || 0;
    }
    const text = pages.length > 1 ? pages.map((page, index) => `--- page ${index + 1} ---\n${page}`).join("\n\n") : pages[0] || "";
    const saved = saveRecord(file.originalname, text, text);
    response.json({ text, fields: saved.fields, record_id: saved.recordId, reasoning: reasoning.join("\n\n"), pages: urls.length, usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "OCR request failed." });
  }
});

if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((_request, response, next) => {
    if (response.req.method === "GET") {
      response.sendFile(join(dist, "index.html"));
      return;
    }
    next();
  });
}

app.listen(port, () => console.log(`GLM OCR app running at http://127.0.0.1:${port}`));
