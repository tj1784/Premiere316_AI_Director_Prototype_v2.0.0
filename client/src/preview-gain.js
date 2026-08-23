export function dbToLinear(value) {
  const db = Number(value);
  if (!Number.isFinite(db)) return 1;
  return Math.max(0, Math.pow(10, db / 20));
}

export function createPreviewGainController() {
  let context = null;
  const nodes = new WeakMap();

  function ensureContext() {
    if (context) return context;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  }

  function attach(element) {
    if (!element) return null;
    if (nodes.has(element)) return nodes.get(element);
    const audioContext = ensureContext();
    if (!audioContext || typeof audioContext.createMediaElementSource !== "function") return null;
    try {
      const source = audioContext.createMediaElementSource(element);
      const gain = audioContext.createGain();
      source.connect(gain);
      gain.connect(audioContext.destination);
      const node = { source, gain, context: audioContext };
      nodes.set(element, node);
      return node;
    } catch {
      return null;
    }
  }

  async function setGainDb(element, db) {
    const linear = dbToLinear(db);
    const node = attach(element);
    if (node) {
      element.muted = false;
      element.volume = 1;
      node.gain.gain.value = linear;
      if (node.context.state === "suspended") {
        try { await node.context.resume(); } catch {}
      }
      return linear;
    }
    element.volume = Math.min(1, linear);
    return Math.min(1, linear);
  }

  return { setGainDb, dbToLinear, attach };
}
