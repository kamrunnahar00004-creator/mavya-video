import "server-only";

/**
 * One Gemini call that returns JSON. With `schema`, Gemini's structured output; with `urlContext` (it reads web
 * pages itself, which cannot be combined with a schema) the JSON is taken from the text answer.
 */
const MODEL = "gemini-flash-latest";

export class GeminiError extends Error {}

export async function geminiJSON<T>(prompt: string, opts: { schema?: object; urlContext?: boolean; temperature?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set.");
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    ...(opts.urlContext ? { tools: [{ url_context: {} }] } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.schema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
    },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new GeminiError(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (out.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  // Text answers may wrap the JSON in a code fence or a sentence.
  const json = opts.schema ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new GeminiError("Gemini returned no JSON.");
  }
}
