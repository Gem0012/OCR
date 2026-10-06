import type { Database } from "better-sqlite3";
import { PERSON_FIELDS } from "./legacy.js";
import type { Branding, FieldDef, FieldType, Profile } from "./types.js";

export const DEVCONSOLE_ID = "devconsole";

type ValidationResult = { ok: true; profile: Profile } | { ok: false; error: string };

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function validateFields(value: unknown): { ok: true; fields: FieldDef[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, fields: [] };
  if (!Array.isArray(value)) return { ok: false, error: "fields must be an array of { key, description?, type? }." };
  const fields: FieldDef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: "Each field must be an object with a key." };
    }
    const record = entry as Record<string, unknown>;
    const key = asString(record.key);
    if (!key) return { ok: false, error: "Each field needs a non-empty key." };
    const type = asString(record.type);
    if (type && !["string", "number", "boolean"].includes(type)) {
      return { ok: false, error: `Field ${key} has an unsupported type "${type}" (string, number, or boolean).` };
    }
    fields.push({
      key,
      description: asString(record.description),
      type: (type as FieldType | undefined) || undefined,
    });
  }
  return { ok: true, fields };
}

function validateBranding(value: unknown): Branding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    title: asString(record.title),
    subtitle: asString(record.subtitle),
    accent: asString(record.accent),
  };
}

export function validateProfileInput(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "A profile object is required." };
  }
  const body = input as Record<string, unknown>;
  const id = asString(body.id);
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
    return { ok: false, error: "Profile id is required: lowercase letters, digits, dashes or underscores (max 64 chars)." };
  }
  const name = asString(body.name);
  if (!name) return { ok: false, error: "Profile name is required." };
  const fieldsResult = validateFields(body.fields);
  if (!fieldsResult.ok) return fieldsResult;
  const prompt = asString(body.prompt) || null;
  if (!fieldsResult.fields.length && !prompt) {
    return { ok: false, error: "Declare at least one field, or provide a custom prompt." };
  }
  const temperatureValue = Number(body.temperature ?? 0);
  const storageValue = asString(body.storage) || "none";
  if (!["none", "local", "supabase"].includes(storageValue)) {
    return { ok: false, error: 'storage must be "none" (app persists results itself), "local" (service SQLite), or "supabase" (service Supabase table).' };
  }
  return {
    ok: true,
    profile: {
      id,
      name,
      fields: fieldsResult.fields,
      prompt,
      model: asString(body.model) || null,
      base_url: asString(body.base_url) || null,
      temperature: Number.isFinite(temperatureValue) ? Math.min(Math.max(temperatureValue, 0), 2) : 0,
      storage: storageValue as Profile["storage"],
      branding: validateBranding(body.branding),
      api_key: asString(body.api_key) || null,
    },
  };
}

type ProfileRow = { id: string; name: string; config: string };

function rowToProfile(row: ProfileRow): Profile {
  const parsed = JSON.parse(row.config) as Partial<Profile>;
  return {
    id: row.id,
    name: row.name,
    fields: parsed.fields || [],
    prompt: parsed.prompt || null,
    model: parsed.model || null,
    base_url: parsed.base_url || null,
    temperature: typeof parsed.temperature === "number" ? parsed.temperature : 0,
    storage: parsed.storage === "local" || parsed.storage === "supabase" ? parsed.storage : "none",
    branding: parsed.branding || null,
    api_key: parsed.api_key || null,
  };
}

export function listProfiles(db: Database): Profile[] {
  return (db.prepare("SELECT id, name, config FROM app_profiles ORDER BY id").all() as ProfileRow[]).map(rowToProfile);
}

export function getProfile(db: Database, id: string): Profile | null {
  const row = db.prepare("SELECT id, name, config FROM app_profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function upsertProfile(db: Database, profile: Profile): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO app_profiles (id, name, config, created_at, updated_at)
    VALUES (@id, @name, @config, @now, @now)
    ON CONFLICT(id) DO UPDATE SET name = @name, config = @config, updated_at = @now
  `).run({ id: profile.id, name: profile.name, config: JSON.stringify(profile), now });
}

export function deleteProfile(db: Database, id: string): boolean {
  const result = db.prepare("DELETE FROM app_profiles WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Strips secrets before a profile leaves the service. */
export function publicProfile(profile: Profile): Omit<Profile, "api_key"> & { api_key: null } {
  return { ...profile, api_key: null };
}

function devconsoleProfile(): Profile {
  return {
    id: DEVCONSOLE_ID,
    name: "Developer console",
    fields: PERSON_FIELDS,
    prompt: null,
    model: null,
    base_url: null,
    temperature: 0,
    storage: "local",
    branding: null,
    api_key: null,
  };
}

export function seedProfiles(db: Database): void {
  // The devconsole profile is service-owned: refresh it on every boot so
  // upgrades apply. Other profiles are only seeded into an empty table.
  upsertProfile(db, devconsoleProfile());
  const count = (db.prepare("SELECT COUNT(*) AS count FROM app_profiles").get() as { count: number }).count;
  if (count === 1) return; // only devconsole exists; nothing else to seed today
}
