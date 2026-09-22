import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

type Result = { text: string; modelId: string; evidenceJson: string };
type Entry = {
  fingerprint: string;
  status: "running" | "complete" | "failed";
  result?: Result;
  error?: string;
};
const pending = new Map<string, Promise<Result>>();
/** A crash leaves an explicit uncertain request, never permission to replay inference. */
export async function durableBibleRequest(
  requestId: string,
  payload: unknown,
  reconcileOnly: boolean,
  execute: () => Promise<Result>,
  root = join(homedir(), ".premiere316", "bible-requests"),
): Promise<Result> {
  const key = createHash("sha256").update(requestId).digest("hex");
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await mkdir(root, { recursive: true });
  const file = join(root, `${key}.json`);
  const write = async (entry: Entry) => {
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(entry), { encoding: "utf8", mode: 0o600 });
    await rename(temp, file);
  };
  let existing: Entry | undefined;
  try {
    existing = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Request ledger cannot be verified. No request dispatched.");
  }
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      throw new Error("Request ID already belongs to a different immutable payload.");
    if (existing.status === "complete" && existing.result) return existing.result;
    if (existing.status === "failed")
      throw new Error(existing.error ?? "Previous request failed; use an explicit new attempt.");
    const active = pending.get(file);
    if (active) return active;
    throw new Error(
      "Interrupted request has unknown provider outcome. Automatic replay is blocked; inspect the provider before explicitly retrying as a new attempt.",
    );
  }
  if (reconcileOnly)
    throw new Error(
      "No durable receipt for this interrupted request. No inference was dispatched. Explicitly retry only after checking the provider outcome.",
    );
  // Exclusive creation prevents two requests from claiming the same ID.
  try {
    await writeFile(file, JSON.stringify({ fingerprint, status: "running" }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    throw new Error(
      "This request is already being claimed. Reconcile it instead of dispatching a duplicate.",
    );
  }
  const operation = (async () => {
    try {
      const result = await execute();
      await write({ fingerprint, status: "complete", result });
      return result;
    } catch (error) {
      await write({
        fingerprint,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      pending.delete(file);
    }
  })();
  pending.set(file, operation);
  return operation;
}
