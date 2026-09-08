import type { Picture, StageId } from "./types.ts";
import { DEFAULT_NAV_STEPS, requiredTouchpointForStage, type ProductTouchpoint } from "./product-flow.ts";
import { researchBibleGenerated, researchRoomStatus } from "../research/research-room.ts";

export type AdvancedSurface = "dashboard" | StageId;

export type AdvancedDepartmentId =
  | "research"
  | "screenplay"
  | "inventory"
  | "visual-development"
  | "cinematography"
  | "performance"
  | "shots"
  | "prompts"
  | "review"
  | "timeline"
  | "score"
  | "export";

export type AdvancedDepartmentGroupId = "research-story" | "planning" | "production-review";

export type AdvancedDepartmentDefinition = {
  id: AdvancedDepartmentId;
  label: string;
  shortLabel: string;
  controls: string;
  requiredInDefault: false;
  group: AdvancedDepartmentGroupId;
};

export const ADVANCED_DEPARTMENTS: AdvancedDepartmentDefinition[] = [
  { id: "research", label: "Research", shortLabel: "Research", controls: "Optional inspection and editing of the Research Bible.", requiredInDefault: false, group: "research-story" },
  { id: "screenplay", label: "Screenplay", shortLabel: "Screenplay", controls: "Optional inspection and editing of the screenplay draft.", requiredInDefault: false, group: "research-story" },
  { id: "inventory", label: "Inventory", shortLabel: "Inventory", controls: "Optional production breakdown and asset inventory.", requiredInDefault: false, group: "planning" },
  { id: "visual-development", label: "Visual Development", shortLabel: "Visual Dev", controls: "Optional look development and visual references.", requiredInDefault: false, group: "planning" },
  { id: "cinematography", label: "Cinematography", shortLabel: "Cinematography", controls: "Optional camera, light, and coverage language.", requiredInDefault: false, group: "planning" },
  { id: "performance", label: "Performance", shortLabel: "Performance", controls: "Optional performance direction and blocking notes.", requiredInDefault: false, group: "planning" },
  { id: "shots", label: "Shots", shortLabel: "Shots", controls: "Optional shot list inspection and overrides.", requiredInDefault: false, group: "planning" },
  { id: "prompts", label: "Prompt Lab", shortLabel: "Prompt Lab", controls: "Optional prompt compilation inspection.", requiredInDefault: false, group: "planning" },
  { id: "review", label: "Review", shortLabel: "Review", controls: "Optional take review and iteration notes.", requiredInDefault: false, group: "production-review" },
  { id: "timeline", label: "Stitch", shortLabel: "Stitch", controls: "Optional timeline assembly inspection.", requiredInDefault: false, group: "production-review" },
  { id: "score", label: "Score", shortLabel: "Score", controls: "Optional score and cue inspection.", requiredInDefault: false, group: "production-review" },
  { id: "export", label: "Diagnostics / Export internals", shortLabel: "Export internals", controls: "Optional export internals and diagnostics. Default Export remains a five-touchpoint step.", requiredInDefault: false, group: "production-review" },
];

export const ADVANCED_DEPARTMENT_GROUPS: { id: AdvancedDepartmentGroupId; label: string; departments: AdvancedDepartmentId[] }[] = [
  { id: "research-story", label: "Research & Story", departments: ["research", "screenplay"] },
  { id: "planning", label: "Planning", departments: ["inventory", "visual-development", "cinematography", "performance", "shots", "prompts"] },
  { id: "production-review", label: "Production Review", departments: ["review", "timeline", "score", "export"] },
];

const DEPARTMENT_IDS = new Set<string>(ADVANCED_DEPARTMENTS.map((item) => item.id));

export function isAdvancedDepartmentId(value: string | null | undefined): value is AdvancedDepartmentId {
  return Boolean(value && DEPARTMENT_IDS.has(value));
}

