/** Native generation controls. Adapter declarations are the only source of truth for UI controls. */

export type EngineControlLevel = "basic" | "advanced" | "expert";
export type EngineControlGroup = "generation" | "conditioning" | "execution" | "memory";
export type ReloadEffect = "NO_RELOAD" | "CACHE_INVALIDATION" | "COMPONENT_RELOAD" | "FULL_RELOAD";
export type EngineControlKind = "integer" | "number" | "boolean" | "enum" | "text" | "images" | "action";
export type EngineControlValue = string | number | boolean | string[];

export type EngineControlId =
  | "qualityPreset"
  | "aspectRatio"
  | "width"
  | "height"
  | "steps"
  | "guidance"
  | "seed"
  | "randomizeSeed"
  | "lockSeed"
  | "batchCount"
  | "scheduler"
  | "shift"
  | "prompt"
  | "negativePrompt"
  | "promptUpsampling"
  | "references"
  | "referenceStrength"
  | "denoiseStrength"
  | "mask"
  | "loras"
  | "precision"
  | "outputFormat"
  | "outputBitDepth"
  | "attentionBackend"
  | "vaeTiling"
  | "textEncoderPlacement"
  | "vaePlacement"
  | "cpuOffload"
  | "promptEmbeddingCache"
  | "referenceEmbeddingCache"
  | "keepResident"
  | "pinInVram"
  | "residencyTimeout"
  | "runtimeImplementation"
  | "benchmarkConfiguration"
  | "unload";

export type AllowedValue = { value: string | number | boolean; label: string; description?: string };

export type EngineControlCapability = {
  id: EngineControlId;
  label: string;
  group: EngineControlGroup;
  level: EngineControlLevel;
  kind: EngineControlKind;
  supported: boolean;
  runtimeDefault?: EngineControlValue;
  recommendedDefault?: EngineControlValue;
  minimum?: number;
  maximum?: number;
  step?: number;
  allowedValues?: AllowedValue[];
  help: string;
  disabledReason?: string;
  reloadEffect: ReloadEffect;
  perGenerationOverride: boolean;
  fixed?: boolean;
  multiple?: boolean;
};

export type NativeGenerationValues = Partial<Record<EngineControlId, EngineControlValue>>;

export type QualityPresetId = "fast-preview" | "production" | "maximum-quality" | "custom";

export type EngineQualityPreset = {
  id: Exclude<QualityPresetId, "custom">;
  label: string;
  description: string;
  values: NativeGenerationValues;
};

export type NativeAdapterCapabilities = {
  adapterId: "flux" | "flux2" | "klein-demo";
  runtimeImplementation: string;
  modelVariant: "flux1-dev" | "flux2-dev" | "flux2-klein-4b" | "flux2-klein-9b";
  controls: Record<EngineControlId, EngineControlCapability>;
  presets: EngineQualityPreset[];
};

type ControlInput = Omit<EngineControlCapability, "supported" | "reloadEffect" | "perGenerationOverride"> & {
  reloadEffect?: ReloadEffect;
  perGenerationOverride?: boolean;
};

const unsupportedReason = "Not exposed because the current native adapter does not support it.";

function enabled(input: ControlInput): EngineControlCapability {
  return {
    ...input,
    supported: true,
    reloadEffect: input.reloadEffect ?? "NO_RELOAD",
    perGenerationOverride: input.perGenerationOverride ?? true,
  };
}

function disabled(
  id: EngineControlId,
  label: string,
  group: EngineControlGroup,
  level: EngineControlLevel,
  kind: EngineControlKind,
  reason = unsupportedReason,
): EngineControlCapability {
  return {
    id,
    label,
    group,
    level,
    kind,
    supported: false,
    help: reason,
    disabledReason: reason,
    reloadEffect: "NO_RELOAD",
    perGenerationOverride: false,
  };
}

function fixedNumber(
  id: "steps" | "guidance" | "shift",
  label: string,
  level: EngineControlLevel,
  value: number | boolean,
  help: string,
): EngineControlCapability {
  return enabled({
    id,
    label,
    group: "generation",
    level,
    kind: typeof value === "boolean" ? "boolean" : "number",
    runtimeDefault: value,
    recommendedDefault: value,
    allowedValues: [{ value, label: String(value) }],
    help,
    disabledReason: help,
    fixed: true,
    perGenerationOverride: false,
  });
}

