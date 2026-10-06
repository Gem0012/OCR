export type PageRunOptions = {
  target: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  prompt: string;
  urls: string[];
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

async function runPage(options: PageRunOptions, dataUrl: string): Promise<{ text: string; reasoning: string; usage: ChatResponse["usage"] }> {
  const result = await fetch(`${options.target}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not-needed" },
    body: JSON.stringify({
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: dataUrl } },
        { type: "text", text: options.prompt },
      ] }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!result.ok) throw new Error(`Server returned ${result.status}: ${(await result.text()).slice(0, 500)}`);
  const data = await result.json() as ChatResponse;
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Unexpected response shape from the model server.");
  const text = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : message.content || "";
  return { text: text.trim(), reasoning: message.reasoning_content?.trim() || "", usage: data.usage };
}

export async function runModelPages(options: PageRunOptions): Promise<PageRunResult> {
  const pages: string[] = [];
  const reasoning: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  for (const url of options.urls) {
    const result = await runPage(options, url);
    pages.push(result.text);
    if (result.reasoning) reasoning.push(result.reasoning);
    promptTokens += result.usage?.prompt_tokens || 0;
    completionTokens += result.usage?.completion_tokens || 0;
  }
  return { pages, reasoning: reasoning.join("\n\n"), promptTokens, completionTokens };
}
