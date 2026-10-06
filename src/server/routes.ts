import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { createUpload, type UploadRequest } from "./files.js";
import { runModelPages, runTextPages } from "./llm.js";
import { convertUpload } from "./pipeline.js";
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
import { getExtraction, listExtractions, saveExtraction, saveLegacyRecord, updateExtractionData, type ExtractionRow } from "./storage.js";
import { type SupabaseStore } from "./supabase.js";
import type { FieldDef, Profile } from "./types.js";

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
      supabase_configured: Boolean(config.supabaseDbUrl),
    });
  });

  // Live preview of the prompt a profile would send, without saving it.
  app.post("/api/prompt-preview", (request, response) => {
    const body = request.body as { fields?: unknown; prompt?: unknown };
    const manualPrompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;
    const fields: FieldDef[] = Array.isArray(body.fields)
      ? body.fields.flatMap((entry) => {
          const record = (entry ?? {}) as Record<string, unknown>;
          const key = typeof record.key === "string" ? record.key.trim() : "";
          if (!key) return [];
          const description = typeof record.description === "string" && record.description.trim() ? record.description.trim() : undefined;
          const type = record.type === "number" || record.type === "boolean" ? record.type : undefined;
          return [{ key, description, type } as FieldDef];
        })
      : [];
    response.json({ effective_prompt: manualPrompt || buildExtractionPrompt(fields) });
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

  const toExtractionJson = (row: ExtractionRow) => {
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
  };

  // Resolves the Supabase store for source=supabase requests, answering 502
  // with a clear error when the service has no Supabase configured.
  function requireSupabase(response: Response): SupabaseStore | null {
    if (!supabase) {
      response.status(502).json({ error: "Supabase is not configured on this service (set SUPABASE_DB_URL)." });
      return null;
    }
    return supabase;
  }

  app.get("/api/extractions", async (request, response) => {
    const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
    const appId = typeof request.query.app_id === "string" && request.query.app_id ? request.query.app_id : null;
    const referenceId = typeof request.query.reference_id === "string" && request.query.reference_id ? request.query.reference_id : null;
    const source = request.query.source === "supabase" ? "supabase" : "local";
    try {
      const rows = source === "supabase"
        ? await requireSupabase(response)?.listExtractions(appId, referenceId, limit)
        : listExtractions(db, appId, referenceId, limit);
      if (!rows) return;
      response.json({ extractions: rows.map(toExtractionJson) });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "Could not read extractions." });
    }
  });

  app.get("/api/extractions/:id", async (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: "Extraction id must be a positive number." });
    const source = request.query.source === "supabase" ? "supabase" : "local";
    try {
      const row = source === "supabase" ? (await requireSupabase(response)?.getExtraction(id)) ?? null : getExtraction(db, id);
      if (!row) return response.status(404).json({ error: `Extraction #${id} does not exist.` });
      response.json({ extraction: { ...toExtractionJson(row), extracted_text: row.extracted_text } });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "Could not read the extraction." });
    }
  });

  // Human corrections from the dashboard review form.
  app.patch("/api/extractions/:id", async (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1) return response.status(400).json({ error: "Extraction id must be a positive number." });
    const body = request.body as { data?: unknown; source?: string };
    if (body.data == null || (typeof body.data !== "object" && !Array.isArray(body.data))) {
      return response.status(400).json({ error: "Provide the corrected data as a JSON object or array." });
    }
    const source = body.source === "supabase" ? "supabase" : "local";
    try {
      const updated = source === "supabase"
        ? (await requireSupabase(response)) && (await supabase!.updateExtractionData(id, body.data))
        : updateExtractionData(db, id, body.data);
      if (!updated) return response.status(404).json({ error: `Extraction #${id} does not exist.` });
      response.json({ ok: true });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : "Could not update the extraction." });
    }
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
    const chatCore = { target, model, temperature, maxTokens: config.maxTokens, timeoutMs: config.requestTimeoutMs, apiKey: config.llmApiKey };
    try {
      const converted = await convertUpload(file.buffer, file.originalname, file.mimetype, config.maxPdfPages);
      const run = converted.pipeline === "vision"
        ? await runModelPages({ ...chatCore, prompt, urls: converted.urls })
        : await runTextPages({ ...chatCore, prompt, pages: converted.pages });
      const pagesCount = converted.pipeline === "vision" ? converted.urls.length : converted.pages.length;
      const text = joinPages(run.pages);
      const { data } = extractData(run.pages, profile.fields.length ? profile.fields : null);
      const referenceId = body.reference_id || null;
      const ownerId = body.owner_id || null;
      let recordId: number | null = null;
      let storedIn: "local" | "supabase" | undefined;
      let warning: string | undefined;
      if (profile.storage === "supabase") {
        if (supabase) {
          try {
            recordId = await supabase.saveExtraction({
              appId: profile.id,
              referenceId,
              ownerId,
              filename: file.originalname,
              text,
              data,
            });
            storedIn = "supabase";
          } catch (storeError) {
            console.error("Supabase write failed:", storeError instanceof Error ? storeError.message : storeError);
            warning = "The extraction succeeded but writing it to Supabase failed — the result is returned here only.";
          }
        } else {
          warning = 'Profile storage is "supabase" but the service has no SUPABASE_DB_URL configured — the result is returned here only.';
        }
      } else if (profile.storage === "local" || profile.id === DEVCONSOLE_ID) {
        recordId = saveExtraction(db, profile.id, file.originalname, text, data, text, referenceId);
        storedIn = "local";
      }
      response.json({
        text,
        data,
        record_id: recordId ?? undefined,
        stored_in: storedIn,
        warning,
        profile: profile.id,
        reasoning: run.reasoning,
        pages: pagesCount,
        pipeline: converted.pipeline,
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
      const converted = await convertUpload(file.buffer, file.originalname, file.mimetype, config.maxPdfPages);
      const run = converted.pipeline === "vision"
        ? await runModelPages({ target, model, temperature, maxTokens: config.maxTokens, timeoutMs: config.requestTimeoutMs, prompt, urls: converted.urls })
        : await runTextPages({ target, model, temperature, maxTokens: config.maxTokens, timeoutMs: config.requestTimeoutMs, prompt, pages: converted.pages });
      const pagesCount = converted.pipeline === "vision" ? converted.urls.length : converted.pages.length;
      const text = joinPages(run.pages);
      const saved = saveLegacyRecord(db, file.originalname, text);
      response.json({
        text,
        fields: saved.fields,
        record_id: saved.recordId,
        reasoning: run.reasoning,
        pages: pagesCount,
        pipeline: converted.pipeline,
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
