import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import qwenEmotionalPresets from "../data/qwen-emotional-presets.json";
import "./QwenTtsDemoWorkspace.css";

const QWEN_EMOTIONS = Object.keys(qwenEmotionalPresets as Record<string, unknown>).sort();

type DemoMode = "voice-design" | "voice-clone" | "custom-voice";
type DemoStatus = { kind: "idle" | "busy" | "ok" | "error"; text: string };

const LANGUAGES = [
  { value: "Auto", label: "Auto" },
  { value: "English", label: "English" },
  { value: "Chinese", label: "Chinese" },
  { value: "Japanese", label: "Japanese" },
  { value: "Korean", label: "Korean" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Spanish", label: "Spanish" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Russian", label: "Russian" }
];

const SPEAKERS = ["Aiden", "Dylan", "Eric", "Ono_anna", "Ryan", "Serena", "Sohee", "Uncle_fu", "Vivian"];
const MODEL_SIZES = ["1.7B", "0.6B"];
const MODES: Array<{ id: DemoMode; label: string; blurb: string }> = [
  { id: "voice-design", label: "Voice Design", blurb: "Create custom voices using natural language descriptions" },
  { id: "voice-clone", label: "Voice Clone (Base)", blurb: "Clone any voice from a reference audio" },
  { id: "custom-voice", label: "TTS (CustomVoice)", blurb: "Predefined speakers and optional style instructions" }
];

export type QwenTtsDemoWorkspaceProps = {
  slug: string;
  active: boolean;
  jobs: any[];
  onStatusChange?: (status: { label: string; detail: string; status: "ready" | "waiting" | "offline" }) => void;
};

function audioUrl(item: any, slug: string) {
  const direct = String(item?.mediaUrl || item?.nativeMediaUrl || "").trim();
  if (direct) return direct.startsWith("/") || /^(https?:|blob:)/i.test(direct) ? direct : `/${direct}`;
  const file = String(item?.file || item?.outputFile || item?.nativeFile || "").replace(/\\/g, "/").split("/").pop();
  return file ? `/media/${encodeURIComponent(slug)}/audio/${encodeURIComponent(file)}` : "";
}

