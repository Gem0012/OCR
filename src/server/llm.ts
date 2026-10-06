export type ChatCore = {
  target: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Sent as "Authorization: Bearer <key>"; local llama-server ignores it. */
  apiKey?: string;
};

export type PageRunResult = {
  pages: string[];
  reasoning: string;
  promptTokens: number;
  completionTokens: number;
};

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
      reasoning_content?: string;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

type ChatMessage = { role: "user"; content: unknown };

async function completeChat(core: ChatCore, messages: ChatMessage[]): Promise<{ text: string; reasoning: string; usage: ChatResponse["usage"] }> {
  const result = await fetch(`${core.target}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${core.apiKey || "not-needed"}`,
    },
    body: JSON.stringify({
      model: core.model,
      temperature: core.temperature,
      max_tokens: core.maxTokens,
      messages,
    }),
    signal: AbortSignal.timeout(core.timeoutMs),
  });
  if (!result.ok) throw new Error(`Server returned ${result.status}: ${(await result.text()).slice(0, 500)}`);
  const data = await result.json() as ChatResponse;
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Unexpected response shape from the model server.");
  const text = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : message.content || "";
  return { text: text.trim(), reasoning: message.reasoning_content?.trim() || "", usage: data.usage };
}

function collectRuns(runs: Array<{ text: string; reasoning: string; usage: ChatResponse["usage"] }>): PageRunResult {
  const pages: string[] = [];
  const reasoning: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  for (const run of runs) {
    pages.push(run.text);
    if (run.reasoning) reasoning.push(run.reasoning);
    promptTokens += run.usage?.prompt_tokens || 0;
    completionTokens += run.usage?.completion_tokens || 0;
  }
  return { pages, reasoning: reasoning.join("\n\n"), promptTokens, completionTokens };
}

/** Vision path: one image + the extraction prompt per page. */
export async function runModelPages(core: ChatCore & { prompt: string; urls: string[] }): Promise<PageRunResult> {
  const runs: Array<{ text: string; reasoning: string; usage: ChatResponse["usage"] }> = [];
  for (const url of core.urls) {
    runs.push(await completeChat(core, [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url } },
        { type: "text", text: core.prompt },
      ],
    }]));
  }
  return collectRuns(runs);
}

/** Text path: text-native documents (digital PDFs, office files) skip the
 *  vision encoder entirely and send the document text directly. */
export async function runTextPages(core: ChatCore & { prompt: string; pages: string[] }): Promise<PageRunResult> {
  const runs: Array<{ text: string; reasoning: string; usage: ChatResponse["usage"] }> = [];
  for (const page of core.pages) {
    runs.push(await completeChat(core, [{
      role: "user",
      content: `${core.prompt}\n\n<document>\n${page}\n</document>`,
    }]));
  }
  return collectRuns(runs);
}