function commonControls(): Record<EngineControlId, EngineControlCapability> {
  return {
    qualityPreset: enabled({
      id: "qualityPreset", label: "Quality preset", group: "generation", level: "basic", kind: "enum",
      runtimeDefault: "production", recommendedDefault: "production", help: "Applies settings recommended by this native adapter.",
    }),
    aspectRatio: enabled({
      id: "aspectRatio", label: "Aspect ratio", group: "generation", level: "basic", kind: "enum",
      runtimeDefault: "16:9", recommendedDefault: "16:9",
      allowedValues: ["16:9", "3:2", "4:3", "1:1", "4:5", "9:16"].map((value) => ({ value, label: value })),
      help: "Changes width and height together; the native worker rounds both dimensions down to multiples of 16.",
    }),
    width: enabled({
      id: "width", label: "Width", group: "generation", level: "basic", kind: "integer",
      runtimeDefault: 1280, recommendedDefault: 1280, minimum: 16, step: 16,
      help: "Output width in pixels. The native worker accepts multiples of 16.",
    }),
    height: enabled({
      id: "height", label: "Height", group: "generation", level: "basic", kind: "integer",
      runtimeDefault: 720, recommendedDefault: 720, minimum: 16, step: 16,
      help: "Output height in pixels. The native worker accepts multiples of 16.",
    }),
    steps: disabled("steps", "Steps", "generation", "advanced", "integer"),
    guidance: disabled("guidance", "Guidance", "generation", "advanced", "number"),
    seed: enabled({
      id: "seed", label: "Seed", group: "generation", level: "basic", kind: "integer",
      runtimeDefault: 0, recommendedDefault: 0, minimum: 0, maximum: 2_147_483_647, step: 1,
      help: "Deterministic noise seed passed directly to the native worker.",
    }),
    randomizeSeed: enabled({
      id: "randomizeSeed", label: "Random seed", group: "generation", level: "basic", kind: "boolean",
      runtimeDefault: true, recommendedDefault: true, help: "Choose a fresh seed before each generation.",
    }),
    lockSeed: enabled({
      id: "lockSeed", label: "Lock seed", group: "generation", level: "basic", kind: "boolean",
      runtimeDefault: false, recommendedDefault: false, help: "Keep the current seed for reproducible iterations.",
    }),
    batchCount: disabled("batchCount", "Generate count", "generation", "basic", "integer", "The current native worker returns one image per job."),
    scheduler: disabled("scheduler", "Scheduler", "generation", "expert", "enum"),
    shift: disabled("shift", "Schedule shift", "generation", "expert", "boolean"),
    prompt: enabled({
      id: "prompt", label: "Prompt", group: "conditioning", level: "basic", kind: "text",
      runtimeDefault: "", recommendedDefault: "", help: "Text conditioning passed to the native model.",
      reloadEffect: "CACHE_INVALIDATION",
    }),
    negativePrompt: disabled("negativePrompt", "Negative prompt", "conditioning", "advanced", "text"),
    promptUpsampling: disabled("promptUpsampling", "Prompt upsampling", "conditioning", "advanced", "boolean"),
    references: disabled("references", "Reference images", "conditioning", "basic", "images"),
    referenceStrength: disabled("referenceStrength", "Reference strength", "conditioning", "advanced", "number"),
    denoiseStrength: disabled("denoiseStrength", "Denoise strength", "conditioning", "advanced", "number"),
    mask: disabled("mask", "Mask", "conditioning", "advanced", "images"),
    loras: disabled("loras", "LoRAs", "conditioning", "advanced", "images"),
    precision: enabled({
      id: "precision", label: "Compute precision", group: "execution", level: "advanced", kind: "enum",
      runtimeDefault: "BF16", recommendedDefault: "BF16", allowedValues: [{ value: "BF16", label: "BF16" }],
      help: "The native worker executes this pipeline in BF16.", disabledReason: "Fixed by the current native worker.",
      fixed: true, perGenerationOverride: false, reloadEffect: "FULL_RELOAD",
    }),
    outputFormat: enabled({
      id: "outputFormat", label: "Output format", group: "generation", level: "advanced", kind: "enum",
      runtimeDefault: "PNG", recommendedDefault: "PNG", allowedValues: [{ value: "PNG", label: "PNG" }],
      help: "The native worker currently writes PNG images.", disabledReason: "Fixed by the current native worker.",
      fixed: true, perGenerationOverride: false,
    }),
    outputBitDepth: enabled({
      id: "outputBitDepth", label: "Output bit depth", group: "generation", level: "expert", kind: "enum",
      runtimeDefault: 8, recommendedDefault: 8, allowedValues: [{ value: 8, label: "8-bit" }],
      help: "The native PIL output conversion is 8-bit RGB.", disabledReason: "Fixed by the current native worker.",
      fixed: true, perGenerationOverride: false,
    }),
    attentionBackend: disabled("attentionBackend", "Attention backend", "execution", "expert", "enum"),
    vaeTiling: disabled("vaeTiling", "VAE tiling", "memory", "expert", "boolean"),
    textEncoderPlacement: enabled({
      id: "textEncoderPlacement", label: "Text encoder placement", group: "memory", level: "expert", kind: "enum",
      runtimeDefault: "GPU", recommendedDefault: "GPU", allowedValues: [{ value: "GPU", label: "GPU" }],
      help: "The current worker loads the text encoder on CUDA.", disabledReason: "Fixed by the current native worker.",
      fixed: true, perGenerationOverride: false, reloadEffect: "FULL_RELOAD",
    }),
    vaePlacement: enabled({
      id: "vaePlacement", label: "VAE placement", group: "memory", level: "expert", kind: "enum",
      runtimeDefault: "GPU", recommendedDefault: "GPU", allowedValues: [{ value: "GPU", label: "GPU" }],
      help: "The current worker loads and decodes with the VAE on CUDA.", disabledReason: "Fixed by the current native worker.",
      fixed: true, perGenerationOverride: false, reloadEffect: "FULL_RELOAD",
    }),
    cpuOffload: disabled("cpuOffload", "CPU offload", "memory", "expert", "enum"),
    promptEmbeddingCache: disabled("promptEmbeddingCache", "Prompt embedding cache", "memory", "expert", "boolean"),
    referenceEmbeddingCache: disabled("referenceEmbeddingCache", "Reference embedding cache", "memory", "expert", "boolean"),
    keepResident: disabled("keepResident", "Keep warm", "memory", "expert", "boolean"),
    pinInVram: disabled("pinInVram", "Pin in VRAM", "memory", "expert", "boolean"),
    residencyTimeout: disabled("residencyTimeout", "Residency timeout", "memory", "expert", "enum"),
    runtimeImplementation: enabled({
      id: "runtimeImplementation", label: "Runtime", group: "execution", level: "expert", kind: "enum",
      runtimeDefault: "", recommendedDefault: "", allowedValues: [], help: "Native Black Forest Labs implementation; no ComfyUI.",
      fixed: true, perGenerationOverride: false, reloadEffect: "FULL_RELOAD",
    }),
    benchmarkConfiguration: disabled("benchmarkConfiguration", "Benchmark configuration", "execution", "expert", "action", "Benchmark and free wake routes are disabled; packaged Generate is prepared-asset only."),
    unload: disabled("unload", "Unload", "memory", "expert", "action"),
  };
}

