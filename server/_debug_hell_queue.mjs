import { compileHellPromptOnly, hellPromptFromWorkspace, writeHellPrompt } from "./hell-comfy-push.js";
const jobs = hellPromptFromWorkspace({ mode: "selected" });
const text = jobs[0].text;
writeHellPrompt(text);
const built = await compileHellPromptOnly(text);
console.log("nodes", built.nodeCount);
console.log("warnings", built.warnings);
console.log("has376", !!built.prompt["376"], built.prompt["376"]?.class_type);
console.log("has380", !!built.prompt["380"], built.prompt["380"]?.class_type);
console.log("has395", !!built.prompt["395"], built.prompt["395"]?.inputs?.image);
const r = await fetch("http://127.0.0.1:8188/prompt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: built.prompt, client_id: "debug-hell" })
});
const raw = await r.text();
console.log("status", r.status);
console.log(raw.slice(0, 4000));
