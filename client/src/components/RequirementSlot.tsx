import React from "react";
import { actionsForSlotState, openAssetAction, type AssetActionIntent, type AssetActionName, type RequirementSlotState } from "../contextual-agency";
import "./requirement-slot.css";

const ACTION_LABEL: Record<AssetActionName, string> = {
  generate: "Generate",
  upload: "Upload",
  create: "Create manually",
  choose: "Choose existing",
  edit: "Edit",
  replace: "Replace",
  review: "Review",
  assign: "Assign",
  attach: "Attach",
  restore: "Restore",
  unlink: "Unlink",
  versions: "Versions"
};

export default function RequirementSlot({
  intent,
  state,
  title,
  summary,
  children
}: {
  intent: Omit<AssetActionIntent, "slotState">;
  state: RequirementSlotState;
  title: string;
  summary?: string;
  children?: React.ReactNode;
}) {
  const actions = actionsForSlotState(state);
  const primary = actions[0];
  const open = (action: AssetActionName, focusId: string) => {
    openAssetAction({ ...intent, slotState: state, initialAction: action, returnFocusId: focusId });
  };
  const slotId = `slot-${intent.sourceEntity.id}-${intent.requirement.relationship}`.replace(/[^a-zA-Z0-9_-]/g, "-");

  return (
    <section className={`requirement-slot state-${state}`} data-relationship={intent.requirement.relationship}>
      <header>
        <div>
          <b>{title}</b>
          {summary ? <small>{summary}</small> : null}
        </div>
        <button
          type="button"
          id={slotId}
          className={`requirement-slot-state ${state}`}
          onClick={() => open(primary, slotId)}
        >
          {state === "missing" ? "Missing" : state === "planned" ? "Planned" : state === "unapproved" ? "Review required" : state === "broken" ? "Broken" : "Approved"}
        </button>
      </header>
      {children}
      <div className="requirement-slot-actions">
        {actions.map((action) => {
          const id = `${slotId}-${action}`;
          return (
            <button key={action} type="button" id={id} className={action === primary ? "button primary" : "button secondary"} onClick={() => open(action, id)}>
              {intent.requirement.category === "voice" && action === "generate" ? "Create voice" : ACTION_LABEL[action]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
