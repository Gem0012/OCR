import { type CSSProperties, type ChangeEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { api, type Branding, type ExtractResult, type Profile, type ServiceConfig, type Usage } from "./api";

type Props = { initialProfileId?: string };

const defaultConfig: ServiceConfig = { base_url: "http://localhost:8080/v1", model: "glm-ocr", prompt: "", max_pdf_pages: 8, max_upload_mb: 25 };

export default function PlaygroundPage({ initialProfileId }: Props) {
  const [serviceConfig, setServiceConfig] = useState<ServiceConfig>(defaultConfig);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState(initialProfileId ?? "");
  const [branding, setBranding] = useState<Branding>(null);
  const [baseUrl, setBaseUrl] = useState(defaultConfig.base_url);
  const [model, setModel] = useState(defaultConfig.model);
  const [prompt, setPrompt] = useState(defaultConfig.prompt);
  const [temperature, setTemperature] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.config().then((value) => {
      setServiceConfig(value);
      setBaseUrl((current) => current || value.base_url);
      setModel((current) => current || value.model);
    }).catch(() => undefined);
    api.profiles().then((list) => {
      setProfiles(list);
      if (initialProfileId) setSelectedProfile(initialProfileId);
      else setSelectedProfile((current) => current || list[0]?.id || "");
    }).catch(() => undefined);
  }, [initialProfileId]);

  // Applying a profile loads its extraction setup and branding.
  useEffect(() => {
    if (!selectedProfile) {
      setBranding(null);
      return;
    }
    api
      .profile(selectedProfile)
      .then((profile) => {
        setBranding(profile.branding);
        if (profile.base_url) setBaseUrl(profile.base_url);
        if (profile.model) setModel(profile.model);
        setPrompt(profile.prompt ?? profile.effective_prompt ?? "");
        setTemperature(String(profile.temperature ?? 0));
      })
      .catch(() => undefined);
  }, [selectedProfile]);

  useEffect(() => {
    api.models(baseUrl).then((list) => {
      setModels(list);
      if (list.length === 1) setModel(list[0]);
    }).catch(() => undefined);
  }, [baseUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const title = branding?.title || "Playground";
  const shellStyle = branding?.accent ? ({ "--accent": branding.accent } as CSSProperties) : undefined;
  const pageLimit = serviceConfig.max_pdf_pages ?? 8;

  function acceptFile(nextFile: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(nextFile.type === "application/pdf" ? undefined : URL.createObjectURL(nextFile));
    setResult(null);
    setError("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) acceptFile(selected);
  }

  async function runOcr() {
    if (!file) return;
    setWorking(true);
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    if (selectedProfile) body.append("profile", selectedProfile);
    if (prompt) body.append("prompt", prompt);
    if (model) body.append("model", model);
    if (baseUrl) body.append("base_url", baseUrl);
    body.append("temperature", temperature || "0");
    try {
      setResult(await api.extract(body));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the OCR service.");
    } finally {
      setWorking(false);
    }
  }

  function downloadJson() {
    if (!result) return;
    const payload = {
      file: file?.name ?? null,
      profile: result.profile,
      extracted_text: result.text,
      data: result.data,
      record_id: result.record_id ?? null,
      reasoning: result.reasoning ?? "",
      pages: result.pages,
      usage: result.usage,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(/\.[^.]+$/, "") || "ocr-result"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const output = error || (working ? "Reading the page..." : result?.text || "Nothing read yet.");
  const usage: Usage = result?.usage ?? {};

  return (
    <div className="page playground" style={shellStyle}>
      <div className="page-head">
        <h2>{title}</h2>
        {selectedProfile && <span className="chip">{selectedProfile}</span>}
        <span className="spacer" />
      </div>
      {branding?.subtitle && <div className="muted" style={{ marginTop: -8, marginBottom: 12 }}>{branding.subtitle}</div>}

      <div className="settings" style={{ border: "1px solid var(--rule)", borderRadius: 6, marginBottom: 14, background: "transparent" }}>
        <label>App profile
          <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}>
            <option value="">Manual (no profile)</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name} ({profile.id})</option>
            ))}
          </select>
        </label>
        <label>Server<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
        <label>Model
          <input list="model-list" value={model} onChange={(e) => setModel(e.target.value)} />
          <datalist id="model-list">{models.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
        <label className="temperature">Temperature
          <input type="number" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </label>
        <label className="grow">Instruction sent with the image<textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
      </div>

      <main className="playground-main">
        <section>
          <div className="pane-head">
            <strong>{file?.name ?? "No file yet"}</strong>
            <span className="spacer" />
            <button className="quiet" onClick={() => fileInput.current?.click()}>Choose file</button>
            <button disabled={!file || working} onClick={runOcr}>{working ? "Reading..." : "Read it"}</button>
          </div>
          <div className="pane-body">
            {!file ? (
              <div className="drop-zone" onClick={() => fileInput.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
                <strong>Drop an image or PDF here</strong>
                <span>PNG, JPG, WebP, or a PDF up to {pageLimit} pages</span>
              </div>
            ) : (
              <div className="preview">
                {previewUrl
                  ? <img src={previewUrl} alt="Uploaded page" />
                  : <div className="pdf-preview">{file.name}<br />{Math.round(file.size / 1024)} KB - pages render server-side</div>}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="pane-head">
            <strong>Extracted text</strong>
            <span className="spacer" />
            {result && (
              <>
                <button className="quiet" onClick={() => navigator.clipboard.writeText(result.text)}>Copy</button>
                <button className="quiet" onClick={downloadJson}>Download JSON</button>
              </>
            )}
          </div>
          <div className={`output ${error ? "error" : !result && !working ? "placeholder" : ""}`}>
            {working ? <span className="working"><i />Reading the page...</span> : output}
          </div>
          {result?.data != null && (
            <details className="thinking" open>
              <summary>Structured data{result.profile ? ` (${result.profile})` : ""}</summary>
              <pre>{JSON.stringify(result.data, null, 2)}</pre>
            </details>
          )}
          {result?.reasoning && (
            <details className="thinking">
              <summary>Model&apos;s reasoning</summary>
              <pre>{result.reasoning}</pre>
            </details>
          )}
          {result && (
            <div className="stats">
              {`${result.pages} page${result.pages === 1 ? "" : "s"}   ${usage.completion_tokens ?? 0} tokens out   ${usage.prompt_tokens ?? 0} in   profile ${result.profile}${result.record_id != null ? `   record #${result.record_id}` : ""}`}
            </div>
          )}
        </section>
      </main>
      <input ref={fileInput} type="file" accept="image/*,.pdf" hidden onChange={onFileChange} />
    </div>
  );
}
