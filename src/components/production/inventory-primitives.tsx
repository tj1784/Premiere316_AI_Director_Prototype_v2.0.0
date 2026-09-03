import { Badge } from "@/components/ui/badge";
import type { AssetReadiness } from "@/lib/production";
import { cn } from "@/lib/utils";

export function ReadinessBadge({ readiness }: { readiness: AssetReadiness }) {
  const alert = readiness === "BLOCKED" || readiness === "REJECTED";
  const accent = readiness === "APPROVED" || readiness === "READY_TO_GENERATE" || readiness === "READY_TO_PREPARE" || readiness === "APPROVED_PREPARED" || readiness === "APPROVED_SPEC";
  const label = readiness === "NOT_PREPARED" ? "Missing" : readiness === "READY_TO_GENERATE" ? "READY TO PREPARE" : readiness === "APPROVED" ? "APPROVED PREPARED" : readiness.replaceAll("_", " ");
  return <Badge className={cn("shrink-0", alert && "text-rec", accent && "text-accent")}>{label}</Badge>;
}
