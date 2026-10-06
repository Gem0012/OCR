import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export type AppConfig = {
  port: number;
  rootDir: string;
  distDir: string;
  databasePath: string;
  baseUrl: string;
  defaultModel: string;
  maxPdfPages: number;
  maxUploadMb: number;
  requestTimeoutMs: number;
  maxTokens: number;
  llmApiKey: string;
  supabaseDbUrl: string;
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Minimal .env loader: fills process.env from <rootDir>/.env without
 *  overriding values already set in the real environment. */
function loadDotEnv(rootDir: string) {
  const path = join(rootDir, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(rootDir: string): AppConfig {
  loadDotEnv(rootDir);
  return {
    port: envNumber("PORT", 7860),
    rootDir,
    distDir: join(rootDir, "dist"),
    databasePath: join(rootDir, "ocr.db"),
    baseUrl: process.env.GLM_BASE_URL || "http://localhost:8080/v1",
    defaultModel: process.env.GLM_MODEL || "glm-ocr",
    maxPdfPages: envNumber("MAX_PDF_PAGES", 8),
    maxUploadMb: envNumber("MAX_UPLOAD_MB", 25),
    requestTimeoutMs: envNumber("REQUEST_TIMEOUT_MS", 900_000),
    maxTokens: envNumber("MAX_TOKENS", 4096),
    llmApiKey: process.env.LLM_API_KEY || "",
    supabaseDbUrl: process.env.SUPABASE_DB_URL || "",
  };
}
