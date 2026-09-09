import type { InternalPhase } from "./product-flow.ts";

export type MoviePlanStreamEvent =
  | { type: "token"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export type MoviePlanProgress = {
  phase: InternalPhase | "assetPrompts" | "assetReferences" | "assetReferenceChoice";
  model: string;
  status: "generating" | "completed" | "failed";
  text: string;
  reasoning?: string;
  message?: string;
};

export function moviePlanStreamResponse(generate: (onToken: (text: string) => void, onReasoning: (text: string) => void) => Promise<{ text: string }>, cancel: () => Promise<void>): Response {
  const encoder = new TextEncoder();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: MoviePlanStreamEvent) => {
        if (!canceled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void (async () => {
        try {
          const result = await generate((text) => emit({ type: "token", text }), (text) => emit({ type: "reasoning", text }));
          emit({ type: "done", text: result.text });
        } catch (error) {
          emit({ type: "error", message: error instanceof Error ? error.message : "Local model generation failed." });
        } finally {
          if (!canceled) controller.close();
        }
      })();
    },
    async cancel() { canceled = true; await cancel(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export async function readMoviePlanStream(response: Response, onText?: (text: string) => void, onReasoning?: (text: string) => void): Promise<{ text: string }> {
  if (!response.ok || !response.body) throw new Error(`Local model stream unavailable (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let completed = false;
  const accept = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as MoviePlanStreamEvent;
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "token") {
      text += event.text;
      onText?.(text);
    } else if (event.type === "reasoning") {
      onReasoning?.(event.text);
    } else if (event.type === "done") {
      text = event.text;
      completed = true;
      onText?.(text);
    } else throw new Error("Unknown local model stream event.");
  };
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) accept(line);
    }
    pending += decoder.decode();
    if (pending.trim()) accept(pending);
    if (!completed) throw new Error("Local model stream ended before completion. No draft was accepted.");
    return { text };
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
