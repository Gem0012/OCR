import type { FieldDef } from "./types.js";

/** The person-record domain of the original prototype. Kept only for the
 *  legacy /api/ocr endpoint and the seeded devconsole profile; new app
 *  profiles declare their own fields instead. */
export const PERSON_FIELDS: FieldDef[] = [
  { key: "name", type: "string", description: "Full name of the person" },
  { key: "date_of_birth", type: "string", description: "Date of birth" },
  { key: "address", type: "string" },
  { key: "phone", type: "string" },
  { key: "email", type: "string" },
  { key: "details", type: "string", description: "All other visible text from the document" },
];
