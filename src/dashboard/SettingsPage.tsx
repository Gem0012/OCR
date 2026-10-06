import { useEffect, useState } from "react";
import { api, type ServiceConfig } from "./api";
import { StatusDot } from "./ui";

export default function SettingsPage() {
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [modelStatus, setModelStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [modelList, setModelList] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .config()
      .then((value) => {
        setConfig(value);
        api
          .models(value.base_url)
          .then((models) => {
            setModelList(models);
            setModelStatus("ok");
          })
          .catch(() => setModelStatus("down"));
      })
      .catch((caught) => {
        setModelStatus("down");
        setError(caught instanceof Error ? caught.message : "Failed to load config.");
      });
  }, []);

  return (
    <div className="page">
      <div className="page-head"><h2>Settings</h2></div>
      {error && <div className="error-note">{error}</div>}
      {!config ? (
        <div className="muted">Loading service settings...</div>
      ) : (
        <>
          <div className="form-section">
            <h3>Service defaults</h3>
            <div className="form-grid">
              <div className="form-row">Model server<div className="value">{config.base_url}</div></div>
              <div className="form-row">Default model<div className="value">{config.model}</div></div>
              <div className="form-row">Max PDF pages<div className="value">{config.max_pdf_pages}</div></div>
              <div className="form-row">Max upload size<div className="value">{config.max_upload_mb} MB</div></div>
              <div className="form-row">
                Supabase
                <div className="value">
                  <StatusDot ok={Boolean(config.supabase_configured)} />
                  {config.supabase_configured ? "configured" : "not configured (set SUPABASE_DB_URL in .env)"}
                </div>
              </div>
            </div>
            <div className="muted">
              These come from environment variables (see .env.example) and apply when a profile leaves a setting blank.
            </div>
          </div>

          <div className="form-section">
            <h3>Model server health</h3>
            <div className="form-row">
              <span>
                <StatusDot ok={modelStatus === "ok"} />
                {modelStatus === "ok" ? `Reachable — ${modelList.length} model(s) available` : modelStatus === "down" ? "Not reachable — is llama-server running?" : "Checking..."}
              </span>
            </div>
            {modelList.length > 0 && (
              <ul className="model-list">
                {modelList.map((model) => <li key={model}>{model}</li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
