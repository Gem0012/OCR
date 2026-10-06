import { useEffect, useState } from "react";
import { api, type FieldDef, type FieldType, type Profile, type StorageMode } from "./api";
import { FieldRow } from "./ui";

type KeyAction = { action: "keep" } | { action: "clear" } | { action: "set"; value: string };

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "ocr_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeType(value: unknown): FieldType {
  const text = String(value ?? "").toLowerCase();
  if (["number", "int", "integer", "float", "decimal"].includes(text)) return "number";
  if (["bool", "boolean"].includes(text)) return "boolean";
  return "string";
}

/** Lenient parser for the paste-JSON import. Accepts:
 *  [ {"key": "..."} ]                      — a plain field array
 *  {"fields": [...], "name"?: "..."}       — a form definition object
 *  {"vendor": "string", "total": "number"} — a key -> type map
 *  {"vendor": {"type": "...", "description": "..."}} — key -> descriptor map */
function parseImportedFields(text: string): { fields: FieldDef[]; name?: string } {
  const parsed = JSON.parse(text) as unknown;
  const fromEntry = (entry: unknown): FieldDef | null => {
    if (!entry || typeof entry !== "object") {
      if (typeof entry === "string") return { key: entry, type: "string" };
      return null;
    }
    const record = entry as Record<string, unknown>;
    const key = record.key ?? record.name ?? record.label ?? record.field;
    if (typeof key !== "string" || !key.trim()) return null;
    const description = typeof record.description === "string" ? record.description : undefined;
    const type = record.type != null || record.dataType != null ? normalizeType(record.type ?? record.dataType) : undefined;
    return { key: key.trim(), description: description?.trim() || undefined, type };
  };
  let rawFields: unknown[];
  let name: string | undefined;
  if (Array.isArray(parsed)) {
    rawFields = parsed;
  } else if (parsed && typeof parsed === "object") {
    const object = parsed as Record<string, unknown>;
    if (Array.isArray(object.fields)) {
      rawFields = object.fields;
      if (typeof object.name === "string") name = object.name;
      if (typeof object.title === "string" && !name) name = object.title;
    } else {
      rawFields = Object.entries(object).map(([key, value]) => {
        if (value == null || value === "") return { key };
        if (typeof value === "string" || typeof value === "number") return { key, type: value };
        if (typeof value === "object" && !Array.isArray(value)) return { key, ...(value as object) };
        return { key, description: String(value) };
      });
    }
  } else {
    throw new Error("Paste a JSON array of fields or a form object.");
  }
  const fields = rawFields.map(fromEntry).filter((field): field is FieldDef => field !== null);
  if (!fields.length) throw new Error("No fields found in the pasted JSON.");
  return { fields, name };
}

