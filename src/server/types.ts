export type FieldType = "string" | "number" | "boolean";

export type FieldDef = {
  key: string;
  description?: string;
  type?: FieldType;
};

export type Branding = {
  title?: string;
  subtitle?: string;
  accent?: string;
};

export type Profile = {
  id: string;
  name: string;
  fields: FieldDef[];
  prompt: string | null;
  model: string | null;
  base_url: string | null;
  temperature: number;
  storage: "none" | "local" | "supabase";
  branding: Branding | null;
  api_key: string | null;
};

export type ExtractionRecord = Record<string, unknown>;
