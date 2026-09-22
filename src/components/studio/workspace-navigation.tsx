import { useState } from "react";
import { BookOpen, ChevronDown, Film, Home, Layers, ListChecks, Menu, X } from "lucide-react";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import type { StageId } from "@/lib/studio/types";

export const workspaceGroups: {
  title: string;
  icon: typeof BookOpen;
  links: [StageId, string][];
}[] = [
  {
    title: "Movie Script",
    icon: BookOpen,
    links: [
      ["intake", "Overview & Sources"],
      ["research", "Story & chronology"],
      ["screenplay", "Screenplay"],
      ["visual-development", "Characters & world"],
      ["performance", "Scenes & performance"],
      ["cinematography", "Camera & continuity"],
      ["shots", "Shots & coverage"],
      ["prompts", "Prompts"],
      ["score", "Sound & music"],
    ],
  },
  { title: "Assets", icon: Layers, links: [["inventory", "Assets & iterations"]] },
  {
    title: "Movie",
    icon: Film,
    links: [
      ["generate", "Jobs & takes"],
      ["timeline", "Timeline & soundtrack"],
      ["export", "Delivery"],
    ],
  },
  { title: "Review", icon: ListChecks, links: [["review", "Reviews"]] },
];

export function WorkspaceNavigation() {
  const stage = useStage();
  const picture = useActivePicture();
  const open = useStudio((s) => s.openAdvancedDepartment);
  const close = useStudio((s) => s.closePicture);
  const patch = useStudio((s) => s.patchActive);
  const [expanded, setExpanded] = useState(false);
  return (
    <nav className="workspace-navigation" aria-label="Production workspace">
      <button
        className="workspace-nav-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <X size={18} /> : <Menu size={18} />} Workspace <ChevronDown size={14} />
      </button>
      <div className={`workspace-nav-content ${expanded ? "is-open" : ""}`}>
        <div className="workspace-wordmark">
          <span>P316</span>
          <small>PRODUCTION WORKSPACE · V4</small>
        </div>
        <button className="workspace-nav-link" onClick={close}>
          <Home size={15} /> Home · movie scripts
        </button>
        {workspaceGroups.map((group) => (
          <section key={group.title}>
            <h2>
              <group.icon size={12} />
              {group.title}
            </h2>
            {group.title === "Movie Script" && (
              <button
                className="workspace-nav-link"
                aria-current={picture?.workspacePanel === "bible" ? "page" : undefined}
                onClick={() => {
                  patch({ workspacePanel: "bible" });
                  setExpanded(false);
                }}
              >
                Bible & source registry
              </button>
            )}
            {group.title === "Review" && (
              <button
                className="workspace-nav-link"
                aria-current={picture?.workspacePanel === "run" ? "page" : undefined}
                onClick={() => {
                  patch({ workspacePanel: "run" });
                  setExpanded(false);
                }}
              >
                Script runs & checkpoints
              </button>
            )}
            {group.links.map(([id, label]) => (
              <button
                key={id}
                className="workspace-nav-link"
                aria-current={!picture?.workspacePanel && stage === id ? "page" : undefined}
                onClick={() => {
                  patch({ workspacePanel: null });
                  open(id);
                  setExpanded(false);
                }}
              >
                {label}
              </button>
            ))}
          </section>
        ))}
        <p className="workspace-nav-footer">
          {picture?.scenes.length || picture?.performance?.scenes.length || 0} scenes ·{" "}
          {picture?.shots.length ?? 0} shots
          <br />
          Approved work stays protected
        </p>
      </div>
    </nav>
  );
}
