import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { createUpload, imageDataUrls, type UploadRequest } from "./files.js";
import { runModelPages } from "./llm.js";
import { LEGACY_PROMPT, buildExtractionPrompt } from "./prompt.js";
import { extractData } from "./extract.js";
import {
  DEVCONSOLE_ID,
  deleteProfile,
  getProfile,
  listProfiles,
  publicProfile,
  seedProfiles,
  upsertProfile,
  validateProfileInput,
} from "./profiles.js";
import { getExtraction, listExtractions, saveExtraction, saveLegacyRecord } from "./storage.js";
import { type SupabaseStore } from "./supabase.js";
import type { Profile } from "./types.js";

type Body = Record<string, string | undefined>;

function joinPages(pages: string[]): string {
  return pages.length > 1 ? pages.map((page, index) => `--- page ${index + 1} ---\n${page}`).join("\n\n") : pages[0] || "";
}

function effectivePrompt(profile: Profile): string {
  return profile.prompt || buildExtractionPrompt(profile.fields);
}

export function buildApp(config: AppConfig, db: Database, supabase: SupabaseStore | null = null) {
  seedProfiles(db);
  const upload = createUpload(config);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/config", (_request, response) => {
    const devconsole = getProfile(db, DEVCONSOLE_ID);
    response.json({
      base_url: config.baseUrl,
      model: config.defaultModel,
      prompt: devconsole ? effectivePrompt(devconsole) : LEGACY_PROMPT,
      max_pdf_pages: config.maxPdfPages,
      max_upload_mb: config.maxUploadMb,
    });
  });

  app.get("/api/models", async (request, response) => {
    try {
      const url = String(request.query.base_url || config.baseUrl).replace(/\/$/, "");
      const result = await fetch(`${url}/models`);
      if (!result.ok) throw new Error(`Model server returned ${result.status}`);
      const data = await result.json() as { data?: Array<{ id: string }> };
      response.json({ models: (data.data || []).map((model) => model.id) });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "Could not load models." });
    }
  });

  app.get("/api/profiles", (_request, response) => {
    response.json({
      profiles: listProfiles(db).map((profile) => ({ ...publicProfile(profile), effective_prompt: effectivePrompt(profile) })),
    });
  });

  app.post("/api/profiles", (request, response) => {
    const result = validateProfileInput(request.body);
    if (!result.ok) return response.status(400).json({ error: result.error });
    if (getProfile(db, result.profile.id)) {
      return response.status(409).json({ error: `Profile "${result.profile.id}" already exists. Use PUT to update it.` });
    }
    upsertProfile(db, result.profile);
    response.status(201).json({ profile: publicProfile(result.profile) });
  });

  app.get("/api/profiles/:id", (request, response) => {
    const profile = getProfile(db, request.params.id);
    if (!profile) return response.status(404).json({ error: `Profile "${request.params.id}" does not exist.` });
    response.json({ profile: { ...publicProfile(profile), effective_prompt: effectivePrompt(profile) } });
  });

  app.put("/api/profiles/:id", (request, response) => {
    const body: Record<string, unknown> = { ...(request.body as Record<string, unknown>), id: request.params.id };
    const result = validateProfileInput(body);
    if (!result.ok) return response.status(400).json({ error: result.error });
    // An update that omits api_key keeps the stored key instead of clearing it.
    const existing = getProfile(db, request.params.id);
    if (body.api_key === undefined && existing) result.profile.api_key = existing.api_key;
    upsertProfile(db, result.profile);
    response.json({ profile: publicProfile(result.profile) });
  });

  app.delete("/api/profiles/:id", (request, response) => {
    if (request.params.id === DEVCONSOLE_ID) {
      return response.status(400).json({ error: "The developer console profile cannot be deleted." });
    }
    if (!deleteProfile(db, request.params.id)) {
      return response.status(404).json({ error: `Profile "${request.params.id}" does not exist.` });
    }
    response.json({ ok: true });
  });

  app.get("/api/extractions", (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
    const appId = typeof request.query.app_id === "string" && request.query.app_id ? request.query.app_id : null;
    const referenceId = typeof request.query.reference_id === "string" && request.query.reference_id ? request.query.reference_id : null;
    response.json({
      extractions: listExtractions(db, appId, referenceId, limit).map((row) => {
        let data: unknown = null;
        try {
          data = JSON.parse(row.data_json);
        } catch {
          data = null;
        }
        return {
          id: row.id,
          app_id: row.app_id,
          reference_id: row.reference_id,
          source_file: row.source_file,
          data,
          created_at: row.created_at,
        };
      }),
    });
  });

  app.get("/api/extractions/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: "Extraction id must be a positive number." });
    const row = getExtraction(db, id);
    if (!row) return response.status(404).json({ error: `Extraction #${id} does not exist.` });
    let data: unknown = null;
    try {
      data = JSON.parse(row.data_json);
    } catch {
      data = null;
    }
    response.json({
      extraction: {
        id: row.id,
        app_id: row.app_id,
        reference_id: row.reference_id,
        source_file: row.source_file,
        extracted_text: row.extracted_text,
        data,
        created_at: row.created_at,
      },
    });
  });

  app.post("/api/extract", upload.single("file"), async (request: UploadRequest, response) => {
    const file = request.file;
    if (!file?.buffer.length) return response.status(400).json({ error: "That file came through empty." });
    const body = request.body as Body;
    let profile: Profile;
    if (body.profile) {
      const found = getProfile(db, body.profile);
      if (!found) return response.status(404).json({ error: `Profile "${body.profile}" does not exist.` });
      if (found.api_key && request.header("x-api-key") !== found.api_key) {
        return response.status(401).json({ error: "Missing or wrong X-API-Key header for this profile." });
      }
      profile = found;
    } else {
      // Ad-hoc call: fields and/or prompt travel with the request itself.
      let fields: unknown;
      if (body.fields) {
        try {
          fields = JSON.parse(body.fields);
        } catch {
          return response.status(400).json({ error: 'fields must be valid JSON, e.g. [{"key":"vendor"}].' });
        }
      }
      const adHoc = validateProfileInput({ id: "adhoc", name: "Ad hoc", fields, prompt: body.prompt });
      if (!adHoc.ok) return response.status(400).json({ error: adHoc.error });
      profile = adHoc.profile;
    }

    const prompt = body.prompt || effectivePrompt(profile);
    const model = body.model || profile.model || config.defaultModel;
    const target = (body.base_url || profile.base_url || config.baseUrl).replace(/\/$/, "");
    const temperature = body.temperature ? Number(body.temperature) : profile.temperature;
    try {
      const urls = await imageDataUrls(file.buffer, file.originalname, file.mimetype, config.maxPdfPages);
      const run = await runModelPages({ target, model, temperature, maxTokens: config.maxTokens, timeoutMs: config.requestTimeoutMs, prompt, urls });
      const text = joinPages(run.pages);
      const { data } = extractData(run.pages, profile.fields.length ? profile.fields : null);
      const recordId = profile.storage === "local" || profile.id === DEVCONSOLE_ID
        ? saveExtraction(db, profile.id, file.originalname, text, data, text, body.reference_id || null)
        : null;
      response.json({
        text,
        data,
        record_id: recordId ?? undefined,
        profile: profile.id,
        reasoning: run.reasoning,
        pages: urls.length,
        usage: { prompt_tokens: run.promptTokens, completion_tokens: run.completionTokens },
      });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "OCR request failed." });
    }
  });

  app.post("/api/ocr", upload.single("file"), async (request: UploadRequest, response) => {
    const file = request.file;
    if (!file?.buffer.length) return response.status(400).json({ error: "That file came through empty." });
    const body = request.body as Body;
    const devconsole = getProfile(db, DEVCONSOLE_ID);
    const prompt = body.prompt || (devconsole ? effectivePrompt(devconsole) : LEGACY_PROMPT);
    const model = body.model || config.defaultModel;
    const target = (body.base_url || config.baseUrl).replace(/\/$/, "");
    const temperature = Number(body.temperature || 0);
    try {
      const urls = await imageDataUrls(file.buffer, file.originalname, file.mimetype, config.maxPdfPages);
      const run = await runModelPages({ target, model, temperature, maxTokens: config.maxTokens, timeoutMs: config.requestTimeoutMs, prompt, urls });
      const text = joinPages(run.pages);
      const saved = saveLegacyRecord(db, file.originalname, text);
      response.json({
        text,
        fields: saved.fields,
        record_id: saved.recordId,
        reasoning: run.reasoning,
        pages: urls.length,
        usage: { prompt_tokens: run.promptTokens, completion_tokens: run.completionTokens },
      });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "OCR request failed." });
    }
  });

  if (existsSync(config.distDir)) {
    app.use(express.static(config.distDir));
    app.use((_request: Request, response: Response, next: NextFunction) => {
      if (response.req.method === "GET") {
        response.sendFile(join(config.distDir, "index.html"));
        return;
      }
      next();
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof MulterError) {
      const message = error.code === "LIMIT_FILE_SIZE" ? `File is larger than the ${config.maxUploadMb} MB limit.` : error.message;
      response.status(400).json({ error: message });
      return;
    }
    const message = error instanceof Error ? error.message : "Request failed.";
    response.status(400).json({ error: message });
  });

  return app;
}
