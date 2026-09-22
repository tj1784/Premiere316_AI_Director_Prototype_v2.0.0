import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
const exec = promisify(execFile);
type NativeRow = {
  modelKey: string;
  path: string;
  indexedModelIdentifier: string;
  selectedVariant?: string;
  variants?: string[];
};
export async function installedBibleArtifact(modelId: string): Promise<string> {
  const executable = join(homedir(), ".lmstudio", "bin", "lms.exe");
  const { stdout } = await exec(executable, ["ls", "--json"], {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const rows = JSON.parse(stdout) as NativeRow[];
  const matches = rows.filter((r) => r.modelKey === modelId);
  if (matches.length !== 1)
    throw new Error(`No unambiguous native artifact mapping for ${modelId}.`);
  let row = matches[0];
  if (row.variants?.length) {
    const { stdout: detail } = await exec(executable, ["ls", modelId, "--json"], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(detail);
    const variants: NativeRow[] = Array.isArray(parsed)
      ? parsed.flatMap((r) => r.variants ?? [r])
      : (parsed.variants ?? []);
    const selected = variants.filter((v) => v.modelKey === row.selectedVariant);
    if (selected.length !== 1)
      throw new Error(`Native variant mapping is ambiguous for ${modelId}.`);
    row = selected[0];
  }
  let file = row.indexedModelIdentifier.includes("@")
    ? row.indexedModelIdentifier.split("@").slice(1).join("@")
    : row.path;
  if (!file.toLowerCase().endsWith(".gguf"))
    throw new Error(`Native discovery did not identify an exact GGUF file for ${modelId}.`);
  const settings = JSON.parse(
    await readFile(join(homedir(), ".lmstudio", "settings.json"), "utf8"),
  );
  const root = await realpath(settings.downloadsFolder || join(homedir(), ".lmstudio", "models"));
  file = await realpath(isAbsolute(file) ? file : resolve(root, file));
  const rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new Error("Discovered model file is outside the configured model directory.");
  return file;
}
