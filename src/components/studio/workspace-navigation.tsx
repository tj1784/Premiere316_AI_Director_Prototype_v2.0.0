import { useState } from "react";
import {
  BookOpen,
  Film,
  Home,
  Layers,
  ListChecks,
  PenLine,
  AudioLines,
  Grid2X2,
  FileText,
  Users,
  Camera,
  Clapperboard,
  Workflow,
  ScanLine,
  Download,
  Play,
  type LucideIcon,
} from "lucide-react";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import type { StageId } from "@/lib/studio/types";
import { CabinetModal } from "./cabinet";

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

type Destination = StageId | "bible" | "run";
const tools: { id: Destination; label: string; icon: LucideIcon }[] = [
  { id: "intake", label: "Brief & sources", icon: FileText },
  { id: "research", label: "Story & chronology", icon: Workflow },
  { id: "bible", label: "Production Bible", icon: BookOpen },
  { id: "screenplay", label: "Screenplay", icon: PenLine },
  { id: "visual-development", label: "Characters & world", icon: Users },
  { id: "performance", label: "Scenes & performance", icon: Clapperboard },
  { id: "cinematography", label: "Camera & continuity", icon: Camera },
  { id: "shots", label: "Shots & coverage", icon: ScanLine },
  { id: "prompts", label: "Prompts", icon: FileText },
  { id: "score", label: "Sound & music", icon: AudioLines },
  { id: "inventory", label: "Assets", icon: Layers },
  { id: "generate", label: "Jobs & takes", icon: Play },
  { id: "timeline", label: "Movie timeline", icon: Film },
  { id: "export", label: "Delivery", icon: Download },
  { id: "run", label: "Script runs", icon: Workflow },
  { id: "review", label: "Reviews", icon: ListChecks },
];
const pinned: Destination[] = ["bible", "screenplay", "visual-development", "inventory", "timeline", "score", "review"];

export function WorkspaceNavigation() {
  const stage = useStage();
  const picture = useActivePicture();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = picture?.workspacePanel || stage;
  const navigate = (id: Destination) => {
    useStudio
      .getState()
      .patchActive({ workspacePanel: id === "bible" || id === "run" ? id : null });
    if (id !== "bible" && id !== "run") useStudio.getState().openAdvancedDepartment(id);
    setOpen(false);
  };
  return (
    <>
      <div className="studio-dock" role="navigation" aria-label="Workspace dock">
        {pinned.map((id) => {
          const item = tools.find((t) => t.id === id)!;
          return (
            <button
              key={id}
              className="dock-icon"
              aria-label={item.label}
              aria-current={active === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <item.icon size={21} strokeWidth={1.6} />
              <span className="dock-tooltip">{item.label}</span>
            </button>
          );
        })}
        <button
          className="dock-icon"
          aria-label="All workspaces"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Grid2X2 size={20} strokeWidth={1.6} />
          <span className="dock-tooltip">All workspaces</span>
        </button>
      </div>
      <CabinetModal title="Workspaces" open={open} onOpenChange={setOpen}>
        <input
          className="workspace-finder"
          aria-label="Find a workspace"
          placeholder="Find a workspace…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="workspace-launcher">
          {tools
            .filter((t) => t.label.toLowerCase().includes(query.toLowerCase()))
            .map((item) => (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={active === item.id ? "page" : undefined}
              >
                <item.icon size={20} strokeWidth={1.5} />
                <span>{item.label}</span>
              </button>
            ))}
        </div>
      </CabinetModal>
    </>
  );
}