export default function ProfileEditor({ id, onDone }: { id: string | null; onDone: () => void }) {
  const [profileId, setProfileId] = useState(id ?? "");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<FieldDef[]>([{ key: "", description: "", type: "string" }]);
  const [autoPrompt, setAutoPrompt] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0");
  const [storage, setStorage] = useState<StorageMode>("none");
  const [brandTitle, setBrandTitle] = useState("");
  const [brandSubtitle, setBrandSubtitle] = useState("");
  const [brandAccent, setBrandAccent] = useState("#2a5d7c");
  const [hasKey, setHasKey] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyAction, setKeyAction] = useState<KeyAction>({ action: "keep" });
  const [importText, setImportText] = useState("");
  const [importNote, setImportNote] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    if (!id) return;
    api
      .profile(id)
      .then((profile: Profile) => {
        setProfileId(profile.id);
        setName(profile.name);
        setFields(profile.fields.length ? profile.fields : [{ key: "", description: "", type: "string" }]);
        setAutoPrompt(!profile.prompt);
        setPrompt(profile.prompt ?? "");
        setModel(profile.model ?? "");
        setBaseUrl(profile.base_url ?? "");
        setTemperature(String(profile.temperature ?? 0));
        setStorage(profile.storage);
        setBrandTitle(profile.branding?.title ?? "");
        setBrandSubtitle(profile.branding?.subtitle ?? "");
        setBrandAccent(profile.branding?.accent ?? "#2a5d7c");
        setHasKey(Boolean(profile.has_api_key));
        setLoaded(true);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Failed to load profile.");
        setLoaded(true);
      });
  }, [id]);

  // Live preview of the prompt this profile would send.
  useEffect(() => {
    const effective = autoPrompt ? "" : prompt.trim();
    if (!autoPrompt) {
      setPreview(effective);
      return;
    }
    const usable = fields.filter((field) => field.key.trim());
    if (!usable.length) {
      setPreview("");
      return;
    }
    const timer = setTimeout(() => {
      api
        .promptPreview(usable, null)
        .then(setPreview)
        .catch(() => setPreview(""));
    }, 250);
    return () => clearTimeout(timer);
  }, [fields, autoPrompt, prompt]);

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function runImport() {
    try {
      const result = parseImportedFields(importText);
      setFields(result.fields);
      if (result.name && !name) setName(result.name);
      setAutoPrompt(true);
      setImportNote(`Imported ${result.fields.length} fields. Review them below, then save.`);
      setError("");
    } catch (caught) {
      setImportNote("");
      setError(`Import failed: ${caught instanceof Error ? caught.message : "invalid JSON"}`);
    }
  }

  async function save() {
    const cleanId = profileId.trim().toLowerCase();
    const usableFields = fields.filter((field) => field.key.trim());
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(cleanId)) {
      setError("Profile ID: lowercase letters, digits, dashes or underscores (e.g. elixir-intake).");
      return;
    }
    if (!name.trim()) {
      setError("Give the profile a name.");
      return;
    }
    if (!usableFields.length && !(autoPrompt ? false : prompt.trim())) {
      setError("Add at least one field, or switch the prompt to manual and write one.");
      return;
    }
    setSaving(true);
    setError("");
    const payload: Record<string, unknown> = {
      id: cleanId,
      name: name.trim(),
      fields: usableFields,
      prompt: autoPrompt ? null : prompt.trim(),
      model: model.trim() || null,
      base_url: baseUrl.trim() || null,
      temperature: Number(temperature) || 0,
      storage,
      branding:
        brandTitle.trim() || brandSubtitle.trim()
          ? { title: brandTitle.trim(), subtitle: brandSubtitle.trim(), accent: brandAccent }
          : null,
    };
    if (keyAction.action === "set") payload.api_key = keyAction.value;
    if (keyAction.action === "clear") payload.api_key = null;
    try {
      if (id) await api.updateProfile(id, payload);
      else await api.createProfile(payload);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed.");
      setSaving(false);
    }
  }

  if (!loaded) return <div className="page"><div className="muted">Loading profile...</div></div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>{id ? `Edit profile: ${profileId}` : "New profile"}</h2>
        <span className="spacer" />
        <button className="quiet" onClick={onDone}>Cancel</button>
        <button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save profile"}</button>
      </div>
      {error && <div className="error-note">{error}</div>}

      <div className="form-section">
        <h3>Basics</h3>
        <div className="form-grid">
          <FieldRow label="Profile ID (used by apps in API calls, cannot be a name you change later)">
            <input value={profileId} disabled={Boolean(id)} placeholder="elixir-intake" onChange={(e) => setProfileId(e.target.value)} />
          </FieldRow>
          <FieldRow label="Display name">
            <input value={name} placeholder="Elixir Client Intake" onChange={(e) => setName(e.target.value)} />
          </FieldRow>
          <FieldRow label="Storage">
            <select value={storage} onChange={(e) => setStorage(e.target.value as StorageMode)}>
              <option value="none">None — results returned to the app only</option>
              <option value="local">Local — keep records in service SQLite</option>
              <option value="supabase">Supabase — write to the ocr_extractions table</option>
            </select>
          </FieldRow>
        </div>
      </div>

      <div className="form-section">
        <h3>Fields — what to extract from each document</h3>
        <div className="field-row header">
          <span>Field name</span><span>Type</span><span>Description (helps accuracy)</span><span />
        </div>
        {fields.map((field, index) => (
          <div className="field-row" key={index}>
            <input value={field.key} placeholder="client_name" onChange={(e) => updateField(index, { key: e.target.value })} />
            <select value={field.type ?? "string"} onChange={(e) => updateField(index, { type: e.target.value as FieldType })}>
              <option value="string">text</option>
              <option value="number">number</option>
              <option value="boolean">yes/no</option>
            </select>
            <input value={field.description ?? ""} placeholder="e.g. full legal name of the client" onChange={(e) => updateField(index, { description: e.target.value })} />
            <span className="field-tools">
              <button className="quiet" title="Move up" onClick={() => moveField(index, -1)}>↑</button>
              <button className="quiet" title="Move down" onClick={() => moveField(index, 1)}>↓</button>
              <button className="quiet danger" title="Remove" onClick={() => setFields((current) => current.filter((_, i) => i !== index))}>✕</button>
            </span>
          </div>
        ))}
        <button className="quiet" onClick={() => setFields((current) => [...current, { key: "", description: "", type: "string" }])}>
          + Add field
        </button>

        <details className="import-box" open={Boolean(importNote)}>
          <summary>Import fields from JSON</summary>
          <FieldRow label='Paste a field array like [{"key":"vendor","type":"number"}], a form object like {"fields":[...]}, or a key→type map'>
            <textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={'{\n  "fields": [\n    { "key": "vendor", "description": "Company that issued the invoice" },\n    { "key": "total", "type": "number" }\n  ]\n}'} />
          </FieldRow>
          <button className="quiet" onClick={runImport}>Parse &amp; fill fields</button>
          {importNote && <div className="ok-note">{importNote}</div>}
        </details>
      </div>

      <div className="form-section">
        <h3>Prompt sent with the document</h3>
        <div className="form-row radio-row">
          <label><input type="radio" checked={autoPrompt} onChange={() => setAutoPrompt(true)} /> Auto-generate from the fields above (recommended)</label>
          <label><input type="radio" checked={!autoPrompt} onChange={() => setAutoPrompt(false)} /> Write a custom prompt</label>
        </div>
        {!autoPrompt && (
          <FieldRow label="Custom prompt">
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </FieldRow>
        )}
        {autoPrompt && usableCount(fields) > 0 && (
          <>
            <FieldRow label="Generated prompt (live preview — what the model actually receives)">
              <div className="prompt-preview">{preview || "..."}</div>
            </FieldRow>
          </>
        )}
      </div>

      <div className="form-section">
        <h3>Model</h3>
        <div className="form-grid">
          <FieldRow label="Model server URL (blank = service default)">
            <input value={baseUrl} placeholder="http://localhost:8080/v1" onChange={(e) => setBaseUrl(e.target.value)} />
          </FieldRow>
          <FieldRow label="Model name (blank = service default)">
            <input value={model} placeholder="glm-ocr" onChange={(e) => setModel(e.target.value)} />
          </FieldRow>
          <FieldRow label="Temperature (0 = most precise)">
            <input type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </FieldRow>
        </div>
      </div>

      <div className="form-section">
        <h3>API key (optional — apps must then send X-API-Key)</h3>
        {keyAction.action === "set" ? (
          <div>
            <div className="ok-note">New key generated — copy it now, it is shown only once:</div>
            <div className="prompt-preview">{generatedKey}</div>
          </div>
        ) : hasKey && keyAction.action === "keep" ? (
          <div className="form-row">
            <span>A key is set (shown only when generated). Apps must send it as X-API-Key.</span>
            <button className="quiet danger" onClick={() => setKeyAction({ action: "clear" })}>Remove key</button>
          </div>
        ) : keyAction.action === "clear" ? (
          <div className="form-row">
            <span className="error-note">Key will be removed when you save.</span>
            <button className="quiet" onClick={() => setKeyAction({ action: "keep" })}>Undo</button>
          </div>
        ) : (
          <button className="quiet" onClick={() => {
            const key = generateKey();
            setGeneratedKey(key);
            setKeyAction({ action: "set", value: key });
          }}>Generate API key</button>
        )}
      </div>

      <div className="form-section">
        <h3>Branding (what app users see when this profile runs in the Playground)</h3>
        <div className="form-grid">
          <FieldRow label="Title">
            <input value={brandTitle} placeholder="Elixir Document Intake" onChange={(e) => setBrandTitle(e.target.value)} />
          </FieldRow>
          <FieldRow label="Subtitle">
            <input value={brandSubtitle} placeholder="Upload a document to fill your form" onChange={(e) => setBrandSubtitle(e.target.value)} />
          </FieldRow>
          <FieldRow label="Accent color">
            <input type="color" value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)} />
          </FieldRow>
        </div>
      </div>

      <div className="page-head">
        <span className="spacer" />
        <button className="quiet" onClick={onDone}>Cancel</button>
        <button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save profile"}</button>
      </div>
    </div>
  );
}

function usableCount(fields: FieldDef[]): number {
  return fields.filter((field) => field.key.trim()).length;
}
