import { useSyncExternalStore } from "react";
import { getProjectSaveStatus, subscribeProjectSaveStatus } from "@/lib/studio/project-storage";

export function ProjectSaveStatus() {
  const status = useSyncExternalStore(
    subscribeProjectSaveStatus,
    getProjectSaveStatus,
    () => "idle" as const,
  );
  return (
    <span
      role="status"
      className={`shrink-0 text-xs ${status === "error" ? "text-rec" : "text-muted"}`}
      title="Project persistence status; this is not content or media approval"
    >
      {status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved"
          : status === "error"
            ? "Save failed"
            : "No pending edits"}
    </span>
  );
}
