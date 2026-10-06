import type { FieldDef } from "./api";

type DataRecord = Record<string, unknown>;

/** Editable form generated from a profile's fields, prefilled with extracted
 *  values — the human verification step. Emits the corrected record upward. */
export default function ReviewForm({ fields, data, onChange }: { fields: FieldDef[]; data: DataRecord; onChange: (next: DataRecord) => void }) {
  return (
    <div className="review-form">
      {fields.map((field) => {
        const value = data[field.key];
        const missing = value == null || value === "";
        const label = (
          <>
            {field.key}
            {missing && <span className="missed-tag">not found — check the document</span>}
            {field.description && <small>{field.description}</small>}
          </>
        );
        return (
          <div className={`form-row ${missing ? "missed" : ""}`} key={field.key}>
            {label}
            {field.type === "boolean" ? (
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => onChange({ ...data, [field.key]: e.target.checked })}
              />
            ) : field.type === "number" ? (
              <input
                type="number"
                step="any"
                value={value == null ? "" : String(value)}
                onChange={(e) => {
                  const text = e.target.value;
                  onChange({ ...data, [field.key]: text === "" ? null : Number(text) });
                }}
              />
            ) : (
              <input
                value={value == null ? "" : String(value)}
                onChange={(e) => {
                  const text = e.target.value;
                  onChange({ ...data, [field.key]: text === "" ? null : text });
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
