import { compileHellPromptOnly, hellPromptFromWorkspace } from "file:///C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/server/hell-comfy-push.js";

const jobs = hellPromptFromWorkspace({ segmentId: "segment-h01-s01-c01-01", mode: "selected" });
const job = jobs[0];
const built = await compileHellPromptOnly(job.text, { seconds: job.seconds, imageFile: job.imageFile });
const res = await fetch("http://127.0.0.1:8188/prompt", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: built.prompt, client_id: "randall-test" })
});
const raw = await res.text();
console.log(JSON.stringify({
  http: res.status,
  seconds: job.seconds,
  image: job.imageFile,
  nodes: built.nodeCount,
  has380: Boolean(built.prompt["398:380"] || built.prompt["380"]),
  enhance: built.prompt["398:383"]?.inputs?.value,
  body: raw.slice(0, 4000)
}, null, 2));
