import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useActivePicture, useStage, useStudio } from "@/lib/studio/store";
import {
  ADVANCED_DEPARTMENT_GROUPS,
  advancedDepartmentCards,
  departmentById,
  type AdvancedDepartmentId,
} from "@/lib/studio/advanced-departments.ts";

function formatUpdated(value: number | null): string {
  if (!value || value <= 1) return "—";
  return new Date(value).toLocaleString();
}

export function AdvancedDepartmentsDashboard() {
  const picture = useActivePicture();
  const openAdvancedDepartment = useStudio((state) => state.openAdvancedDepartment);
  const returnToDefaultMode = useStudio((state) => state.returnToDefaultMode);
  const [selected, setSelected] = useState<AdvancedDepartmentId | null>(null);
  if (!picture) return null;
  const cards = advancedDepartmentCards(picture);

  return (
    <div className="stage-pane flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-advanced-dashboard="true">
      <header className="shrink-0 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-4">
        <p className="text-[11px] tracking-[0.2em] text-subtle uppercase">Optional tools</p>
        <h2 className="mt-1 font-display text-[clamp(1.5rem,3vw,1.875rem)] tracking-tight">Advanced Departments</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          These are optional inspection and manual-override rooms. Default movie creation only requires Intake → Assets → First/Last → Video Clips → Export.
        </p>
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-8 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const active = selected === card.id;
            return (
              <article
                key={card.id}
                data-department-id={card.id}
                data-required-in-default="no"
                className={cn("rounded-lg bg-elevated p-4 text-left shadow-[var(--shadow-border)]", active ? "shadow-[var(--shadow-border-hover)]" : "")}
              >
                <button type="button" className="block w-full text-left" onClick={() => setSelected(card.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg tracking-tight">{card.label}</h3>
                    <Badge>{card.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{card.controls}</p>
                  <dl className="mt-3 grid gap-1 text-[11px] text-subtle">
                    <div className="flex justify-between gap-2"><dt>Last updated</dt><dd>{formatUpdated(card.lastUpdated)}</dd></div>
                    <div className="flex justify-between gap-2"><dt>Required in default mode</dt><dd>No</dd></div>
                  </dl>
                </button>
                <Button className="mt-4 w-full" size="sm" variant="secondary" onClick={() => openAdvancedDepartment(card.id)}>
                  Open {card.label}
                </Button>
              </article>
            );
          })}
        </div>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
        <Button onClick={() => returnToDefaultMode()}>Return to Default Mode</Button>
        <Button variant="secondary" disabled={!selected} onClick={() => selected && openAdvancedDepartment(selected)}>
          Open selected department
        </Button>
      </footer>
    </div>
  );
}

export function AdvancedDepartmentsRail() {
  const stage = useStage();
  const advancedSurface = useStudio((state) => state.advancedSurface);
  const enterAdvancedDepartments = useStudio((state) => state.enterAdvancedDepartments);
  const openAdvancedDepartment = useStudio((state) => state.openAdvancedDepartment);
  const returnToDefaultMode = useStudio((state) => state.returnToDefaultMode);
  const onDashboard = advancedSurface === "dashboard";
  const currentId = onDashboard ? "" : (advancedSurface === stage ? stage : advancedSurface);

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-2 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-xs text-muted">Production departments</p>
          <Button size="sm" variant="ghost" onClick={() => openAdvancedDepartment("intake")}>Intake</Button>
          <Button size="sm" variant="ghost" onClick={() => { useStudio.getState().setGenerateFocus("assets"); openAdvancedDepartment("generate"); }}>Assets</Button>
          {onDashboard ? null : (
            <Button size="sm" variant="ghost" onClick={() => enterAdvancedDepartments()}>
              All departments
            </Button>
          )}
        </div>
        {onDashboard ? null : <Button size="sm" onClick={() => returnToDefaultMode()}>Simple workflow</Button>}
      </div>
      {onDashboard ? (
        <p className="px-2 py-2 text-[11px] text-subtle">Open a department to review your screenplay, assets and production settings.</p>
      ) : (
        <>
          <div className="hidden min-w-0 flex-wrap gap-3 px-2 py-2 lg:flex">
            {ADVANCED_DEPARTMENT_GROUPS.map((group) => (
              <div key={group.id} className="min-w-0">
                <p className="px-1 text-[10px] tracking-[0.16em] text-subtle uppercase">{group.label}</p>
                <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                  {group.departments.map((id) => {
                    const item = departmentById(id);
                    const current = currentId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        data-stage-id={id}
                        aria-label={item.label}
                        aria-current={current ? "step" : undefined}
                        onClick={() => openAdvancedDepartment(id)}
                        className={cn("flex h-11 min-w-0 items-center rounded-sm px-2 text-xs", current ? "bg-elevated text-fg" : "text-muted hover:text-fg")}
                      >
                        <span className="min-w-0 truncate" title={item.label}>{item.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="px-2 py-2 lg:hidden">
            <label className="relative block min-w-0">
              <span className="pointer-events-none absolute left-3 top-1 text-[9px] tracking-wide text-subtle uppercase">Advanced department</span>
              <select
                aria-label="Advanced department"
                value={isAdvancedSelectValue(currentId) ? currentId : ADVANCED_DEPARTMENT_GROUPS[0].departments[0]}
                onChange={(event) => openAdvancedDepartment(event.target.value as AdvancedDepartmentId)}
                className="h-11 w-full min-w-0 appearance-none rounded-sm bg-elevated px-3 pb-1 pt-4 text-sm text-fg shadow-[var(--shadow-border)] outline-none"
              >
                {ADVANCED_DEPARTMENT_GROUPS.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.departments.map((id) => {
                      const item = departmentById(id);
                      return <option key={id} value={id}>{item.label}</option>;
                    })}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function isAdvancedSelectValue(value: string): value is AdvancedDepartmentId {
  return ADVANCED_DEPARTMENT_GROUPS.some((group) => group.departments.includes(value as AdvancedDepartmentId));
}