function nativePresets(values: { steps: number; guidance: number }): EngineQualityPreset[] {
  return [
    {
      id: "fast-preview", label: "Fast Preview", description: "Lower-resolution native preview; sampling remains adapter-defined.",
      values: { qualityPreset: "fast-preview", width: 512, height: 512, aspectRatio: "1:1", ...values },
    },
    {
      id: "production", label: "Production", description: "Prepared Wave 4 draft framing with the adapter's native sampling defaults.",
      values: { qualityPreset: "production", width: 512, height: 512, aspectRatio: "1:1", ...values },
    },
    {
      id: "maximum-quality", label: "Maximum Quality", description: "Same fixed 512px Wave 4 native draft; higher-resolution controls stay disabled until a later gate.",
      values: { qualityPreset: "maximum-quality", width: 512, height: 512, aspectRatio: "1:1", ...values },
    },
  ];
}

function flux1(): NativeAdapterCapabilities {
  const controls = commonControls();
  controls.steps = fixedNumber("steps", "Steps", "advanced", 20, "The current FLUX.1 worker always executes 20 steps.");
  controls.guidance = fixedNumber("guidance", "Guidance", "advanced", 3.5, "The current FLUX.1 worker always uses native guidance 3.5.");
  controls.scheduler = enabled({
    id: "scheduler", label: "Timestep strategy", group: "generation", level: "expert", kind: "enum",
    runtimeDefault: "flux1-official-20-guidance-3.5", recommendedDefault: "flux1-official-20-guidance-3.5",
    allowedValues: [{ value: "flux1-official-20-guidance-3.5", label: "FLUX.1 official 20-step guidance 3.5" }],
    help: "Official FLUX.1 schedule id flux1-official-20-guidance-3.5.", disabledReason: "Fixed by the current native worker.",
    fixed: true, perGenerationOverride: false,
  });
  controls.shift = fixedNumber("shift", "Schedule shift", "expert", true, "Schedule shifting is enabled by the current FLUX.1 worker.");
  controls.runtimeImplementation = { ...controls.runtimeImplementation, runtimeDefault: "black-forest-labs/flux", recommendedDefault: "black-forest-labs/flux", allowedValues: [{ value: "black-forest-labs/flux", label: "BFL FLUX native" }] };
  return { adapterId: "flux", runtimeImplementation: "black-forest-labs/flux", modelVariant: "flux1-dev", controls, presets: nativePresets({ steps: 20, guidance: 3.5 }) };
}

