import { queueHellFromPremiere } from "./hell-comfy-push.js";
const r = await queueHellFromPremiere({ mode: "selected" });
console.log(JSON.stringify(r, null, 2));
