import { Badge } from "@/components/ui/badge";
import type { AssetReadiness } from "@/lib/production";
import { cn } from "@/lib/utils";

export function ReadinessBadge({ readiness }: { readiness: AssetReadiness }) {
  const alert = readiness === "BLOCKED" || readiness === "REJECTED";
  const accent = readiness === "APPROVED" || readiness === "READY_TO_GENERATE";
  const label = readiness === "NOT_PREPARED" ? "Missing" : readiness.replaceAll("_", " ");
  return <Badge className={cn("shrink-0", alert && "text-rec", accent && "text-accent")}>{label}</Badge>;
}
