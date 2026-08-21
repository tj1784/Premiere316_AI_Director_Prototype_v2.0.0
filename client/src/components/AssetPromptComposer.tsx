import React, { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  OUTPUT_MODES,
  buildAssetMentionOptions,
  buildAssetPromptPayload,
  createAssetPin,
  describeReferenceApplication,
  filterCompatibleWorkflows,
  filterMentionOptions,
  filterSpeakerReferenceOptions,
  getWorkflowComposerContract,
  mentionQueryAtCaret,
  parseMentionTokens,
  reconcileMentionPins,
  removeMentionToken,
  replaceMentionAtCaret,
  resolveMentionToken,
  validateAssetPrompt,
  workflowIsReady
} from "../asset-prompt";
import "./asset-prompt-composer.css";

export type AssetPromptOutputMode = "image" | "video" | "voice-design" | "dialogue" | "design" | "audio";

export type AssetPromptComposerProps = {
  project: any;
  workflows: any[];
  onSubmit: (payload: any) => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  submitLabel?: string;
  initialPrompt?: string;
  initialOutputMode?: AssetPromptOutputMode;
  initialWorkflowId?: string;
  initialAspectRatio?: string;
  initialDurationSec?: number;
  initialOptions?: Record<string, unknown>;
  initialSpeakerAssetId?: string;
  resolveAssetUrl?: (file: string, asset: any) => string;
  onCancel?: () => void;
};

type ComposerStatus = { kind: "error" | "success"; message: string } | null;

const ASPECT_RATIOS = ["16:9", "2.39:1", "2:3", "1:1"];
const ROLE_OPTIONS = ["identity", "wardrobe", "location", "prop", "crowd", "atmosphere", "voice", "audio", "motion", "reference"];
const MODE_EXAMPLES: Record<AssetPromptOutputMode, string> = {
  image: "@Adam dancing with @Eve in the @Dungeon, cinematic torchlight",
  video: "@Adam and @Eve dance through the @Dungeon, slow orbiting camera",
  "voice-design": "A warm, weathered voice for @Adam with restrained authority",
  dialogue: "@Adam speaks quietly to @Eve before dawn",
  design: "Design a ceremonial shield for @Adam using the @Dungeon palette",
  audio: "Footsteps and distant chains echoing through the @Dungeon"
};

function selectedMode(modeId: string) {
  return OUTPUT_MODES.find((mode: any) => mode.id === modeId) || OUTPUT_MODES[0];
}

function workflowReason(workflow: any) {
  if (!workflow) return "";
  if (workflow.ready === false) return String(workflow.reason || "Required workflow components are not installed.");
  if (workflow.availableNow === false) return String(workflow.runtimeWarning || workflow.reason || "The workflow is not available in the current runtime.");
  if (workflow.ready !== true || workflow.availableNow !== true) return String(workflow.runtimeWarning || workflow.reason || "This workflow has not passed a current readiness check.");
  return String(workflow.purpose || workflow.mediaType || "Ready for generation.");
}

function defaultFieldValue(field: any) {
  if (field?.default !== undefined && field?.default !== null) return field.default;
  return field?.type === "number" || field?.type === "integer" ? "" : "";
}

function enumOption(value: any) {
  if (value && typeof value === "object") {
    return { value: String(value.value ?? value.id ?? value.label ?? ""), label: String(value.label ?? value.value ?? value.id ?? "") };
  }
  return { value: String(value), label: String(value) };
}

function assetFileUrl(project: any, file: string, asset: any, resolver?: AssetPromptComposerProps["resolveAssetUrl"]) {
  if (!file) return "";
  if (resolver) return resolver(file, asset);
  return `/media/${encodeURIComponent(String(project?.slug || ""))}/assets/${encodeURIComponent(file)}`;
}

function mediaGlyph(type: string) {
  if (type === "audio") return "≋";
  if (type === "video") return "▶";
  if (type === "graphic") return "T";
  if (type === "image") return "▧";
  return "◇";
}

