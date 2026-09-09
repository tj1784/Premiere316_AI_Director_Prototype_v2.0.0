import { spawn } from "node:child_process";

const code = `import json,sys,os
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
from transformers import AutoProcessor,AutoTokenizer
tokenizers={}
for line in sys.stdin:
 try:
  v=json.loads(line)
  engine=v.get('engineId','flux2')
  if engine not in ('flux2','krea-2'): raise ValueError('Unsupported asset prompt tokenizer')
  if engine not in tokenizers:
   if engine=='krea-2': tokenizers[engine]=AutoTokenizer.from_pretrained(r'D:\\Projects\\krea-2\\local-components\\qwen3-vl-4b',local_files_only=True)
   else: tokenizers[engine]=AutoProcessor.from_pretrained(r'D:\\_Cache\\HuggingFace\\hub\\models--mistralai--Mistral-Small-3.1-24B-Instruct-2503\\snapshots\\68faf511d618ef198fef186659617cfd2eb8e33a',use_fast=False,local_files_only=True).tokenizer
  tokens=tokenizers[engine].encode(v['prompt'],add_special_tokens=False)
  print(json.dumps({'id':v['id'],'count':len(tokens)}),flush=True)
 except Exception as e: print(json.dumps({'id':v.get('id'),'error':str(e)}),flush=True)
`;
let process: ReturnType<typeof spawn> | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (count: number) => void; reject: (error: Error) => void }>();

export function assetTokenizerIdentity(engineId = "flux2") {
  if (engineId === "krea-2") return { engineId, modelId: "Qwen/Qwen3-VL-4B-Instruct", label: "KREA 2 RAW" };
  if (engineId === "flux2") return { engineId, modelId: "mistralai/Mistral-Small-3.1-24B-Instruct-2503", label: "FLUX.2" };
  throw new Error(`No asset prompt tokenizer is configured for ${engineId}.`);
}

export function countFlux2PromptTokens(prompt: string): Promise<number> { return countImagePromptTokens(prompt, "flux2"); }

export function countImagePromptTokens(prompt: string, engineId = "flux2"): Promise<number> {
  const identity = assetTokenizerIdentity(engineId);
  if (!process) {
    const child = spawn("D:\\Dev\\Tools\\Python312\\python.exe", ["-u", "-c", code], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: { ...globalThis.process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    process = child;
    let buffer = ""; let stderr = "";
    child.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.stdout!.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { const row = JSON.parse(line); const waiter = pending.get(row.id); if (waiter) { pending.delete(row.id); row.error ? waiter.reject(new Error(row.error)) : waiter.resolve(row.count); } } catch { /* only JSON protocol records are consumed */ }
      }
    });
    const fail = (message: string) => { if (process === child) process = null; for (const waiter of pending.values()) waiter.reject(new Error(message)); pending.clear(); };
    child.on("error", (error) => fail(error.message));
    child.on("exit", () => fail(`Asset prompt tokenizer exited: ${stderr}`));
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${identity.label} tokenizer timed out.`)); }, 60000);
    pending.set(id, { resolve: (count) => { clearTimeout(timer); resolve(count); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    process!.stdin!.write(`${JSON.stringify({ id, prompt, engineId })}\n`);
  });
}

export function releaseAssetTokenizer(): void { process?.kill(); }
