import { useCallback, useEffect, useState } from "react";
import { api, type ExtractionDetail, type ExtractionRow, type Profile } from "./api";
import { storageLabel } from "./ui";

function preview(data: unknown): string {
  if (data == null) return "—";
  const text = JSON.stringify(data);
  return text.length > 70 ? text.slice(0, 70) + "…" : text;
}

export default function RecordsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileFilter, setProfileFilter] = useState("");
  const [referenceFilter, setReferenceFilter] = useState("");
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<ExtractionRow[] | null>(null);
  const [detail, setDetail] = useState<ExtractionDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    api
      .extractions({ app_id: profileFilter || undefined, reference_id: referenceFilter.trim() || undefined, limit })
      .then(setRows)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load records."));
  }, [profileFilter, referenceFilter, limit]);

  useEffect(() => {
    api.profiles().then(setProfiles).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  async function openRow(row: ExtractionRow) {
    try {
      setDetail(await api.extraction(row.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load record.");
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>Records</h2>
        <span className="spacer" />
      </div>
      <div className="toolbar">
        <select value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
          <option value="">All profiles</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.name} ({profile.id})</option>
          ))}
        </select>
        <input
          placeholder="Search reference_id (e.g. client-42)"
          value={referenceFilter}
          onChange={(e) => setReferenceFilter(e.target.value)}
        />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value={25}>25 rows</option>
          <option value={50}>50 rows</option>
          <option value={100}>100 rows</option>
        </select>
        <button className="quiet" onClick={load}>Refresh</button>
      </div>
      {error && <div className="error-note">{error}</div>}
      {!rows ? (
        <div className="muted">Loading records...</div>
      ) : rows.length === 0 ? (
        <div className="muted">
          No records. Profiles store records here when their storage is set to Local (or Supabase, once wired);
          the Playground always keeps its history.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Profile</th><th>File</th><th>Reference</th><th>Extracted data</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="clickable" onClick={() => openRow(row)}>
                <td>{row.id}</td>
                <td>{row.app_id}</td>
                <td>{row.source_file ?? "—"}</td>
                <td>{row.reference_id ?? "—"}</td>
                <td>{preview(row.data)}</td>
                <td>{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div className="detail-panel">
          <div className="page-head">
            <h2>Record #{detail.id} — {detail.app_id}</h2>
            <span className="spacer" />
            <button className="quiet" onClick={() => navigator.clipboard.writeText(JSON.stringify(detail.data, null, 2))}>
              Copy JSON
            </button>
            <button className="quiet" onClick={() => setDetail(null)}>Close</button>
          </div>
          <div className="chips" style={{ marginBottom: 10 }}>
            <span className="chip">{storageLabel("local")} record</span>
            {detail.reference_id && <span className="chip accent">ref: {detail.reference_id}</span>}
            <span className="chip">{detail.source_file ?? "unknown file"}</span>
            <span className="chip">{new Date(detail.created_at).toLocaleString()}</span>
          </div>
          <FieldLabel text="Structured data" />
          <pre className="prompt-preview">{JSON.stringify(detail.data, null, 2)}</pre>
          <FieldLabel text="Raw extracted text" />
          <pre className="prompt-preview">{detail.extracted_text}</pre>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <div className="form-row" style={{ marginTop: 10 }}>{text}</div>;
}