function ReferencePreview({ option, project, resolveAssetUrl, compact = false }: {
  option: any;
  project: any;
  resolveAssetUrl?: AssetPromptComposerProps["resolveAssetUrl"];
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = assetFileUrl(project, option?.activeFile, option?.asset, resolveAssetUrl);
  if (option?.previewType === "image" && src && !failed) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  if (option?.previewType === "video" && src && !failed) {
    return <video src={src} muted playsInline preload="metadata" aria-label={`${option.name} video reference`} onError={() => setFailed(true)} />;
  }
  if (option?.previewType === "audio" && src && !compact) {
    return (
      <div className="asset-prompt-audio-preview" onMouseDown={(event) => event.stopPropagation()}>
        <span aria-hidden="true">≋</span>
        <audio src={src} controls preload="none" aria-label={`Preview ${option.name}`} />
      </div>
    );
  }
  return <span className={`asset-prompt-media-glyph is-${option?.previewType || option?.mediaType || "unknown"}`} aria-hidden="true">{mediaGlyph(option?.previewType || option?.mediaType)}</span>;
}

export default function AssetPromptComposer({
  project,
  workflows = [],
  onSubmit,
  busy = false,
  disabled = false,
  className = "",
  title = "Create from your Asset Library",
  submitLabel = "Generate",
  initialPrompt = "",
  initialOutputMode = "image",
  initialWorkflowId = "",
  initialAspectRatio,
  initialDurationSec,
  initialOptions = {},
  initialSpeakerAssetId = "",
  resolveAssetUrl,
  onCancel
}: AssetPromptComposerProps) {
  const initialMode = selectedMode(initialOutputMode);
  const mentionOptions = useMemo(
    () => buildAssetMentionOptions(project?.assets?.items || []),
    [project?.assets?.items]
  );
  const [outputMode, setOutputMode] = useState<AssetPromptOutputMode>(initialMode.id as AssetPromptOutputMode);
  const [workflowId, setWorkflowId] = useState(String(initialWorkflowId || ""));
  const [prompt, setPrompt] = useState(String(initialPrompt || ""));
  const [pins, setPins] = useState<any[]>(() => reconcileMentionPins(initialPrompt, [], mentionOptions));
  const [aspectRatio, setAspectRatio] = useState(String(initialAspectRatio || initialMode.defaultAspectRatio || "16:9"));
  const [durationSec, setDurationSec] = useState<number>(Number(initialDurationSec || initialMode.defaultDurationSec || 8));
  const [optionValues, setOptionValues] = useState<Record<string, any>>(() => ({ ...initialOptions }));
  const [speakerAssetId, setSpeakerAssetId] = useState(String(initialSpeakerAssetId || ""));
  const [caret, setCaret] = useState(String(initialPrompt || "").length);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<ComposerStatus>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const composerId = useId();

  const mode = selectedMode(outputMode);
  const compatibleWorkflows = useMemo(
    () => filterCompatibleWorkflows(workflows, outputMode, { includeUnavailable: true }),
    [workflows, outputMode]
  );
  const readyWorkflows = useMemo(
    () => compatibleWorkflows.filter(workflowIsReady),
    [compatibleWorkflows]
  );
  const workflow = compatibleWorkflows.find((item: any) => String(item.id) === workflowId) || null;
  const composerContract = useMemo(
    () => getWorkflowComposerContract(workflow, outputMode),
    [workflow, outputMode]
  );
  const referenceApplication = useMemo(
    () => describeReferenceApplication(composerContract.referenceApplication),
    [composerContract.referenceApplication]
  );
  const contentFields = useMemo(
    () => composerContract.fields.filter((field: any) => !["aspectRatio", "durationSec"].includes(field.key)),
    [composerContract]
  );
  const aspectField = composerContract.fields.find((field: any) => field.key === "aspectRatio") || null;
  const durationField = composerContract.fields.find((field: any) => field.key === "durationSec") || null;
  const workflowRoleOptions = Array.isArray(workflow?.referencePolicy?.acceptedRoles) && workflow.referencePolicy.acceptedRoles.length
    ? workflow.referencePolicy.acceptedRoles.map(String)
    : ROLE_OPTIONS;
  const speakerOptions = useMemo(
    () => filterSpeakerReferenceOptions(mentionOptions, workflow, outputMode),
    [mentionOptions, workflow, outputMode]
  );
  const eligibleSpeakerIds = useMemo(() => new Set(speakerOptions.map((option: any) => String(option.assetId))), [speakerOptions]);
  const pinnedSpeakerIds = pins.filter((pin) => eligibleSpeakerIds.has(String(pin.assetId))).map((pin) => String(pin.assetId));
  const effectiveSpeakerAssetId = eligibleSpeakerIds.has(String(speakerAssetId))
    ? String(speakerAssetId)
    : pinnedSpeakerIds.length === 1 ? pinnedSpeakerIds[0] : "";
  const selectedSpeakerOption = speakerOptions.find((option: any) => String(option.assetId) === effectiveSpeakerAssetId) || null;
  const speakerReference = selectedSpeakerOption ? { ...createAssetPin(selectedSpeakerOption), role: "voice" } : null;
  const contractSignature = JSON.stringify({
    workflowId: workflow?.id || "",
    mode: outputMode,
    fields: composerContract.fields,
    speakerReference: composerContract.speakerReference
  });
  const mentionAtCaret = useMemo(
    () => suggestionsOpen ? mentionQueryAtCaret(prompt, caret) : null,
    [suggestionsOpen, prompt, caret]
  );
  const suggestions = useMemo(
    () => mentionAtCaret
      ? filterMentionOptions(mentionOptions, {
        query: mentionAtCaret.query,
        outputMode,
        workflow,
        limit: 9
      })
      : [],
    [mentionAtCaret, mentionOptions, outputMode, workflow]
  );
  const validation = useMemo(
    () => validateAssetPrompt({
      prompt,
      outputMode,
      workflowId,
      workflows,
      pins,
      mentionOptions,
      aspectRatio,
      durationSec,
      options: optionValues,
      speakerReference,
      requireApprovedReferences: !(project?.settings?.skipApproval || project?.settings?.skipScreenplay)
    }),
    [prompt, outputMode, workflowId, workflows, pins, mentionOptions, aspectRatio, durationSec, optionValues, speakerReference, project?.settings?.skipApproval, project?.settings?.skipScreenplay]
  );
  const optionByAssetId = useMemo(
    () => new Map(mentionOptions.map((option: any) => [option.assetId, option])),
    [mentionOptions]
  );

  useEffect(() => {
    setPins((current) => reconcileMentionPins(prompt, current, mentionOptions));
  }, [mentionOptions, prompt]);

  useEffect(() => {
    if (pendingCaret.current == null) return;
    const nextCaret = pendingCaret.current;
    pendingCaret.current = null;
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [prompt]);

  useEffect(() => {
    setActiveSuggestion(0);
  }, [mentionAtCaret?.query, outputMode, workflowId]);

  useEffect(() => {
    setOptionValues((current) => {
      const next: Record<string, any> = {};
      for (const field of contentFields) {
        next[field.key] = Object.prototype.hasOwnProperty.call(current, field.key)
          ? current[field.key]
          : defaultFieldValue(field);
      }
      return next;
    });
    if (aspectField?.default != null) setAspectRatio(String(aspectField.default));
    else if (mode.defaultAspectRatio) setAspectRatio(String(mode.defaultAspectRatio));
    if (durationField?.default != null) setDurationSec(Number(durationField.default));
    else if (mode.defaultDurationSec) setDurationSec(Number(mode.defaultDurationSec));
    setSpeakerAssetId((current) => eligibleSpeakerIds.has(String(current)) ? current : "");
  }, [contractSignature]);

  const unavailableState = useMemo(() => {
    if (!compatibleWorkflows.length) {
      return `No ${mode.label} workflow is registered for this project yet. You can still compose the prompt and pin references.`;
    }
    if (!readyWorkflows.length) {
      return `No ${mode.label} workflow is ready. Review ${compatibleWorkflows.length} workflow detail${compatibleWorkflows.length === 1 ? "" : "s"} below.`;
    }
    if (!workflowId) return `Choose one of ${readyWorkflows.length} ready ${mode.label.toLowerCase()} workflow${readyWorkflows.length === 1 ? "" : "s"}.`;
    if (workflow && !workflowIsReady(workflow)) return workflowReason(workflow);
    return "";
  }, [compatibleWorkflows, readyWorkflows, mode.label, workflowId, workflow]);

  const updateCaret = () => {
    const position = textareaRef.current?.selectionStart ?? prompt.length;
    setCaret(position);
    setSuggestionsOpen(Boolean(mentionQueryAtCaret(prompt, position)));
  };

  const chooseMode = (nextModeId: AssetPromptOutputMode) => {
    const nextMode = selectedMode(nextModeId);
    setOutputMode(nextModeId);
    setWorkflowId("");
    setOptionValues({});
    setSpeakerAssetId("");
    if (nextMode.defaultAspectRatio) setAspectRatio(nextMode.defaultAspectRatio);
    if (nextMode.defaultDurationSec) setDurationSec(nextMode.defaultDurationSec);
    setSuggestionsOpen(false);
    setStatus(null);
  };

  const updatePrompt = (value: string, position: number) => {
    setPrompt(value);
    setPins((current) => reconcileMentionPins(value, current, mentionOptions));
    setCaret(position);
    setSuggestionsOpen(Boolean(mentionQueryAtCaret(value, position)));
    setStatus(null);
  };

  const chooseSuggestion = (option: any) => {
    if (!option?.available) return;
    const replacement = replaceMentionAtCaret(prompt, caret, option.handle);
    pendingCaret.current = replacement.caret;
    setPrompt(replacement.text);
    setCaret(replacement.caret);
    setPins((current) => reconcileMentionPins(replacement.text, current, mentionOptions));
    setSuggestionsOpen(false);
    setStatus(null);
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit(event as unknown as FormEvent);
      return;
    }
    if (!mentionAtCaret || !suggestions.length) {
      if (event.key === "Escape") setSuggestionsOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const candidate = suggestions[activeSuggestion];
      if (!candidate?.available) return;
      event.preventDefault();
      chooseSuggestion(candidate);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSuggestionsOpen(false);
    }
  };

  const removePin = (pin: any) => {
    let nextPrompt = prompt;
    for (const token of parseMentionTokens(prompt)) {
      const resolution = resolveMentionToken(token.raw, mentionOptions);
      if (resolution.status === "resolved" && resolution.option?.assetId === pin.assetId) {
        nextPrompt = removeMentionToken(nextPrompt, token.raw);
      }
    }
    setPrompt(nextPrompt);
    setPins((current) => reconcileMentionPins(nextPrompt, current.filter((item) => item.assetId !== pin.assetId), mentionOptions));
    setCaret(nextPrompt.length);
    setStatus(null);
  };

  const updatePinRole = (assetId: string, role: string) => {
    setPins((current) => current.map((pin) => pin.assetId === assetId ? { ...pin, role } : pin));
    setStatus(null);
  };

  const updateOption = (key: string, value: any) => {
    setOptionValues((current) => ({ ...current, [key]: value }));
    setStatus(null);
  };

  const chooseWorkflow = (nextWorkflowId: string) => {
    setWorkflowId(nextWorkflowId);
    setSpeakerAssetId("");
    setStatus(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || disabled || submitting) return;
    try {
      const payload = buildAssetPromptPayload({
        prompt,
        outputMode,
        workflowId,
        workflows,
        pins,
        mentionOptions,
        aspectRatio,
        durationSec,
        options: optionValues,
        speakerReference,
        requireApprovedReferences: !(project?.settings?.skipApproval || project?.settings?.skipScreenplay)
      });
      setSubmitting(true);
      setStatus(null);
      await onSubmit(payload);
      setStatus({ kind: "success", message: `${mode.label} request handed to ${workflow?.label || workflow?.name || workflowId}.` });
    } catch (error: any) {
      setStatus({ kind: "error", message: String(error?.message || "The generation request could not be submitted.") });
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisabled = busy || disabled || submitting || !validation.valid;
  const disabledReason = disabled
    ? "Generation is disabled in the current project state."
    : busy || submitting
      ? "A generation request is already being prepared."
      : validation.errors[0] || "";

  return (
    <form className={`asset-prompt-composer ${className}`.trim()} onSubmit={submit} aria-labelledby={`${composerId}-title`}>
      <header className="asset-prompt-header">
        <div className="asset-prompt-heading">
          <span className="asset-prompt-spark" aria-hidden="true">✦</span>
          <div>
            <p className="asset-prompt-eyebrow">ASSET-AWARE GENERATION</p>
            <h2 id={`${composerId}-title`}>{title}</h2>
            <p>Type <strong>@</strong> to pin exact, versioned library assets. {workflow ? `${referenceApplication.label}.` : "Choose a workflow to see how its references are applied."}</p>
          </div>
        </div>
        <span className="asset-prompt-library-count">{mentionOptions.length} references indexed</span>
      </header>

      <div className="asset-prompt-mode-tabs" role="group" aria-label="Output type">
        {OUTPUT_MODES.map((item: any) => {
          const readyCount = filterCompatibleWorkflows(workflows, item.id, { includeUnavailable: false }).length;
          const active = outputMode === item.id;
          return (
            <button
              type="button"
              key={item.id}
              aria-pressed={active}
              className={active ? "active" : ""}
              onClick={() => chooseMode(item.id as AssetPromptOutputMode)}
            >
              <span aria-hidden="true">{item.icon}</span>
              <b>{item.label}</b>
              <em className={readyCount ? "has-workflow" : "no-workflow"} title={`${readyCount} ready workflow${readyCount === 1 ? "" : "s"}`}>{readyCount || "—"}</em>
            </button>
          );
        })}
      </div>

      <div className="asset-prompt-layout">
        <section className="asset-prompt-canvas" aria-label={`${mode.label} prompt`}>
          <div className="asset-prompt-field-label">
            <label htmlFor={`${composerId}-prompt`}>{composerContract.primaryPrompt.label}{composerContract.primaryPrompt.required ? <em> required</em> : null}</label>
            <span><kbd>@</kbd> inserts an Asset Library reference</span>
          </div>

          <div className={`asset-prompt-textarea-shell ${mentionAtCaret ? "is-mentioning" : ""}`}>
            <textarea
              ref={textareaRef}
              id={`${composerId}-prompt`}
              value={prompt}
              rows={5}
              maxLength={composerContract.primaryPrompt.maxLength}
              placeholder={composerContract.primaryPrompt.placeholder || MODE_EXAMPLES[outputMode]}
              required={composerContract.primaryPrompt.required}
              aria-required={composerContract.primaryPrompt.required}
              aria-invalid={Boolean(validation.fieldErrors?.prompt?.length)}
              aria-describedby={composerContract.primaryPrompt.help || validation.fieldErrors?.prompt?.length ? `${composerId}-prompt-help` : undefined}
              role="combobox"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-controls={`${composerId}-suggestions`}
              aria-expanded={Boolean(mentionAtCaret)}
              aria-activedescendant={mentionAtCaret && suggestions[activeSuggestion] ? `${composerId}-suggestion-${suggestions[activeSuggestion].assetId}` : undefined}
              onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
              onSelect={updateCaret}
              onClick={updateCaret}
              onKeyUp={(event) => {
                if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) updateCaret();
              }}
              onKeyDown={onPromptKeyDown}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
              disabled={disabled}
            />
            <div className="asset-prompt-textarea-meta">
              <span>{prompt.length}{composerContract.primaryPrompt.maxLength ? ` / ${composerContract.primaryPrompt.maxLength}` : ""} characters</span>
              <span>Ctrl/⌘ + Enter to generate</span>
            </div>

            {mentionAtCaret && (
              <div className="asset-prompt-suggestions" id={`${composerId}-suggestions`} role="listbox" aria-label="Asset mentions">
                <div className="asset-prompt-suggestion-head">
                  <span>Reference an asset</span>
                  <small>{suggestions.length ? "↑↓ navigate · Enter select" : "No matching assets"}</small>
                </div>
                {suggestions.length > 0 && (
                  <ul>
                    {suggestions.map((option: any, index: number) => (
                      <li
                        key={option.assetId}
                        id={`${composerId}-suggestion-${option.assetId}`}
                        role="option"
                        aria-selected={index === activeSuggestion}
                        aria-disabled={!option.available}
                        className={`${index === activeSuggestion ? "active" : ""} ${option.available ? "" : "unavailable"}`.trim()}
                        onMouseEnter={() => setActiveSuggestion(index)}
                        onMouseDown={(event) => {
                          if ((event.target as HTMLElement).closest("audio")) return;
                          event.preventDefault();
                          chooseSuggestion(option);
                        }}
                      >
                        <div className="asset-prompt-suggestion-preview">
                          <ReferencePreview option={option} project={project} resolveAssetUrl={resolveAssetUrl} />
                        </div>
                        <div className="asset-prompt-suggestion-copy">
                          <strong>{option.handle}</strong>
                          <span>{option.name} · {option.variant}</span>
                          <small>{option.categoryLabel} · {option.mediaType || "asset"}</small>
                        </div>
                        <div className="asset-prompt-suggestion-state">
                          {option.available ? <b>v{option.activeVersion}</b> : <b>Not generated</b>}
                          <span className={option.approved ? "approved" : "review"}>{option.approved ? "Approved" : "Review"}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {(composerContract.primaryPrompt.help || validation.fieldErrors?.prompt?.length) && (
            <p id={`${composerId}-prompt-help`} className={validation.fieldErrors?.prompt?.length ? "asset-prompt-field-message error" : "asset-prompt-field-message"}>
              {validation.fieldErrors?.prompt?.[0] || composerContract.primaryPrompt.help}
            </p>
          )}

          {contentFields.length > 0 && (
            <div className="asset-prompt-composer-fields" aria-label={`${mode.label} details`}>
              {contentFields.map((field: any) => {
                const fieldId = `${composerId}-option-${field.key}`;
                const fieldError = validation.fieldErrors?.[field.key]?.[0];
                const describedBy = field.help || fieldError ? `${fieldId}-help` : undefined;
                const commonProps = {
                  id: fieldId,
                  value: optionValues[field.key] ?? "",
                  required: field.required,
                  "aria-required": field.required,
                  "aria-invalid": Boolean(fieldError),
                  "aria-describedby": describedBy,
                  disabled
                };
                return (
                  <label className={`asset-prompt-schema-field ${field.type === "textarea" ? "is-wide" : ""}`} key={field.key} htmlFor={fieldId}>
                    <span>{field.label}{field.required ? <em>required</em> : null}</span>
                    {field.type === "textarea" ? (
                      <textarea {...commonProps} rows={field.key === "lyrics" ? 5 : 3} maxLength={field.maxLength} placeholder={field.placeholder} onChange={(event) => updateOption(field.key, event.target.value)} />
                    ) : field.type === "select" || field.enum.length ? (
                      <select {...commonProps} onChange={(event) => updateOption(field.key, event.target.value)}>
                        <option value="">Choose…</option>
                        {field.enum.map((candidate: any) => {
                          const item = enumOption(candidate);
                          return <option key={item.value} value={item.value}>{item.label}</option>;
                        })}
                      </select>
                    ) : (
                      <input
                        {...commonProps}
                        type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                        min={field.min}
                        max={field.max}
                        step={field.step ?? (field.type === "integer" ? 1 : undefined)}
                        maxLength={field.maxLength}
                        placeholder={field.placeholder}
                        onChange={(event) => updateOption(field.key, event.target.value)}
                      />
                    )}
                    {(field.help || fieldError) && <small id={`${fieldId}-help`} className={fieldError ? "error" : ""}>{fieldError || field.help}</small>}
                  </label>
                );
              })}
            </div>
          )}

          <div className="asset-prompt-reference-section">
            <div className="asset-prompt-field-label">
              <span>Selected references</span>
              <small>{pins.length ? `${pins.length} exact version${pins.length === 1 ? "" : "s"} pinned` : "References appear here as you type"}</small>
            </div>
            {pins.length ? (
              <div className="asset-prompt-chips">
                {pins.map((pin) => {
                  const option = optionByAssetId.get(pin.assetId) as any;
                  return (
                    <article className="asset-prompt-chip" key={`${pin.assetId}:v${pin.assetVersion}`}>
                      <div className="asset-prompt-chip-preview">
                        {option ? <ReferencePreview option={{ ...option, activeFile: pin.file, activeVersion: pin.assetVersion }} project={project} resolveAssetUrl={resolveAssetUrl} compact /> : <span aria-hidden="true">◇</span>}
                      </div>
                      <div className="asset-prompt-chip-copy">
                        <strong>{pin.handle || pin.token}</strong>
                        <span>{pin.name}</span>
                        <small>{pin.assetId} · <b>v{pin.assetVersion}</b></small>
                      </div>
                      <label className="asset-prompt-role">
                        <span>Role</span>
                        <select value={pin.role} onChange={(event) => updatePinRole(pin.assetId, event.target.value)} aria-label={`${pin.name} reference role`}>
                          {!workflowRoleOptions.includes(pin.role) ? <option value={pin.role} disabled>{pin.role} — incompatible</option> : null}
                          {workflowRoleOptions.map((role: string) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </label>
                      <button type="button" className="asset-prompt-chip-remove" onClick={() => removePin(pin)} aria-label={`Remove ${pin.name} reference`}>×</button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="asset-prompt-empty-references">
                <span aria-hidden="true">@</span>
                <p><strong>Prompt naturally.</strong> Try <button type="button" onClick={() => {
                  const next = `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}@`;
                  updatePrompt(next, next.length);
                  pendingCaret.current = next.length;
                }}>insert @</button> to search characters, locations, props, voices, music, and more.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="asset-prompt-workflow-panel" aria-label="Generation workflow settings">
          <div className="asset-prompt-panel-heading">
            <span aria-hidden="true">⌘</span>
            <div><small>EXECUTION</small><h3>{mode.label} workflow</h3></div>
          </div>

          <label className="asset-prompt-control" htmlFor={`${composerId}-workflow`}>
            <span>Workflow <em>required</em></span>
            <select
              id={`${composerId}-workflow`}
              value={workflowId}
              onChange={(event) => chooseWorkflow(event.target.value)}
              disabled={disabled || !readyWorkflows.length}
              required
              aria-required="true"
              aria-invalid={Boolean(validation.fieldErrors?.workflowId?.length)}
              aria-describedby={unavailableState ? `${composerId}-workflow-notice` : undefined}
            >
              <option value="">{readyWorkflows.length ? "Choose workflow…" : "No ready workflow"}</option>
              {compatibleWorkflows.map((item: any) => {
                const ready = workflowIsReady(item);
                return <option key={item.id} value={item.id} disabled={!ready}>{item.label || item.name || item.id}{ready ? "" : " — unavailable"}</option>;
              })}
            </select>
          </label>

          {unavailableState && (
            <div id={`${composerId}-workflow-notice`} className={`asset-prompt-workflow-notice ${readyWorkflows.length ? "info" : "blocked"}`} role="status">
              <span aria-hidden="true">{readyWorkflows.length ? "i" : "!"}</span>
              <p>{unavailableState}</p>
            </div>
          )}

          {compatibleWorkflows.length > 0 && (
            <ul className="asset-prompt-workflow-list" aria-label="Workflow readiness details">
              {compatibleWorkflows.map((item: any) => {
                const ready = workflowIsReady(item);
                return (
                  <li key={item.id} className={workflowId === String(item.id) ? "selected" : ""}>
                    <details>
                      <summary>
                        <span className={ready ? "ready" : "blocked"} aria-hidden="true" />
                        <b>{item.label || item.name || item.id}</b>
                        <em>{ready ? "Ready" : "Unavailable"}</em>
                      </summary>
                      <p>{ready ? (item.purpose || item.mediaType || "Ready for generation.") : workflowReason(item)}</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          {composerContract.speakerReference && (
            <label className="asset-prompt-control asset-prompt-speaker-control" htmlFor={`${composerId}-speaker`}>
              <span>{composerContract.speakerReference.label} {composerContract.speakerReference.required ? <em>required</em> : null}</span>
              <select
                id={`${composerId}-speaker`}
                value={effectiveSpeakerAssetId}
                onChange={(event) => { setSpeakerAssetId(event.target.value); setStatus(null); }}
                disabled={disabled || !speakerOptions.length}
                required={composerContract.speakerReference.required}
                aria-required={composerContract.speakerReference.required}
                aria-invalid={Boolean(validation.fieldErrors?.speakerReference?.length)}
                aria-describedby={`${composerId}-speaker-help`}
              >
                <option value="">{speakerOptions.length ? "Choose approved voice…" : "No eligible approved voice"}</option>
                {speakerOptions.map((option: any) => (
                  <option key={option.assetId} value={option.assetId}>{option.handle} · {option.name} · v{option.activeVersion}</option>
                ))}
              </select>
              <small id={`${composerId}-speaker-help`} className={validation.fieldErrors?.speakerReference?.length ? "error" : ""}>
                {validation.fieldErrors?.speakerReference?.[0] || composerContract.speakerReference.help}
              </small>
            </label>
          )}

          {(aspectField || durationField) && (
            <div className="asset-prompt-settings">
              <p>Output settings</p>
              {aspectField && (
                <label className="asset-prompt-control" htmlFor={`${composerId}-aspect-ratio`}>
                  <span>{aspectField.label}{aspectField.required ? <em>required</em> : null}</span>
                  <select
                    id={`${composerId}-aspect-ratio`}
                    value={aspectRatio}
                    onChange={(event) => { setAspectRatio(event.target.value); setStatus(null); }}
                    disabled={disabled}
                    required={aspectField.required}
                    aria-invalid={Boolean(validation.fieldErrors?.aspectRatio?.length)}
                    aria-describedby={aspectField.help || validation.fieldErrors?.aspectRatio?.length ? `${composerId}-aspect-ratio-help` : undefined}
                  >
                    {(aspectField.enum.length ? aspectField.enum : ASPECT_RATIOS).map((candidate: any) => {
                      const item = enumOption(candidate);
                      return <option key={item.value} value={item.value}>{item.label}</option>;
                    })}
                  </select>
                  {(aspectField.help || validation.fieldErrors?.aspectRatio?.length) && <small id={`${composerId}-aspect-ratio-help`} className={validation.fieldErrors?.aspectRatio?.length ? "error" : ""}>{validation.fieldErrors?.aspectRatio?.[0] || aspectField.help}</small>}
                </label>
              )}
              {durationField && (
                <label className="asset-prompt-control" htmlFor={`${composerId}-duration`}>
                  <span>{durationField.label} <em>seconds</em></span>
                  <input
                    id={`${composerId}-duration`}
                    type="number"
                    min={durationField.min ?? 0.1}
                    max={durationField.max ?? 3600}
                    step={durationField.step ?? 0.1}
                    value={durationSec}
                    onChange={(event) => { setDurationSec(Number(event.target.value)); setStatus(null); }}
                    disabled={disabled}
                    required={durationField.required}
                    aria-invalid={Boolean(validation.fieldErrors?.durationSec?.length)}
                    aria-describedby={durationField.help || validation.fieldErrors?.durationSec?.length ? `${composerId}-duration-help` : undefined}
                  />
                  {(durationField.help || validation.fieldErrors?.durationSec?.length) && <small id={`${composerId}-duration-help`} className={validation.fieldErrors?.durationSec?.length ? "error" : ""}>{validation.fieldErrors?.durationSec?.[0] || durationField.help}</small>}
                </label>
              )}
            </div>
          )}

          <div className="asset-prompt-pin-contract">
            <span aria-hidden="true">⊙</span>
            <p>
              <strong>{referenceApplication.label}</strong>
              {referenceApplication.description}
              {referenceApplication.id ? <small>{referenceApplication.id}</small> : null}
            </p>
          </div>
        </aside>
      </div>

      {validation.errors.length > 0 && (
        <div id={`${composerId}-validation`} className="asset-prompt-validation" role="alert" aria-live="polite">
          <strong>Review before generating</strong>
          <ul>
            {validation.errors.map((error: string) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <footer className="asset-prompt-footer">
        <div className="asset-prompt-submit-state" aria-live="polite">
          {status ? <span className={status.kind}>{status.message}</span> : submitDisabled && validation.errors.length ? <span>Review {validation.errors.length} issue{validation.errors.length === 1 ? "" : "s"} before generating.</span> : submitDisabled && disabledReason ? <span>{disabledReason}</span> : <span className="ready">Ready to generate with {pins.length} pinned reference{pins.length === 1 ? "" : "s"}.</span>}
        </div>
        <div className="asset-prompt-actions">
          {onCancel && <button type="button" className="asset-prompt-cancel" onClick={onCancel} disabled={busy || submitting}>Cancel</button>}
          <button type="submit" className="asset-prompt-submit" disabled={submitDisabled} title={submitDisabled ? disabledReason : undefined} aria-describedby={validation.errors.length ? `${composerId}-validation` : undefined}>
            <span aria-hidden="true">✦</span>
            {submitting ? "Preparing…" : `${submitLabel} ${mode.label}`}
          </button>
        </div>
      </footer>
    </form>
  );
}
