import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

type Config = { base_url: string; model: string; prompt: string };
type Usage = { prompt_tokens?: number; completion_tokens?: number };
type OcrResult = {
  text: string;
  fields: Record<string, unknown>;
  record_id: number;
  reasoning?: string;
  pages: number;
  usage: Usage;
};

const fallbackConfig: Config = {
  base_url: "http://localhost:8080/v1",
  model: "glm-ocr",
  prompt:
    "Extract the person information from this image and return only valid JSON. Use exactly these keys: name, date_of_birth, address, phone, email, details. Use null for missing values. Preserve all other visible text in details. Do not use markdown or commentary.",
};

export default function App() {
  const [config, setConfig] = useState<Config>(fallbackConfig);
  const [temperature, setTemperature] = useState("0");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(true);
  const [models, setModels] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json() as Promise<Config>)
      .then((value) => setConfig(value))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`/api/models?base_url=${encodeURIComponent(config.base_url)}`)
      .then((response) => response.json() as Promise<{ models?: string[] }>)
      .then((value) => {
        if (value.models) {
          setModels(value.models);
          if (value.models.length === 1) {
            setConfig((current) => ({ ...current, model: value.models![0] }));
          }
        }
      })
      .catch(() => undefined);
  }, [config.base_url]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

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
    body.append("prompt", config.prompt);
    body.append("model", config.model);
    body.append("base_url", config.base_url);
    body.append("temperature", temperature || "0");
    try {
      const response = await fetch("/api/ocr", { method: "POST", body });
      const data = (await response.json()) as OcrResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "The request failed.");
      setResult(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the app server.");
    } finally {
      setWorking(false);
    }
  }

  function downloadJson() {
    if (!result) return;
    const payload = {
      file: file?.name ?? null,
      extracted_text: result.text,
      fields: result.fields,
      record_id: result.record_id,
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

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>GLM OCR tester</h1>
          <p>Drop a page in, see what the model reads back.</p>
        </div>
        <button className="quiet" onClick={() => setSettingsVisible((visible) => !visible)}>
          {settingsVisible ? "Hide settings" : "Show settings"}
        </button>
      </header>

      {settingsVisible && (
        <div className="settings">
          <label>Server<input value={config.base_url} onChange={(e) => setConfig({ ...config, base_url: e.target.value })} /></label>
          <label>Model<input list="model-list" value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} /><datalist id="model-list">{models.map((model) => <option key={model} value={model} />)}</datalist></label>
          <label className="temperature">Temperature<input type="number" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} /></label>
          <label className="grow">Instruction sent with the image<textarea rows={2} value={config.prompt} onChange={(e) => setConfig({ ...config, prompt: e.target.value })} /></label>
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
                <strong>Drop an image or PDF here</strong><span>PNG, JPG, WebP, or a PDF up to 8 pages</span>
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
          {result?.reasoning && <details className="thinking"><summary>Model&apos;s reasoning</summary><pre>{result.reasoning}</pre></details>}
          {result && <div className="stats">{result.pages} page{result.pages === 1 ? "" : "s"}{"   "}{result.usage.completion_tokens ?? 0} tokens out{"   "}{result.usage.prompt_tokens ?? 0} in{"   "}record #{result.record_id}</div>}
        </section>
      </main>
      <input ref={fileInput} type="file" accept="image/*,.pdf" hidden onChange={onFileChange} />
    </div>
  );
}
