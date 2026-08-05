import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

const MODEL = "qwen3.6-40b-claude-4.6-opus-deckard-heretic-uncensored-thinking-neo-code-di-imatrix-max";

function inlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>
  );
}

function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => {
    const output: React.ReactNode[] = [];
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    let code: string[] | null = null;
    lines.forEach((line, index) => {
      if (line.trim().startsWith("```")) {
        if (code) {
          output.push(<pre className="screenplay-script" key={`code-${index}`}>{code.join("\n")}</pre>);
          code = null;
        } else code = [];
        return;
      }
      if (code) {
        code.push(line);
        return;
      }
      const heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const Tag = `h${Math.min(4, level)}` as keyof React.JSX.IntrinsicElements;
        output.push(<Tag key={`heading-${index}`}>{inlineMarkdown(heading[2])}</Tag>);
      } else if (/^---+$/.test(line.trim())) {
        output.push(<hr key={`rule-${index}`} />);
      } else if (/^\s*[-*]\s+/.test(line)) {
        output.push(<div className="screenplay-list-item" key={`list-${index}`}>• {inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</div>);
      } else if (/^\s*\d+\.\s+/.test(line)) {
        output.push(<div className="screenplay-list-item numbered" key={`number-${index}`}>{inlineMarkdown(line.trim())}</div>);
      } else if (line.trim()) {
        output.push(<p key={`paragraph-${index}`}>{inlineMarkdown(line.trim())}</p>);
      }
    });
    if (code?.length) output.push(<pre className="screenplay-script" key="code-final">{code.join("\n")}</pre>);
    return output;
  }, [markdown]);
  return <div className="screenplay-document">{blocks}</div>;
}

