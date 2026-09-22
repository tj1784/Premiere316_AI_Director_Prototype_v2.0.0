import { createServerFn } from "@tanstack/react-start";
import type { ProductionModelBinding } from "./production-profiles.ts";
export const discoverAstra = createServerFn({ method: "GET" }).handler(async () => {
  const { discoverAstraBinding } = await import("./astra-adapter.server.ts");
  return discoverAstraBinding();
});
export const generateBibleText = createServerFn({ method: "POST" })
  .validator(
    (input: {
      requestId: string;
      binding: ProductionModelBinding;
      system: string;
      prompt: string;
      reconcileOnly?: boolean;
    }) => {
      if (
        !input.requestId ||
        typeof input.system !== "string" ||
        typeof input.prompt !== "string" ||
        input.prompt.length > 500000
      )
        throw new Error("Invalid Bible request.");
      return input;
    },
  )
  .handler(async ({ data }) => {
    const { generateBibleUnit } = await import("./bible-runtime.server.ts");
    return generateBibleUnit(data);
  });
