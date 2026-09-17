import { createServerFn } from "@tanstack/react-start";

export const getDirectorRuntime = createServerFn({ method: "POST" })
  .handler(async () => {
    const { inspectDirectorRuntime } = await import("./director-runtime.server.ts");
    return inspectDirectorRuntime();
  });
