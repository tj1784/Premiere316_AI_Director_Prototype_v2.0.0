export type StoryDoctorRun = {
  status: "running" | "completed" | "stopped" | "failed";
  model: string;
  startedAt: number;
  updatedAt: number;
  text: string;
  reasoning: string;
  error?: string;
};

export function createStoryDoctorRuns() {
  const records = new Map<string, StoryDoctorRun>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  const publish = (id: string, patch: Partial<StoryDoctorRun>) => {
    records.set(id, { ...records.get(id)!, ...patch, updatedAt: Date.now() });
    listeners.forEach((listener) => listener());
  };
  return {
    get: (id: string) => records.get(id) ?? null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop(id: string) {
      controllers.get(id)?.abort(new Error("Story Doctor stopped."));
      if (records.get(id)?.status === "running") publish(id, { status: "stopped" });
    },
    async run<T>(id: string, model: string, execute: (progress: { signal: AbortSignal; onText: (text: string) => void; onReasoning: (text: string) => void }) => Promise<T>): Promise<T> {
      if (controllers.has(id)) throw new Error("Story Doctor is already running for this picture.");
      const controller = new AbortController();
      controllers.set(id, controller);
      publish(id, { status: "running", model, startedAt: Date.now(), text: "", reasoning: "", error: undefined });
      try {
        const result = await execute({ signal: controller.signal,
          onText: (text) => { if (!controller.signal.aborted) publish(id, { text }); },
          onReasoning: (delta) => { if (!controller.signal.aborted) publish(id, { reasoning: ((records.get(id)?.reasoning ?? "") + delta).slice(-40000) }); },
        });
        if (controller.signal.aborted) throw controller.signal.reason;
        publish(id, { status: "completed" });
        return result;
      } catch (error) {
        publish(id, { status: controller.signal.aborted ? "stopped" : "failed", error: controller.signal.aborted ? undefined : error instanceof Error ? error.message : String(error) });
        throw error;
      } finally { controllers.delete(id); }
    },
  };
}

export const storyDoctorRuns = createStoryDoctorRuns();
