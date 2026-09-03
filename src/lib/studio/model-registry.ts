import { createServerFn } from "@tanstack/react-start";
import { sanitizeModelCatalog, type ModelCatalog } from "./model-catalog.ts";

export type CatalogQuery = {
  force?: boolean;
  deep?: boolean;
};

export const getModelCatalog = createServerFn({ method: "POST" })
  .validator((input: CatalogQuery | undefined) => ({
    force: Boolean(input?.force),
    deep: Boolean(input?.deep),
  }))
  .handler(async ({ data }): Promise<ModelCatalog> => {
    const { loadCatalog } = await import("./model-scan.server.ts");
    return sanitizeModelCatalog(loadCatalog({ force: data.force, deep: data.deep }));
  });
