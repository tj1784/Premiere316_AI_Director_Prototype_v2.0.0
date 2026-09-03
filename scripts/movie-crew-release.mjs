import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function stageReleaseContract() {
  const profile = JSON.parse(await readFile(resolve(ROOT, ".pi/movie-crew-profile.json"), "utf8"));
  return {
    action: "release-resident-claim",
    physicalUnload: profile.physicalUnload,
    neverAutoLoad: true,
    note: "Explicit stage/workflow boundary only. This command records a release request; it does not start LM Studio or load a model.",
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  stageReleaseContract().then((result) => console.log(JSON.stringify(result, null, 2)));
}
