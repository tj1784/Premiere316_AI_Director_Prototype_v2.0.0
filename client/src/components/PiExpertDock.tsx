import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

const MODEL = "qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive";

type PiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  steered?: boolean;
  queued?: boolean;
};

type PiStatus = {
  running?: boolean;
  starting?: boolean;
  streaming?: boolean;
  phase?: string;
  workerActive?: boolean;
  activeTool?: string | null;
  lastError?: string | null;
  conversation?: PiMessage[];
  pageContext?: any;
  orchestrator?: boolean;
  workerModelMatches?: boolean;
  forcedDelegation?: boolean;
  delegationCount?: number;
  queuedTasks?: number;
};

function getTabId() {
  const key = "premiere316-pi-tab-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, id);
  }
  return id;
}

function pageLabel(page: string) {
  return ({
    "project-gate": "Projects",
    screenplay: "Screenplay",
    storyboard: "Storyboard",
    assets: "Assets",
    media: "Media",
    edit: "Edit",
    generate: "Generate",
    master: "Master",
    export: "Export"
  } as Record<string, string>)[page] || page;
}

export default function PiExpertDock({
  activePage,
  open,
  onOpenChange
}: {
  activePage: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const store = useStore();
  const project = store.project;
  const clip = project?.sequence?.clips?.find((item: any) => item.id === store.selClipId) || null;
  const selectedGuide = clip?.guides?.find((item: any) => item.id === store.selectedGuideId) || null;
  const [status, setStatus] = useState<PiStatus>({ phase: "starting", orchestrator: true, workerModelMatches: true });
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [activity, setActivity] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveIdRef = useRef<string | null>(null);
  const contextRef = useRef<any>(null);
  const tabId = useMemo(getTabId, []);

  const context = useMemo(() => ({
    updatedAt: new Date().toISOString(),
    tabId,
    browser: {
      url: window.location.href,
      title: document.title,
      focused: document.hasFocus(),
      visible: document.visibilityState === "visible"
    },
    page: activePage,
    pageLabel: pageLabel(activePage),
    subview: activePage === "edit" || activePage === "media" || activePage === "generate" || activePage === "master" || activePage === "export"
      ? store.activeWorkbench
      : null,
    project: project ? {
      slug: project.slug,
      name: project.name,
      fps: project.settings?.fps,
      resolution: `${project.settings?.width || "?"}x${project.settings?.height || "?"}`,
      clipCount: project.sequence?.clips?.length || 0,
      durationSec: project.sequence?.durationSec || 0,
      screenplayLoaded: Boolean(project.screenplay?.markdown),
      productionAssetCount: project.assets?.items?.length || 0,
      storyboardClipCount: Object.keys(store.storyboard?.clips || {}).length
    } : null,
    selection: {
      clipId: clip?.id || null,
      clipName: clip?.name || null,
      selectedSegmentIds: store.selectedSegmentIds,
      selectedGuideId: selectedGuide?.id || null,
      selectedGuideRole: selectedGuide?.role || null,
      selectedFrameFile: store.selFrameFile,
      storyboardClipId: store.selectedStoryboardClipId,
      playheadFrame: store.playheadFrame,
      markInFrame: store.markInFrame,
      markOutFrame: store.markOutFrame
    },
    render: {
      runningJobs: store.jobs.filter((job: any) => job.projectSlug === project?.slug && (job.status === "running" || job.status === "queued")).length,
      comfyConnected: Boolean(store.health.comfy),
      dedicatedComfyUrl: store.health.comfyUrl || null,
      lmStudioConnected: Boolean(store.health.lmStudio)
    }
  }), [
    activePage, tabId, focusVersion, project?.slug, project?.name, project?.updatedAt,
    project?.sequence?.clips?.length, project?.sequence?.durationSec, project?.assets?.items?.length, store.storyboard,
    clip?.id, clip?.name, selectedGuide?.id, selectedGuide?.role, store.selectedSegmentIds.join("|"),
    store.selFrameFile, store.selectedStoryboardClipId, store.playheadFrame, store.markInFrame, store.markOutFrame, store.activeWorkbench,
    store.jobs, store.health.comfy, store.health.comfyUrl, store.health.lmStudio
  ]);

  contextRef.current = context;

  useEffect(() => {
    const updateFocus = () => setFocusVersion((value) => value + 1);
    window.addEventListener("focus", updateFocus);
    window.addEventListener("blur", updateFocus);
    document.addEventListener("visibilitychange", updateFocus);
    return () => {
      window.removeEventListener("focus", updateFocus);
      window.removeEventListener("blur", updateFocus);
      document.removeEventListener("visibilitychange", updateFocus);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/pi/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context)
      }).catch(() => {});
    }, 180);
    return () => window.clearTimeout(timer);
  }, [context]);

  useEffect(() => {
    let alive = true;
    fetch("/api/pi/status").then((response) => response.json()).then((next) => {
      if (!alive) return;
      setStatus(next);
      setMessages(next.conversation || []);
    }).catch((error) => setStatus((current) => ({ ...current, phase: "error", lastError: String(error.message) })));

    const events = new EventSource("/api/pi/events");
    events.onmessage = (event) => {
      let payload: any;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type === "premiere_pi_state") {
        setStatus(payload.state || {});
        if (!payload.state?.streaming && payload.state?.conversation) {
          setMessages(payload.state.conversation);
          liveIdRef.current = null;
        }
      } else if (payload.type === "premiere_pi_user") {
        setMessages((current) => current.some((item) => item.id === payload.message.id) ? current : [...current, payload.message]);
      } else if (payload.type === "message_update" && payload.assistantMessageEvent?.type === "text_delta") {
        const delta = String(payload.assistantMessageEvent.delta || "");
        if (!delta) return;
        setMessages((current) => {
          let id = liveIdRef.current;
          if (!id || !current.some((item) => item.id === id)) {
            id = `live-${Date.now()}`;
            liveIdRef.current = id;
            return [...current, { id, role: "assistant", content: delta, createdAt: new Date().toISOString() }];
          }
          return current.map((item) => item.id === id ? { ...item, content: item.content + delta } : item);
        });
      } else if (payload.type === "agent_settled") {
        fetch("/api/pi/status").then((response) => response.json()).then((next) => {
          setStatus(next);
          setMessages(next.conversation || []);
          liveIdRef.current = null;
        }).catch(() => {});
      }
      if (payload.type === "tool_execution_start" || payload.type === "tool_execution_end" || payload.type === "message_update") {
        setActivity((value) => value + 1);
      }
    };
    events.onerror = () => setStatus((current) => ({ ...current, phase: current.running ? current.phase : "reconnecting" }));
    return () => {
      alive = false;
      events.close();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: status.streaming ? "auto" : "smooth" });
  }, [messages, activity, open, status.streaming]);

  async function send() {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    try {
      const response = await fetch("/api/pi/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, context: contextRef.current })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Pi rejected the message.");
    } catch (error: any) {
      setStatus((current) => ({ ...current, lastError: String(error.message), phase: "error" }));
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    await fetch("/api/pi/abort", { method: "POST" }).catch(() => {});
  }

  if (!open) {
    return (
      <button className="pi-expert-fab" onClick={() => onOpenChange(true)} title="Open Pi ComfyUI Expert">
        <span>π</span><b>Pi Expert</b><i className={status.running ? "online" : ""} />
      </button>
    );
  }

  return (
    <aside className="pi-expert-dock" aria-label="Pi ComfyUI Expert orchestrator">
      <header>
        <div className="pi-expert-mark">π</div>
        <div><b>Pi ComfyUI Expert</b><small>Permanent orchestrator · same-model worker</small></div>
        <button onClick={() => onOpenChange(false)} title="Minimize Pi Expert">—</button>
        <button onClick={() => onOpenChange(false)} title="Close Pi Expert">×</button>
      </header>
      <div className="pi-expert-statusbar">
        <span className={status.running ? "online" : ""}><i />{status.workerActive ? "Worker active" : status.phase || "Starting"}</span>
        <span title={MODEL}>Qwen 35B · Worker High</span>
        <span className="pi-page-awareness">◎ {pageLabel(activePage)}{clip?.name ? ` · ${clip.name}` : ""}</span>
      </div>
      <div className="pi-orchestrator-proof">
        <span>{status.forcedDelegation === false ? "ORCHESTRATOR" : "HARD-ROUTED"}</span><b>Pi scopes and supervises</b><span>→</span><b>Worker executes</b>
        {status.queuedTasks ? <em>{status.queuedTasks} queued</em> : null}
      </div>
      <div className="pi-expert-messages" ref={scrollRef}>
        {!messages.length ? (
          <div className="pi-expert-welcome">
            <div>π</div>
            <h3>Your ComfyUI expert is inside Premiere316</h3>
            <p>I always know the visible page and selection. Give me a task; I will brief a same-model worker, supervise its work, and report the verified result.</p>
          </div>
        ) : messages.map((message) => (
          <article key={message.id} className={`pi-message ${message.role}`}>
            <div className="pi-message-role">{message.role === "user" ? "YOU" : "PI ORCHESTRATOR"}{message.queued ? " · QUEUED FOR WORKER" : message.steered ? " · STEER" : ""}</div>
            <div>{message.content}</div>
          </article>
        ))}
        {status.streaming && !messages.at(-1)?.content ? <div className="pi-thinking"><i /><i /><i /> {status.workerActive ? "Worker is executing…" : "Pi is thinking…"}</div> : null}
      </div>
      {status.lastError ? <button className="pi-expert-error" onClick={() => setStatus((current) => ({ ...current, lastError: null }))}>! {status.lastError}</button> : null}
      <footer>
        <textarea
          rows={3}
          value={input}
          placeholder={status.streaming ? "Interject now; it will be the next same-model worker task…" : `Ask about ${pageLabel(activePage)}…`}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div>
          <span><i className="online" /> Page context live · {pageLabel(activePage)}</span>
          {status.streaming ? <button className="pi-stop" onClick={stop}>■ Stop</button> : null}
          <button className="pi-send" onClick={send} disabled={!input.trim() || sending}>{status.streaming ? "Queue correction ↗" : "Send ↑"}</button>
        </div>
      </footer>
    </aside>
  );
}