export function isAdvancedDashboard(uiMode: "default" | "advanced", surface: AdvancedSurface): boolean {
  return uiMode === "advanced" && surface === "dashboard";
}

export function departmentById(id: AdvancedDepartmentId): AdvancedDepartmentDefinition {
  return ADVANCED_DEPARTMENTS.find((item) => item.id === id)!;
}

export type AdvancedDepartmentCard = AdvancedDepartmentDefinition & {
  status: string;
  lastUpdated: number | null;
};

export function departmentCardStatus(picture: Picture, id: AdvancedDepartmentId): { status: string; lastUpdated: number | null } {
  switch (id) {
    case "research": {
      const bible = picture.research;
      const room = researchRoomStatus(bible, null);
      const label = room === "approved" ? "Approved" : room === "draft" ? "Draft exists" : room === "blocked" ? "Blocked" : "Not generated";
      return { status: label, lastUpdated: bible?.updatedAt ?? null };
    }
    case "screenplay": {
      const status = picture.screenplay.status;
      if (status === "APPROVED") return { status: "Approved", lastUpdated: picture.screenplay.updatedAt };
      if (status === "READY_FOR_REVIEW" || status === "GENERATING") return { status: "Draft exists", lastUpdated: picture.screenplay.updatedAt };
      return { status: "Not generated", lastUpdated: picture.screenplay.updatedAt ?? null };
    }
    case "inventory":
      return {
        status: (picture.production?.assets.length ?? 0) > 0 ? "Draft exists" : "Not generated",
        lastUpdated: picture.production?.updatedAt ?? null,
      };
    case "visual-development":
      return {
        status: (picture.visualDevelopment?.approvals.length ?? 0) > 0 ? "Draft exists" : "Not generated",
        lastUpdated: picture.visualDevelopment?.updatedAt ?? null,
      };
    case "cinematography":
      return {
        status: (picture.cinematography?.approvals.length ?? 0) > 0 ? "Draft exists" : "Not generated",
        lastUpdated: picture.cinematography?.updatedAt ?? null,
      };
    case "performance":
      return {
        status: picture.performance?.shots.length ? "Draft exists" : "Not generated",
        lastUpdated: picture.performance ? picture.updatedAt : null,
      };
    case "shots":
      return {
        status: picture.performance?.shots.length ? "Draft exists" : "Not generated",
        lastUpdated: picture.performance ? picture.updatedAt : null,
      };
    case "prompts":
      return {
        status: picture.shots.some((shot) => shot.t2iPrompt) ? "Draft exists" : "Not generated",
        lastUpdated: picture.updatedAt,
      };
    case "review":
      return { status: "Optional inspection", lastUpdated: picture.updatedAt };
    case "timeline":
      return { status: "Optional inspection", lastUpdated: picture.updatedAt };
    case "score":
      return {
        status: (picture.cues.length ?? 0) > 0 ? "Draft exists" : "Not generated",
        lastUpdated: picture.updatedAt,
      };
    case "export":
      return { status: "Optional inspection", lastUpdated: picture.updatedAt };
  }
}

export function advancedDepartmentCards(picture: Picture): AdvancedDepartmentCard[] {
  return ADVANCED_DEPARTMENTS.map((department) => ({
    ...department,
    ...departmentCardStatus(picture, department.id),
  }));
}

export function defaultTouchpointLabels(): string[] {
  return DEFAULT_NAV_STEPS.map((step) => step.label);
}

export function numberedStageRailForbidden(source: string): boolean {
  return /grid-cols-\[repeat\(13/.test(source) || /Stage \{currentIndex \+ 1\} of \{STAGES\.length\}/.test(source);
}

export function lastDefaultTouchpointFor(stage: StageId, generateGate: "assets" | "keyframes" | "video"): ProductTouchpoint {
  return requiredTouchpointForStage(stage, stage === "generate" ? generateGate : null);
}

export function researchBiblePresent(picture: Picture): boolean {
  return researchBibleGenerated(picture.research);
}
