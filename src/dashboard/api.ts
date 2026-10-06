export type FieldType = "string" | "number" | "boolean";
export type FieldDef = { key: string; description?: string; type?: FieldType };
export type Branding = { title?: string; subtitle?: string; accent?: string } | null;
export type StorageMode = "none" | "local" | "supabase";

export type Profile = {
  id: string;
  name: string;
  fields: FieldDef[];
  prompt: string | null;
  effective_prompt?: string;
  model: string | null;
  base_url: string | null;
  temperature: number;
  storage: StorageMode;
  branding: Branding;
  api_key: null;
  has_api_key?: boolean;
};

export type ServiceConfig = {
  base_url: string;
  model: string;
  prompt: string;
  max_pdf_pages: number;
  max_upload_mb: number;
  supabase_configured?: boolean;
};

export type Usage = { prompt_tokens?: number; completion_tokens?: number };

export type ExtractResult = {
  text: string;
  data: unknown;
  record_id?: number;
  profile: string;
  reasoning?: string;
  pages: number;
  usage: Usage;
};

export type ExtractionRow = {
  id: number;
  app_id: string;
  reference_id: string | null;
  owner_id?: string | null;
  source_file: string | null;
  data: unknown;
  created_at: string;
};

export type ExtractionDetail = ExtractionRow & { extracted_text: string };

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  config: () => request<ServiceConfig>("/api/config"),
  models: (baseUrl: string) =>
    request<{ models: string[] }>(`/api/models?base_url=${encodeURIComponent(baseUrl)}`).then((r) => r.models),
  profiles: () => request<{ profiles: Profile[] }>("/api/profiles").then((r) => r.profiles),
  profile: (id: string) =>
    request<{ profile: Profile }>(`/api/profiles/${encodeURIComponent(id)}`).then((r) => r.profile),
  createProfile: (profile: unknown) =>
    request<{ profile: Profile }>("/api/profiles", jsonInit("POST", profile)).then((r) => r.profile),
  updateProfile: (id: string, profile: unknown) =>
    request<{ profile: Profile }>(`/api/profiles/${encodeURIComponent(id)}`, jsonInit("PUT", profile)).then((r) => r.profile),
  deleteProfile: (id: string) => request<{ ok: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  promptPreview: (fields: FieldDef[], prompt: string | null) =>
    request<{ effective_prompt: string }>("/api/prompt-preview", jsonInit("POST", { fields, prompt })).then(
      (r) => r.effective_prompt,
    ),
  extract: (form: FormData) => request<ExtractResult>("/api/extract", { method: "POST", body: form }),
  extractions: (params: { app_id?: string; reference_id?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params.app_id) query.set("app_id", params.app_id);
    if (params.reference_id) query.set("reference_id", params.reference_id);
    query.set("limit", String(params.limit ?? 50));
    return request<{ extractions: ExtractionRow[] }>(`/api/extractions?${query}`).then((r) => r.extractions);
  },
  extraction: (id: number) =>
    request<{ extraction: ExtractionDetail }>(`/api/extractions/${id}`).then((r) => r.extraction),
};