function flux2(modelVariant: NativeAdapterCapabilities["modelVariant"]): NativeAdapterCapabilities {
  const controls = commonControls();
  const klein = modelVariant === "flux2-klein-4b" || modelVariant === "flux2-klein-9b";
  const steps = klein ? 4 : 50;
  const guidance = klein ? 1 : 4;
  controls.steps = fixedNumber("steps", "Steps", "advanced", steps, klein
    ? "This timestep-distilled Klein checkpoint is fixed at 4 steps by the native adapter."
    : "The current FLUX.2 Dev worker uses its native 50-step default.");
  controls.guidance = fixedNumber("guidance", "Guidance", "advanced", guidance, klein
    ? "Guidance is distilled and fixed at 1.0 for this Klein checkpoint."
    : "The current FLUX.2 Dev worker uses native distilled guidance 4.0.");
  controls.scheduler = enabled({
    id: "scheduler", label: "Timestep strategy", group: "generation", level: "expert", kind: "enum",
    runtimeDefault: "flux2-empirical-snr", recommendedDefault: "flux2-empirical-snr",
    allowedValues: [{ value: "flux2-empirical-snr", label: "FLUX.2 empirical SNR" }],
    help: "Official FLUX.2 empirical SNR schedule computed from token sequence length and native step count.",
    disabledReason: "Fixed by the current native worker.", fixed: true, perGenerationOverride: false,
  });
  controls.references = enabled({
    id: "references", label: "Reference images", group: "conditioning", level: "basic", kind: "images",
    runtimeDefault: [], recommendedDefault: [], multiple: true,
    help: "One or more images are encoded as sequence conditioning by the native FLUX.2 adapter.",
    reloadEffect: "CACHE_INVALIDATION",
  });
  controls.keepResident = enabled({
    id: "keepResident", label: "Keep warm", group: "memory", level: "expert", kind: "boolean",
    runtimeDefault: true, recommendedDefault: true,
    help: "The loaded FLUX.2 transformer, text encoder, and VAE remain resident between jobs.",
    fixed: true, perGenerationOverride: false,
  });
  controls.unload = enabled({
    id: "unload", label: "Unload", group: "memory", level: "expert", kind: "action",
    help: "Manually releases the resident FLUX.2 session.", perGenerationOverride: false,
  });
  controls.runtimeImplementation = { ...controls.runtimeImplementation, runtimeDefault: "black-forest-labs/flux2", recommendedDefault: "black-forest-labs/flux2", allowedValues: [{ value: "black-forest-labs/flux2", label: "BFL FLUX.2 native" }] };
  return { adapterId: klein ? "klein-demo" : "flux2", runtimeImplementation: "black-forest-labs/flux2", modelVariant, controls, presets: nativePresets({ steps, guidance }) };
}

const ADAPTERS = {
  "flux1-dev": flux1(),
  "flux2-dev": flux2("flux2-dev"),
  "flux2-klein-4b": flux2("flux2-klein-4b"),
  "flux2-klein-9b": flux2("flux2-klein-9b"),
} satisfies Record<NativeAdapterCapabilities["modelVariant"], NativeAdapterCapabilities>;

export function nativeAdapterCapabilities(adapterId: string | undefined, baseName = ""): NativeAdapterCapabilities | null {
  if (adapterId === "flux") return ADAPTERS["flux1-dev"];
  if (adapterId === "flux2") return ADAPTERS["flux2-dev"];
  if (adapterId === "klein-demo") {
    return /4b/i.test(baseName) ? ADAPTERS["flux2-klein-4b"] : ADAPTERS["flux2-klein-9b"];
  }
  return null;
}

export function visibleControls(capabilities: NativeAdapterCapabilities, level: EngineControlLevel, includeDisabled = false): EngineControlCapability[] {
  return Object.values(capabilities.controls).filter((control) => control.level === level && (includeDisabled || control.supported));
}

export function runtimeDefaults(capabilities: NativeAdapterCapabilities): NativeGenerationValues {
  const values: NativeGenerationValues = {};
  for (const control of Object.values(capabilities.controls)) {
    if (control.runtimeDefault !== undefined) values[control.id] = control.runtimeDefault;
  }
  return values;
}

export function controlRequiresReload(capability: EngineControlCapability): boolean {
  return capability.reloadEffect === "COMPONENT_RELOAD" || capability.reloadEffect === "FULL_RELOAD";
}

export function changedReloadEffect(
  capabilities: NativeAdapterCapabilities,
  before: NativeGenerationValues,
  after: NativeGenerationValues,
): ReloadEffect {
  const priority: ReloadEffect[] = ["NO_RELOAD", "CACHE_INVALIDATION", "COMPONENT_RELOAD", "FULL_RELOAD"];
  let effect: ReloadEffect = "NO_RELOAD";
  for (const control of Object.values(capabilities.controls)) {
    if (Object.is(before[control.id], after[control.id])) continue;
    if (priority.indexOf(control.reloadEffect) > priority.indexOf(effect)) effect = control.reloadEffect;
  }
  return effect;
}