export default function QwenTtsDemoWorkspace({ slug, active, jobs, onStatusChange }: QwenTtsDemoWorkspaceProps) {
  const store = useStore();
  const [mode, setMode] = useState<DemoMode>("voice-design");
  const [status, setStatus] = useState<DemoStatus>({ kind: "idle", text: "Ready." });
  const [audioSrc, setAudioSrc] = useState("");
  const [busy, setBusy] = useState(false);

  const [designText, setDesignText] = useState("It's in the top drawer... wait, it's empty? No way, that's impossible! I'm sure I put it there!");
  const [designLanguage, setDesignLanguage] = useState("Auto");
  const [designInstruct, setDesignInstruct] = useState("Speak in an incredulous tone, but with a hint of panic beginning to creep into your voice.");

  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneRefText, setCloneRefText] = useState("");
  const [cloneTarget, setCloneTarget] = useState("");
  const [cloneLanguage, setCloneLanguage] = useState("Auto");
  const [cloneXvec, setCloneXvec] = useState(false);
  const [cloneSize, setCloneSize] = useState("1.7B");
  const [primaryEmotion, setPrimaryEmotion] = useState("angry");
  const [secondaryEmotion, setSecondaryEmotion] = useState("contemptuous");
  const [tertiaryEmotion, setTertiaryEmotion] = useState("none");
  const [emotionIntensity, setEmotionIntensity] = useState(1.3);

  const [ttsText, setTtsText] = useState("Hello! Welcome to Text-to-Speech system. This is a demo of our TTS capabilities.");
  const [ttsLanguage, setTtsLanguage] = useState("English");
  const [ttsSpeaker, setTtsSpeaker] = useState("Ryan");
  const [ttsInstruct, setTtsInstruct] = useState("");
  const [ttsSize, setTtsSize] = useState("1.7B");

  const health = store.health || {};
  const voiceDesignReady = Boolean(health?.qwenVoiceDesign?.ready || health?.providers?.qwenVoiceDesign?.ready);
  const cloneReady = Boolean(health?.qwenTts?.ready || health?.providers?.qwenTts?.ready || health?.capabilities?.qwenTts);
  const customVoice = health?.qwenCustomVoice || health?.providers?.qwenCustomVoice || null;
  const customReady = Boolean(customVoice?.ready);

  useEffect(() => {
    if (!onStatusChange) return;
    const ready = mode === "voice-design" ? voiceDesignReady : mode === "voice-clone" ? cloneReady : customReady;
    const label = "Qwen3-TTS Demo";
    const detail = mode === "voice-design"
      ? (voiceDesignReady ? "VoiceDesign 1.7B ready" : "VoiceDesign offline")
      : mode === "voice-clone"
        ? (cloneReady ? `Base ${cloneSize} clone ready` : "Qwen Base clone offline")
        : (customReady ? `CustomVoice ${ttsSize} ready` : "CustomVoice model not installed");
    onStatusChange({ label, detail, status: ready ? "ready" : "offline" });
  }, [onStatusChange, mode, voiceDesignReady, cloneReady, customReady, cloneSize, ttsSize]);

  const latestTake = useMemo(() => {
    const generations = store.project?.sound?.generations || [];
    return [...generations].reverse().find((item: any) => String(item?.name || "").includes("QwenTTS Demo")) || null;
  }, [store.project?.sound?.generations]);

  useEffect(() => {
    if (!latestTake) return;
    const url = audioUrl(latestTake, slug);
    if (url) setAudioSrc(url);
  }, [latestTake, slug]);

  async function pollJob(jobId: string) {
    const started = Date.now();
    while (Date.now() - started < 12 * 60 * 1000) {
      await store.refreshQueue?.();
      const job = (store.jobs || jobs || []).find((item: any) => item.id === jobId);
      const state = String(job?.status || "");
      setStatus({ kind: "busy", text: job?.stage || state || "Generating…" });
      if (["done", "error", "failed", "cancelled"].includes(state) || !job) {
        if (state !== "done") throw new Error(job?.error || job?.stage || "Generation failed");
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
    throw new Error("Timed out waiting for QwenTTS Demo generation");
  }

  async function runDesign(event: React.FormEvent) {
    event.preventDefault();
    if (!designText.trim() || !designInstruct.trim()) {
      setStatus({ kind: "error", text: "Text and voice description are required." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "busy", text: "Queueing Voice Design…" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/voice-design/auditions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voiceName: "QwenTTS Demo",
          language: designLanguage,
          auditionText: designText.trim(),
          instruct: designInstruct.trim(),
          auditionCount: 1,
          seed: 42
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `Voice Design failed (${response.status})`);
      if (json.job?.id) await pollJob(json.job.id);
      await store.reloadProject?.();
      const session = json.session;
      const audition = (session?.auditions || []).find((item: any) => item.status === "done") || session?.auditions?.[0];
      const url = audition ? `/api/projects/${encodeURIComponent(slug)}/sound/voice-design/auditions/${encodeURIComponent(audition.id)}/native` : "";
      if (url) setAudioSrc(`${url}?t=${Date.now()}`);
      setStatus({ kind: "ok", text: "Voice design generation completed successfully!" });
    } catch (error: any) {
      setStatus({ kind: "error", text: String(error.message || error) });
    } finally {
      setBusy(false);
    }
  }

  async function runClone(event: React.FormEvent) {
    event.preventDefault();
    if (!cloneTarget.trim()) {
      setStatus({ kind: "error", text: "Target text is required." });
      return;
    }
    if (!cloneFile) {
      setStatus({ kind: "error", text: "Reference audio is required." });
      return;
    }
    if (!cloneXvec && !cloneRefText.trim()) {
      setStatus({ kind: "error", text: "Reference text is required when x-vector only is off." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "busy", text: "Queueing Voice Clone…" });
    try {
      const body = new FormData();
      body.set("referenceAudio", cloneFile, cloneFile.name);
      if (cloneRefText.trim()) body.set("referenceTranscript", cloneRefText.trim());
      body.set("text", cloneTarget.trim());
      body.set("language", cloneLanguage === "Auto" ? "AUTO" : cloneLanguage.slice(0, 2).toUpperCase());
      body.set("speaker", "QwenTTS Demo");
      body.set("name", "QwenTTS Demo clone");
      body.set("style", [primaryEmotion, secondaryEmotion, tertiaryEmotion].filter((name) => name && name !== "none").join(" + "));
      body.set("primaryEmotion", primaryEmotion);
      body.set("secondaryEmotion", secondaryEmotion);
      body.set("tertiaryEmotion", tertiaryEmotion);
      body.set("emotionIntensity", String(emotionIntensity));
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/qwen-tts/generations`, { method: "POST", body });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `Voice Clone failed (${response.status})`);
      if (json.job?.id) await pollJob(json.job.id);
      await store.reloadProject?.();
      const url = audioUrl(json.generation, slug);
      if (url) setAudioSrc(`${url}?t=${Date.now()}`);
      setStatus({ kind: "ok", text: "Voice clone generation completed successfully!" });
    } catch (error: any) {
      setStatus({ kind: "error", text: String(error.message || error) });
    } finally {
      setBusy(false);
    }
  }

  async function runCustom(event: React.FormEvent) {
    event.preventDefault();
    if (!ttsText.trim()) {
      setStatus({ kind: "error", text: "Text is required." });
      return;
    }
    setBusy(true);
    setStatus({ kind: "busy", text: "Queueing CustomVoice…" });
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/sound/qwen-custom-voice/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: ttsText.trim(),
          language: ttsLanguage,
          speaker: ttsSpeaker,
          instruct: ttsInstruct.trim(),
          modelSize: ttsSize,
          name: "QwenTTS Demo custom"
        })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || json.reason || `CustomVoice failed (${response.status})`);
      if (json.job?.id) await pollJob(json.job.id);
      await store.reloadProject?.();
      const url = audioUrl(json.generation, slug);
      if (url) setAudioSrc(`${url}?t=${Date.now()}`);
      setStatus({ kind: "ok", text: "Generation completed successfully!" });
    } catch (error: any) {
      setStatus({ kind: "error", text: String(error.message || error) });
    } finally {
      setBusy(false);
    }
  }

  if (!active) return null;

  return (
    <div className="qwen-tts-demo" data-testid="qwen-tts-demo">
      <header className="qwen-tts-demo-hero">
        <p className="eyebrow">Qwen3-TTS Demo</p>
        <h2>Official Qwen TTS modes</h2>
        <small>Same layout as <a href="https://huggingface.co/spaces/Qwen/Qwen3-TTS" target="_blank" rel="noreferrer">huggingface.co/spaces/Qwen/Qwen3-TTS</a> · local GPU only</small>
      </header>

      <nav className="qwen-tts-demo-modes" role="tablist" aria-label="QwenTTS Demo modes">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={mode === item.id}
            className={mode === item.id ? "active" : ""}
            data-testid={`qwen-tts-demo-mode-${item.id}`}
            onClick={() => setMode(item.id)}
          >
            <b>{item.label}</b>
            <small>{item.blurb}</small>
          </button>
        ))}
      </nav>

      {mode === "voice-design" ? (
        <form className="qwen-tts-demo-grid" onSubmit={runDesign} data-testid="qwen-tts-demo-voice-design">
          <section>
            <h3>Create Custom Voice with Natural Language</h3>
            <label>Text to Synthesize
              <textarea rows={5} value={designText} onChange={(event) => setDesignText(event.target.value)} />
            </label>
            <label>Language
              <select value={designLanguage} onChange={(event) => setDesignLanguage(event.target.value)}>
                {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Voice Description
              <textarea rows={4} value={designInstruct} onChange={(event) => setDesignInstruct(event.target.value)} placeholder="Describe the voice characteristics you want…" />
            </label>
            <button className="button primary" type="submit" disabled={busy || !voiceDesignReady}>{busy ? "Generating…" : "Generate with Custom Voice"}</button>
            {!voiceDesignReady ? <p className="qwen-tts-demo-note">VoiceDesign 1.7B is offline.</p> : null}
          </section>
          <aside>
            <label>Generated Audio
              {audioSrc ? <audio controls src={audioSrc} /> : <div className="qwen-tts-demo-empty">No take yet</div>}
            </label>
            <label>Status
              <textarea rows={3} readOnly value={status.text} className={status.kind} />
            </label>
          </aside>
        </form>
      ) : null}

      {mode === "voice-clone" ? (
        <form className="qwen-tts-demo-grid clone" onSubmit={runClone} data-testid="qwen-tts-demo-voice-clone">
          <section>
            <h3>Clone Voice from Reference Audio</h3>
            <label>Reference Audio
              <input type="file" accept="audio/wav,.wav" onChange={(event) => setCloneFile(event.target.files?.[0] || null)} />
              <small>{cloneFile ? cloneFile.name : "Upload a WAV voice sample to clone"}</small>
            </label>
            <label>Reference Text
              <textarea rows={3} value={cloneRefText} onChange={(event) => setCloneRefText(event.target.value)} placeholder="Exact transcript of the reference audio…" disabled={cloneXvec} />
            </label>
            <label className="qwen-tts-demo-check">
              <input type="checkbox" checked={cloneXvec} onChange={(event) => setCloneXvec(event.target.checked)} />
              Use x-vector only (no reference text, lower quality)
            </label>
          </section>
          <section>
            <h3>Target</h3>
            <label>Target Text
              <textarea rows={5} value={cloneTarget} onChange={(event) => setCloneTarget(event.target.value)} placeholder="Text the cloned voice should speak…" />
            </label>
            <div className="qwen-tts-demo-row">
              <label>Language
                <select value={cloneLanguage} onChange={(event) => setCloneLanguage(event.target.value)}>
                  {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>Model Size
                <select value={cloneSize} onChange={(event) => setCloneSize(event.target.value)}>
                  {MODEL_SIZES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <div className="qwen-tts-demo-row">
              <label>Primary emotion
                <select value={primaryEmotion} onChange={(event) => setPrimaryEmotion(event.target.value)}>
                  {QWEN_EMOTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>Secondary
                <select value={secondaryEmotion} onChange={(event) => setSecondaryEmotion(event.target.value)}>
                  <option value="none">none</option>
                  {QWEN_EMOTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
            <div className="qwen-tts-demo-row">
              <label>Tertiary
                <select value={tertiaryEmotion} onChange={(event) => setTertiaryEmotion(event.target.value)}>
                  <option value="none">none</option>
                  {QWEN_EMOTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>Intensity {emotionIntensity.toFixed(1)}x
                <input type="range" min="0" max="2" step="0.1" value={emotionIntensity} onChange={(event) => setEmotionIntensity(Number(event.target.value))} />
              </label>
            </div>
            <button className="button primary" type="submit" disabled={busy || !cloneReady}>{busy ? "Generating…" : "Clone & Generate"}</button>
            {!cloneReady ? <p className="qwen-tts-demo-note">Qwen Base 1.7B is offline.</p> : null}
          </section>
          <aside>
            <label>Generated Audio
              {audioSrc ? <audio controls src={audioSrc} /> : <div className="qwen-tts-demo-empty">No take yet</div>}
            </label>
            <label>Status
              <textarea rows={3} readOnly value={status.text} className={status.kind} />
            </label>
          </aside>
        </form>
      ) : null}

      {mode === "custom-voice" ? (
        <form className="qwen-tts-demo-grid" onSubmit={runCustom} data-testid="qwen-tts-demo-custom-voice">
          <section>
            <h3>Text-to-Speech with Predefined Speakers</h3>
            <label>Text to Synthesize
              <textarea rows={5} value={ttsText} onChange={(event) => setTtsText(event.target.value)} />
            </label>
            <div className="qwen-tts-demo-row">
              <label>Language
                <select value={ttsLanguage} onChange={(event) => setTtsLanguage(event.target.value)}>
                  {LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>Speaker
                <select value={ttsSpeaker} onChange={(event) => setTtsSpeaker(event.target.value)}>
                  {SPEAKERS.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
                </select>
              </label>
            </div>
            <div className="qwen-tts-demo-row">
              <label>Style Instruction (Optional)
                <textarea rows={3} value={ttsInstruct} onChange={(event) => setTtsInstruct(event.target.value)} placeholder="e.g., Speak in a cheerful and energetic tone" />
              </label>
              <label>Model Size
                <select value={ttsSize} onChange={(event) => setTtsSize(event.target.value)}>
                  {MODEL_SIZES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            </div>
            <button className="button primary" type="submit" disabled={busy}>{busy ? "Generating…" : "Generate Speech"}</button>
            {!customReady ? <p className="qwen-tts-demo-note">CustomVoice {ttsSize} is not installed locally. Voice Design and Base clone still work.</p> : null}
          </section>
          <aside>
            <label>Generated Audio
              {audioSrc ? <audio controls src={audioSrc} /> : <div className="qwen-tts-demo-empty">No take yet</div>}
            </label>
            <label>Status
              <textarea rows={3} readOnly value={status.text} className={status.kind} />
            </label>
          </aside>
        </form>
      ) : null}
    </div>
  );
}
