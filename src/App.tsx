import { ChangeEvent, CSSProperties, DragEvent, useEffect, useRef, useState } from "react";

type Config = { base_url: string; model: string; prompt: string; max_pdf_pages?: number; max_upload_mb?: number };
type Usage = { prompt_tokens?: number; completion_tokens?: number };
type Branding = { title?: string; subtitle?: string; accent?: string } | null;
type ProfileSummary = { id: string; name: string; branding?: Branding };
type ProfileDetail = {
  id: string;
  name: string;
  fields: Array<{ key: string; description?: string; type?: string }>;
  prompt: string | null;
  effective_prompt?: string;
  model: string | null;
  base_url: string | null;
  temperature: number;
  storage: string;
  branding: Branding;
};
type ExtractResult = {
  text: string;
  data: unknown;
  record_id?: number;
  profile: string;
  reasoning?: string;
  pages: number;
  usage: Usage;
};

const defaultConfig: Config = {
  base_url: "http://localhost:8080/v1",
  model: "glm-ocr",
  prompt: "",
  max_pdf_pages: 8,
};

export default function App() {
  const [serviceConfig, setServiceConfig] = useState<Config>(defaultConfig);
  const [baseUrl, setBaseUrl] = useState(defaultConfig.base_url);
  const [model, setModel] = useState(defaultConfig.model);
  const [prompt, setPrompt] = useState(defaultConfig.prompt);
  const [temperature, setTemperature] = useState("0");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [branding, setBranding] = useState<Branding>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json() as Promise<Config>)
      .then((value) => {
        setServiceConfig(value);
        setBaseUrl((current) => current || value.base_url);
        setModel((current) => current || value.model);
      })
      .catch(() => undefined);
    fetch("/api/profiles")
      .then((response) => response.json() as Promise<{ profiles?: ProfileSummary[] }>)
      .then((value) => {
        const list = value.profiles || [];
        setProfiles(list);
        if (list.length) setSelectedProfile((current) => current || list[0].id);
      })
      .catch(() => undefined);
  }, []);

  // Applying a profile loads its extraction setup and branding into the console.
  useEffect(() => {
    if (!selectedProfile) {
      setBranding(null);
      return;
    }
    fetch(`/api/profiles/${encodeURIComponent(selectedProfile)}`)
      .then((response) => response.json() as Promise<{ profile?: ProfileDetail; error?: string }>)
      .then((value) => {
        if (!value.profile) return;
        const profile = value.profile;
        setBranding(profile.branding);
        if (profile.base_url) setBaseUrl(profile.base_url);
        if (profile.model) setModel(profile.model);
        setPrompt(profile.prompt ?? profile.effective_prompt ?? "");
        setTemperature(String(profile.temperature ?? 0));
      })
      .catch(() => undefined);
  }, [selectedProfile]);

  useEffect(() => {
    fetch(`/api/models?base_url=${encodeURIComponent(baseUrl)}`)
      .then((response) => response.json() as Promise<{ models?: string[] }>)
      .then((value) => {
        if (value.models) {
          setModels(value.models);
          if (value.models.length === 1) setModel(value.models[0]);
        }
      })
      .catch(() => undefined);
  }, [baseUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const title = branding?.title || "OCR console";
  useEffect(() => {
    document.title = title;
  }, [title]);

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
    body.append("prompt", prompt);
    body.append("model", model);
    body.append("base_url", baseUrl);
    body.append("temperature", temperature || "0");
    try {
      const response = await fetch("/api/extract", { method: "POST", body });
      const data = (await response.json()) as ExtractResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "The request failed.");
      setResult(data);
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
  const shellStyle = branding?.accent ? ({ "--accent": branding.accent } as CSSProperties) : undefined;
  const pageLimit = serviceConfig.max_pdf_pages ?? 8;

  return (
    <div className="app-shell" style={shellStyle}>
      <header>
        <div>
          <h1>{title}</h1>
          <p>{branding?.subtitle || "Drop a page in, see what the model reads back."}</p>
        </div>
        <button className="quiet" onClick={() => setSettingsVisible((visible) => !visible)}>
          {settingsVisible ? "Hide settings" : "Show settings"}
        </button>
      </header>

      {settingsVisible && (
        <div className="settings">
          <label>
            App profile
            <select value={selectedProfile} onChange={(e) => setSelectedProfile(e.target.value)}>
              <option value="">Manual (no profile)</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name} ({profile.id})</option>
              ))}
            </select>
          </label>
          <label>Server<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
          <label>Model<input list="model-list" value={model} onChange={(e) => setModel(e.target.value)} /><datalist id="model-list">{models.map((name) => <option key={name} value={name} />)}</datalist></label>
          <label className="temperature">Temperature<input type="number" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} /></label>
          <label className="grow">Instruction sent with the image<textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        </div>
      )}

      <main>
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
                <strong>Drop an image or PDF here</strong><span>PNG, JPG, WebP, or a PDF up to {pageLimit} pages</span>
              </div>
            ) : (
              <div className="preview">
                {previewUrl ? <img src={previewUrl} alt="Uploaded page" /> : <div className="pdf-preview">{file.name}<br />{Math.round(file.size / 1024)} KB - pages render server-side</div>}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="pane-head"><strong>Extracted text</strong><span className="spacer" />
            {result && <><button className="quiet" onClick={() => navigator.clipboard.writeText(result.text)}>Copy</button><button className="quiet" onClick={downloadJson}>Download JSON</button></>}
          </div>
          <div className={`output ${error ? "error" : !result && !working ? "placeholder" : ""}`}>{working ? <span className="working"><i />Reading the page...</span> : output}</div>
          {result?.data != null && (
            <details className="thinking" open>
              <summary>Structured data{selectedProfile ? ` (${selectedProfile})` : ""}</summary>
              <pre>{JSON.stringify(result.data, null, 2)}</pre>
            </details>
          )}
          {result?.reasoning && <details className="thinking"><summary>Model&apos;s reasoning</summary><pre>{result.reasoning}</pre></details>}
          {result && (
            <div className="stats">
              {`${result.pages} page${result.pages === 1 ? "" : "s"}   ${result.usage.completion_tokens ?? 0} tokens out   ${result.usage.prompt_tokens ?? 0} in   profile ${result.profile}${result.record_id != null ? `   record #${result.record_id}` : ""}`}
            </div>
          )}
        </section>
      </main>
      <input ref={fileInput} type="file" accept="image/*,.pdf" hidden onChange={onFileChange} />
    </div>
  );
}
