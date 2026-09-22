import * as Tabs from "@radix-ui/react-tabs";
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
  const open = useStudio(s => s.openAdvancedDepartment);
  const patch = useStudio(s => s.patchActive);
  const active = picture?.workspacePanel === "run" ? "Review" : picture?.workspacePanel === "bible" ? "Movie Script" : workspaceGroups.find(g => g.links.some(([id]) => id === stage))?.title ?? "Movie Script";
  return <nav className="cabinet-rail" aria-label="Production departments">
    <span className="cabinet-monogram">P<span>316</span></span>
    <button onClick={() => useStudio.getState().closePicture()} aria-label="Home · movie scripts"><Home size={20}/><span>Home</span></button>
    {workspaceGroups.map(group => <button key={group.title} aria-current={active === group.title ? "page" : undefined} onClick={() => { patch({workspacePanel: group.title === "Movie Script" ? "bible" : group.title === "Review" ? "run" : null}); if (group.title !== "Movie Script" && group.title !== "Review") open(group.links[0][0]); }}><group.icon size={21}/><span>{group.title === "Movie Script" ? "Script" : group.title}</span></button>)}
    <span className="cabinet-rail-foot">V4</span>
  </nav>;
}
export function WorkspaceTabs() {
  const stage = useStage();
  const picture = useActivePicture();
  const group = picture?.workspacePanel === "run" ? workspaceGroups[3] : picture?.workspacePanel === "bible" ? workspaceGroups[0] : workspaceGroups.find(g => g.links.some(([id]) => id === stage)) ?? workspaceGroups[0];
  const links: [string,string][] = [...(group.title === "Movie Script" ? [["bible", "Bible cabinet"] as [string,string]] : group.title === "Review" ? [["run", "Script runs"] as [string,string]] : []), ...group.links];
  const value = picture?.workspacePanel || stage;
  return <Tabs.Root className="workspace-top-tabs" value={value} onValueChange={id => {useStudio.getState().patchActive({workspacePanel: id === "bible" || id === "run" ? id : null}); if(id !== "bible" && id !== "run") useStudio.getState().openAdvancedDepartment(id as StageId);}}><Tabs.List aria-label={`${group.title} workspaces`}>{links.map(([id,label]) => <Tabs.Trigger value={id} key={id}>{label.replace("Overview & Sources", "Brief").replace("Story & chronology", "Story").replace("Characters & world", "World").replace("Scenes & performance", "Performance").replace("Camera & continuity", "Camera").replace("Shots & coverage", "Shots").replace("Sound & music", "Sound")}</Tabs.Trigger>)}</Tabs.List></Tabs.Root>;
}
