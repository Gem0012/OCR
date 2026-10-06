import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { seedProfiles } from "./profiles.js";
import { buildApp } from "./routes.js";
import { openSupabaseStore, type SupabaseStore } from "./supabase.js";

export function startServer({ rootDir }: { rootDir: string }) {
  const config = loadConfig(rootDir);
  const db = openDatabase(config.databasePath);
  seedProfiles(db);

  let supabase: SupabaseStore | null = null;
  if (config.supabaseDbUrl) {
    supabase = openSupabaseStore(config.supabaseDbUrl);
    supabase.ensureSchema().catch((error) => {
      console.error("Supabase schema setup failed:", error instanceof Error ? error.message : error);
    });
  } else {
    console.log("Supabase: not configured (set SUPABASE_DB_URL to enable storage mode \"supabase\").");
  }

  const app = buildApp(config, db, supabase);
  app.listen(config.port, () => {
    console.log(`GLM OCR service running at http://127.0.0.1:${config.port}`);
    console.log(`Apps: POST /api/profiles to register, POST /api/extract to read documents.`);
  });
}
