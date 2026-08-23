import { compileHellPromptOnly } from "./hell-comfy-push.js";
const built = await compileHellPromptOnly("test");
const keys = Object.keys(built.prompt);
console.log("count", keys.length);
console.log("has398", keys.filter(k => k.includes("398:")).length);
console.log("376", !!built.prompt["376"], !!built.prompt["398:376"]);
console.log("380", !!built.prompt["380"], !!built.prompt["398:380"]);
console.log("382", !!built.prompt["398:382"]);
console.log("75video", built.prompt["75"]?.inputs?.video);