function sectionNames(markdown: string, start: string, end: string) {
  const source = String(markdown || "");
  const from = source.search(new RegExp(start, "i"));
  if (from < 0) return [];
  const remainder = source.slice(from);
  const to = remainder.search(new RegExp(end, "i"));
  const section = to > 0 ? remainder.slice(0, to) : remainder;
  return [...section.matchAll(/^###\s+(.+)$/gm)].map((match) => match[1].replace(/\s+-\s+.+$/, "").trim());
}

function screenplayStats(markdown: string) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || "Untitled screenplay";
  const runtime = markdown.match(/\*\*Runtime[^:]*:\*\*\s*([^\n]+)/i)?.[1]?.trim() || "—";
  const scenes = (markdown.match(/^\s*(?:INT\.|EXT\.)[^\n]+$/gm) || []).length;
  const dialogue = (markdown.match(/^\s{20,}[A-Z][A-Z .'-]{2,}$/gm) || []).length;
  const characters = sectionNames(markdown, "## 1\\. CHARACTER ASSETS", "## 2\\. LOCATION ASSETS");
  const locations = sectionNames(markdown, "## 2\\. LOCATION ASSETS", "## 3\\. ARTIFACT ASSETS");
  const artifacts = sectionNames(markdown, "## 3\\. ARTIFACT ASSETS", "## 4\\. ATMOSPHERIC ASSETS");
  return { title, runtime, scenes, dialogue, characters, locations, artifacts, words: markdown.trim() ? markdown.trim().split(/\s+/).length : 0 };
}

export default function ScreenplayWorkspace({ onOpenEditor, onOpenAssets }: { onOpenEditor: () => void; onOpenAssets: () => void }) {
  const store = useStore();
  const project = store.project!;
  const screenplay = project.screenplay || null;
  const settings = screenplay?.settings || {};
  const importRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(screenplay?.markdown || ""));
  const [mode, setMode] = useState<"chat" | "preview" | "source">("chat");
  const [concept, setConcept] = useState(settings.concept || `${project.name}: a cinematic story with a complete screenplay and production asset package.`);
  const [runtimeMinutes, setRuntimeMinutes] = useState(Number(settings.runtimeMinutes) || 10);
  const [genre, setGenre] = useState(settings.genre || "Cinematic Biblical Epic / Supernatural Drama");
  const [aspectRatio, setAspectRatio] = useState(settings.aspectRatio || "2.39:1");
  const [rating, setRating] = useState(settings.rating || "PG-13");
  const [tone, setTone] = useState(settings.tone || "Cinematic, dramatic, emotionally sincere, visually coherent");
  const [additionalInstructions, setAdditionalInstructions] = useState(settings.additionalInstructions || "Include complete dialogue, asset prompts, voice direction, first and last frame prompts, and strict identity continuity.");
  const [targetShotSeconds, setTargetShotSeconds] = useState(15);
  const [maxShots, setMaxShots] = useState(40);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [chat, setChat] = useState<any[]>(Array.isArray(screenplay?.chat) ? screenplay.chat : []);
  const [chatInput, setChatInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<"idle" | "thinking" | "writing" | "editing">("idle");
  const [liveResponse, setLiveResponse] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const queuedSteerRef = useRef<string | null>(null);
  const draftRef = useRef(draft);
  const chatRef = useRef(chat);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streaming) {
      setDraft(String(project.screenplay?.markdown || ""));
      setChat(Array.isArray(project.screenplay?.chat) ? project.screenplay.chat : []);
    }
  }, [project.screenplay?.updatedAt, project.screenplay?.markdown, streaming]);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { chatRef.current = chat; }, [chat]);
  useEffect(() => {
    if (streaming && mode === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [liveResponse, streamPhase, streaming, mode]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const stats = useMemo(() => screenplayStats(draft), [draft]);
  const plan = project.screenplay?.shotPlan || null;
  const modelReady = Boolean(store.health.lmStudio && store.health.screenplayModelAvailable);
  const busy = store.screenplayBusy;
  const approval = screenplay?.approval || null;
  const approved = Boolean(
    approval?.status === "approved" &&
    approval?.screenplayRevision === screenplay?.revision &&
    draft === String(screenplay?.markdown || "")
  );

  function settingsPayload() {
    return { concept, runtimeMinutes, genre, aspectRatio, rating, tone, additionalInstructions };
  }

  async function runConversation(message: string, requestMode: "generate" | "revise" | "steer") {
    const direction = message.trim();
    if (!direction || streaming) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setStreamPhase("thinking");
    setLiveResponse("");
    setMode("chat");
    const userMessage = { id: `local-${Date.now()}-user`, role: "user", content: direction, mode: requestMode, createdAt: new Date().toISOString() };
    setChat((items) => [...items, userMessage]);
    if (requestMode === "generate") {
      setDraft("");
      draftRef.current = "";
    }
    let streamed = "";
    let completed = false;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.slug)}/screenplay/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: requestMode,
          message: direction,
          currentMarkdown: draftRef.current,
          history: chatRef.current,
          settings: settingsPayload()
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || response.statusText || "Screenplay chat failed");
      }
      if (!response.body) throw new Error("The screenplay stream did not provide a response body.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const handle = (event: any) => {
        if (event.type === "status") setStreamPhase(event.phase || "thinking");
        if (event.type === "delta") {
          const text = String(event.content || "");
          streamed += text;
          setLiveResponse(streamed);
          if (requestMode !== "revise") {
            draftRef.current = streamed;
          }
        }
        if (event.type === "error") throw new Error(event.error || "Screenplay chat failed");
        if (event.type === "done") {
          completed = true;
          const finalMarkdown = String(event.markdown || draftRef.current || "");
          draftRef.current = finalMarkdown;
          setDraft(finalMarkdown);
          setChat((items) => [...items, event.assistantMessage || {
            id: `local-${Date.now()}-assistant`, role: "assistant", content: event.response || "Screenplay updated.", kind: "reply", createdAt: new Date().toISOString()
          }]);
          if (event.warning) store.setError(event.warning);
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) if (line.trim()) handle(JSON.parse(line));
        if (done) break;
      }
      if (pending.trim()) handle(JSON.parse(pending));
      if (completed) await store.reloadProject();
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        const rawMessage = String(error.message || error);
        const connectionRestarted = /error in input stream|failed to fetch|network\s*error|terminated|load failed/i.test(rawMessage);
        store.setError(connectionRestarted
          ? "The Premiere316 server connection restarted during screenplay generation. Your story brief is safe—press Generate in Chat to retry."
          : rawMessage);
      }
      else if (streamed.trim()) {
        if (requestMode !== "revise") setDraft(streamed);
        setChat((items) => [...items, { id: `local-${Date.now()}-stopped`, role: "assistant", content: "Stopped here. I preserved the partial draft so your next direction can steer it.", kind: "stopped", createdAt: new Date().toISOString() }]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStreamPhase("idle");
      setLiveResponse("");
      const queued = queuedSteerRef.current;
      queuedSteerRef.current = null;
      if (queued) window.setTimeout(() => runConversation(queued, "steer"), 300);
    }
  }

  async function generate() {
    await runConversation("Create the complete screenplay and production package from this story brief.", "generate");
  }

  async function save() {
    try {
      await store.saveScreenplay(draft, { concept, runtimeMinutes, genre, aspectRatio, rating, tone, additionalInstructions });
    } catch {}
  }

  async function makePlan() {
    if (planning) return;
    setPlanning(true);
    try {
      if (draft !== project.screenplay?.markdown) await save();
      await store.createScreenplayShotPlan({ targetShotSeconds, maxShots });
    } catch {}
    finally { setPlanning(false); }
  }

  async function buildTimeline() {
    try {
      await store.buildScreenplayTimeline({ replaceExisting });
      onOpenEditor();
    } catch {}
  }

  async function buildAssets() {
    try {
      if (!approved) throw new Error("Approve this exact screenplay revision before building production assets.");
      await store.buildAssets({ markdown: draft });
      onOpenAssets();
    } catch (error: any) { store.setError(String(error.message || error)); }
  }

  async function approveScreenplay() {
    try {
      if (draft !== project.screenplay?.markdown) await save();
      await store.approveScreenplay();
    } catch {}
  }

  function sendChat() {
    const message = chatInput.trim();
    if (!message) return;
    setChatInput("");
    if (streaming) {
      queuedSteerRef.current = message;
      abortRef.current?.abort();
      return;
    }
    void runConversation(message, draftRef.current.trim() ? "revise" : "generate");
  }

  return (
    <main className="screenplay-workspace">
      <aside className="screenplay-generator premium-panel">
        <div className="screenplay-panel-title">
          <span>✦</span>
          <div><h2>Screenplay Director</h2><small>LM Studio · pinned local model</small></div>
        </div>
        <div className={`screenplay-model-card ${modelReady ? "ready" : "offline"}`}>
          <i />
          <div><b>{modelReady ? "Exact model ready" : "Model unavailable"}</b><small>{MODEL}</small></div>
        </div>
        <div className="screenplay-form-scroll">
          <label>Story brief<textarea rows={7} value={concept} onChange={(event) => setConcept(event.target.value)} /></label>
          <div className="screenplay-field-row">
            <label>Runtime (minutes)<input type="number" min={1} max={30} value={runtimeMinutes} onChange={(event) => setRuntimeMinutes(Number(event.target.value))} /></label>
            <label>Aspect ratio<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}><option>2.39:1</option><option>16:9</option><option>1.85:1</option><option>4:3</option><option>9:16</option></select></label>
          </div>
          <label>Genre<input value={genre} onChange={(event) => setGenre(event.target.value)} /></label>
          <div className="screenplay-field-row">
            <label>Rating<select value={rating} onChange={(event) => setRating(event.target.value)}><option>G</option><option>PG</option><option>PG-13</option><option>R</option><option>Unrated</option></select></label>
            <label>Output<select disabled><option>Full production package</option></select></label>
          </div>
          <label>Tone<input value={tone} onChange={(event) => setTone(event.target.value)} /></label>
          <label>Additional direction<textarea rows={4} value={additionalInstructions} onChange={(event) => setAdditionalInstructions(event.target.value)} /></label>
        </div>
        <div className="screenplay-generator-actions">
          <button className="button secondary" onClick={() => importRef.current?.click()} disabled={busy || streaming}>Import .md/.txt</button>
          <button className="button primary" onClick={generate} disabled={busy || streaming || !modelReady || !concept.trim()}>{streaming ? "Writing live…" : "Generate in Chat"}</button>
          <input
            ref={importRef}
            hidden
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setDraft(text);
              setMode("chat");
              try { await store.saveScreenplay(text, { importedFilename: file.name }); } catch {}
              event.target.value = "";
            }}
          />
        </div>
      </aside>

      <section className="screenplay-reader premium-panel">
        <header>
          <div><small>SCREENPLAY PACKAGE</small><h1>{stats.title}</h1></div>
          <div className="screenplay-reader-actions">
            <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>Chat</button>
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>Formatted</button>
            <button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>Markdown</button>
            <button className="button secondary" onClick={save} disabled={busy || streaming || !draft.trim()}>Save</button>
          </div>
        </header>
        {mode === "chat" ? (
          <div className="screenplay-chat-shell">
            <div className="screenplay-chat-scroll">
              {draft && !streaming ? (
                <details className="screenplay-current-draft" open={!chat.length}>
                  <summary><span>✦</span><div><b>Current screenplay package</b><small>{stats.words.toLocaleString()} words · click to {chat.length ? "open" : "collapse"}</small></div></summary>
                  <MarkdownDocument markdown={draft} />
                </details>
              ) : null}
              {!draft && !chat.length && !streaming ? (
                <div className="screenplay-chat-welcome">
                  <span>✦</span><h2>Write with your local screenplay director</h2>
                  <p>Start from the story brief, then talk naturally to correct dialogue, characters, scenes, prompts, camera direction, or continuity.</p>
                </div>
              ) : null}
              {chat.map((message: any, index: number) => (
                <article className={`screenplay-chat-message ${message.role}`} key={message.id || `${message.role}-${index}`}>
                  <div className="screenplay-chat-avatar">{message.role === "user" ? "TJ" : "✦"}</div>
                  <div className="screenplay-chat-bubble">
                    <header><b>{message.role === "user" ? "You" : "Screenplay Director"}</b><small>{message.mode === "steer" ? "Live steering" : message.kind === "stopped" ? "Stopped" : message.role === "assistant" ? "Pinned Qwen 40B" : "Director note"}</small></header>
                    {message.role === "assistant" && message.kind === "document"
                      ? <p>Completed a new screenplay package. The current approved copy is shown above and remains available in Formatted and Markdown views.</p>
                      : <div className="screenplay-chat-copy">{String(message.content || "")}</div>}
                    {message.warning ? <small className="screenplay-chat-warning">{message.warning}</small> : null}
                  </div>
                </article>
              ))}
              {streaming ? (
                <article className="screenplay-chat-message assistant live">
                  <div className="screenplay-chat-avatar">✦</div>
                  <div className="screenplay-chat-bubble">
                    <header><b>Screenplay Director</b><small>{streamPhase === "thinking" ? "Thinking…" : streamPhase === "editing" ? "Applying corrections live…" : "Writing screenplay live…"}</small></header>
                    {liveResponse
                      ? <pre className="screenplay-live-output">{liveResponse}<i className="screenplay-caret" /></pre>
                      : <div className="screenplay-thinking"><i /><i /><i /><span>The model is thinking before it writes. You can steer it now.</span></div>}
                    <footer><span>≈ {Math.ceil(liveResponse.length / 4).toLocaleString()} visible tokens</span><span>Exact model · local</span></footer>
                  </div>
                </article>
              ) : null}
              <div ref={chatEndRef} />
            </div>
            <div className={`screenplay-composer ${streaming ? "streaming" : ""}`}>
              <textarea
                rows={3}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(); }
                }}
                placeholder={streaming ? "Interject now—tell Qwen what to change or emphasize…" : draft ? "Ask for a correction, rewrite, expansion, or continuity change…" : "Tell the screenplay director what to create…"}
              />
              <div className="screenplay-composer-bar">
                <span>{streaming ? "Sending now stops the current draft and continues with your direction." : "Enter to send · Shift+Enter for a new line"}</span>
                {streaming ? <button className="button secondary screenplay-stop" onClick={() => abortRef.current?.abort()}>■ Stop</button> : null}
                <button className="button primary screenplay-send" disabled={!chatInput.trim() || !modelReady} onClick={sendChat}>{streaming ? "Steer now ↗" : "Send ↗"}</button>
              </div>
            </div>
          </div>
        ) : draft ? (
          mode === "preview"
            ? <div className="screenplay-reader-scroll"><MarkdownDocument markdown={draft} /></div>
            : <textarea className="screenplay-source-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
        ) : (
          <div className="screenplay-empty"><span>✦</span><h2>Create the complete film package</h2><p>Generate in Chat or import an existing Markdown screenplay package.</p></div>
        )}
        {busy ? <div className="screenplay-busy"><span /><b>Updating the project…</b><small>Saving, planning, approval, and production operations are preserved automatically.</small></div> : null}
      </section>

      <aside className="screenplay-inspector premium-panel">
        <div className="screenplay-panel-title compact"><span>▤</span><div><h2>Production Breakdown</h2><small>Document intelligence</small></div></div>
        <div className="screenplay-stat-grid">
          <div><b>{stats.words.toLocaleString()}</b><span>Words</span></div>
          <div><b>{stats.scenes}</b><span>Sluglines</span></div>
          <div><b>{stats.characters.length}</b><span>Characters</span></div>
          <div><b>{stats.locations.length}</b><span>Locations</span></div>
        </div>
        <dl className="screenplay-facts">
          <div><dt>Runtime</dt><dd>{stats.runtime}</dd></div>
          <div><dt>Source</dt><dd>{screenplay?.source || "—"}</dd></div>
          <div><dt>Model</dt><dd>{screenplay?.model ? "Pinned Qwen 40B" : "—"}</dd></div>
        </dl>
        <div className={`screenplay-approval ${approved ? "approved" : "pending"}`}>
          <span className="screenplay-approval-step">STEP 1 OF 2 · REQUIRED</span>
          <div><i>{approved ? "✓" : "!"}</i><span><b>{approved ? "SCREENPLAY APPROVED" : "APPROVE THIS SCREENPLAY"}</b><small>{approved ? `Exact revision approved ${new Date(approval.approvedAt).toLocaleString()}` : "Review the screenplay, then approve it to unlock all production assets."}</small></span></div>
          {approved ? (
            <button className="button full primary screenplay-approval-cta" disabled={busy || streaming} onClick={buildAssets}>
              {project.assets?.items?.length ? `CONTINUE TO ${project.assets.items.length} ASSETS →` : "BUILD PRODUCTION ASSETS →"}
            </button>
          ) : (
            <button className="button full primary screenplay-approval-cta" disabled={busy || streaming || !draft.trim()} onClick={approveScreenplay}>
              {draft.trim() ? "✓ APPROVE THIS SCREENPLAY" : "GENERATE OR IMPORT A SCREENPLAY FIRST"}
            </button>
          )}
          <small>{approved ? "You can now generate assets. Editing the screenplay will lock them again." : "This approves only the exact screenplay currently shown above."}</small>
        </div>
        <div className="screenplay-assets">
          <h3>Character assets</h3>
          <div>{stats.characters.length ? stats.characters.slice(0, 12).map((name) => <span key={name}>{name}</span>) : <em>No parsed character assets</em>}</div>
          <h3>Location assets</h3>
          <div>{stats.locations.length ? stats.locations.slice(0, 10).map((name) => <span key={name}>{name}</span>) : <em>No parsed location assets</em>}</div>
          <h3>Artifacts</h3>
          <div>{stats.artifacts.length ? stats.artifacts.slice(0, 10).map((name) => <span key={name}>{name}</span>) : <em>No parsed artifact assets</em>}</div>
          <div className={`screenplay-assets-gate ${approved ? "open" : "locked"}`}><span>{approved ? "✓" : "🔒"}</span>{approved ? "Asset generation unlocked" : "Approve in Step 1 above to unlock assets"}</div>
        </div>
        <div className="screenplay-shot-planner">
          <div className="screenplay-section-heading"><h3>LTX Shot Planner</h3>{plan ? <span>{plan.shots?.length || 0} clips</span> : null}</div>
          <div className="screenplay-field-row">
            <label>Target seconds<input type="number" min={6} max={30} value={targetShotSeconds} onChange={(event) => setTargetShotSeconds(Number(event.target.value))} /></label>
            <label>Max clips<input type="number" min={4} max={60} value={maxShots} onChange={(event) => setMaxShots(Number(event.target.value))} /></label>
          </div>
          <button className="button secondary full" disabled={busy || planning || !draft.trim() || !modelReady} onClick={makePlan}>{planning ? "Qwen is building the shot plan…" : plan ? "Regenerate Shot Plan" : "Generate Shot Plan"}</button>
          {plan ? (
            <div className="screenplay-shot-list">
              {plan.shots.slice(0, 12).map((shot: any, index: number) => <div key={`${shot.name}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{shot.name}</span><small>{shot.durationSec}s</small></div>)}
              {plan.shots.length > 12 ? <em>+ {plan.shots.length - 12} more clips</em> : null}
            </div>
          ) : <p className="screenplay-hint">The same model will convert the script into identity-locked LTX prompts, temporal motion segments, frame prompts, dialogue, voice, and audio direction. Large plans can take 10–20 minutes locally; Premiere316 now keeps the model connection alive beyond five minutes.</p>}
          <label className="screenplay-check"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} /> Replace the existing timeline</label>
          <button className="button primary full" disabled={busy || !plan?.shots?.length} onClick={buildTimeline}>Build {plan?.shots?.length || 0} Timeline Clips</button>
          <small className="screenplay-warning">Generated clips are intentionally image-ready. Attach or generate their first/middle/last guides before rendering.</small>
        </div>
      </aside>
    </main>
  );
}
