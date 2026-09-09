import {
  UNKNOWN,
  type LogicalModel,
  type ModelCatalog,
  type ModelComponent,
  type ModelRole,
  type Modality,
} from "./model-catalog.ts";

export type EngineConfigStatus = "Ready" | "Missing components" | "Adapter unavailable";

export type EngineComponentSlot = {
  role: ModelRole;
  label: string;
  required: boolean;
  selected: ModelComponent[];
  alternatives: ModelComponent[];
};

export type EngineConfig = {
  id: string;
  displayName: string;
  family: string;
  modality: Modality | typeof UNKNOWN;
  base: ModelComponent;
  slots: EngineComponentSlot[];
  runtimeSizeBytes: number;
  familyFootprintBytes: number;
  runtimeBackend: string;
  adapterId?: string;
  status: EngineConfigStatus;
  missing: string[];
};

type SlotSpec = {
  role: ModelRole;
  label: string;
  required: boolean;
  minimum?: number;
};

const DIFFUSION_SLOTS: SlotSpec[] = [
  { role: "text_encoder", label: "Text encoder", required: true },
  { role: "vae", label: "VAE", required: true },
  { role: "audio_vae", label: "Audio VAE", required: false },
  { role: "upscaler", label: "Upscaler", required: false, minimum: 0 },
  { role: "control", label: "Adapter", required: false, minimum: 0 },
];

const OPTIONAL_SLOTS: SlotSpec[] = [
  { role: "text_encoder", label: "Text encoder", required: false },
  { role: "vae", label: "VAE", required: false },
  { role: "audio_vae", label: "Audio VAE", required: false },
  { role: "vision_encoder", label: "Vision encoder", required: false },
  { role: "projector", label: "Projector", required: false },
  { role: "tokenizer", label: "Tokenizer", required: false },
  { role: "upscaler", label: "Upscaler", required: false, minimum: 0 },
  { role: "control", label: "Adapter", required: false, minimum: 0 },
  { role: "support", label: "Support", required: false, minimum: 0 },
];

const FAMILY_SLOTS: Record<string, SlotSpec[]> = {
  "FLUX.1": [{ role: "text_encoder", label: "Text encoders", required: true, minimum: 2 }, ...DIFFUSION_SLOTS.slice(1)],
  "FLUX.2": DIFFUSION_SLOTS,
  "FLUX.2 Klein": DIFFUSION_SLOTS,
  "Krea 2": DIFFUSION_SLOTS,
  "Qwen Image": DIFFUSION_SLOTS,
  "LTX 2.3": DIFFUSION_SLOTS,
  "LTX 2.5": DIFFUSION_SLOTS,
  "LTX-2": DIFFUSION_SLOTS,
  "MiniMax H3": DIFFUSION_SLOTS,
  "MiniMax Music3": [
    { role: "text_encoder", label: "Text encoder", required: true },
    { role: "audio_vae", label: "Audio VAE", required: true },
  ],
};

function normalized(component: ModelComponent): string {
  return `${component.displayName} ${component.path}`.replace(/\\/g, "/").toLowerCase();
}

function unique(components: ModelComponent[]): ModelComponent[] {
  const seen = new Set<string>();
  return components.filter((component) => {
    const key = component.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function allComponents(catalog: ModelCatalog): ModelComponent[] {
  return unique([...catalog.models.flatMap((model) => model.components), ...catalog.unmapped]);
}

function globalMatches(family: string, role: ModelRole, components: ModelComponent[]): ModelComponent[] {
  const candidates = components.filter((component) => component.role === role);
  if (family === "Krea 2") {
    if (role === "text_encoder") return candidates.filter((c) => /qwen3[- _]?vl[- _]?4b|qwen3vl_4b/.test(normalized(c)));
    if (role === "vae") return candidates.filter((c) => /krea2realvae_v10|qwen.*image.*vae/.test(normalized(c)));
  }
  if (family === "FLUX.1") {
    if (role === "text_encoder") return candidates.filter((c) => /(^|[/ _-])clip_l|t5xxl/.test(normalized(c)));
    if (role === "vae") return candidates.filter((c) => /(^|[/ _-])ae([. _-]|$)/.test(normalized(c)));
  }
  if (family === "FLUX.2 Klein") {
    if (role === "text_encoder") return candidates.filter((c) => /qwen[_ .-]*3[_ .-]*(4b|8b)/.test(normalized(c)));
    if (role === "vae") return candidates.filter((c) => /flux2[._ -]*vae/.test(normalized(c)));
  }
  if (family === "Qwen Image" && role === "text_encoder") {
    return candidates.filter((c) => /qwen[_ .-]*2\.5[_ .-]*vl/.test(normalized(c)));
  }
  return [];
}

function precisionAffinity(base: ModelComponent, component: ModelComponent): number {
  const baseName = normalized(base);
  const componentName = normalized(component);
  let score = 0;
  if (base.precision !== UNKNOWN && base.precision === component.precision) score += 8;
  if (/bf16/.test(baseName) && /bf16/.test(componentName)) score += 7;
  if (/int8/.test(baseName) && /int8/.test(componentName)) score += 7;
  if (/fp8/.test(baseName) && /fp8/.test(componentName)) score += 7;
  if (/nvfp4/.test(baseName) && /nvfp4|fp4/.test(componentName)) score += 7;
  if (/gguf/.test(baseName) && /gguf/.test(componentName)) score += 5;
  if (/pruned/.test(baseName) === /pruned/.test(componentName)) score += 1;
  return score;
}

function selectComponents(family: string, base: ModelComponent, role: ModelRole, candidates: ModelComponent[], minimum = 1): ModelComponent[] {
  if (candidates.length === 0) return [];
  if (family === "Krea 2" && (role === "text_encoder" || role === "vae")) {
    const selected = globalMatches(family, role, candidates).find((component) => role === "text_encoder" ? /qwen3vl_4b_bf16\.safetensors/.test(normalized(component)) : /krea2realvae_v10\.safetensors/.test(normalized(component)));
    return selected ? [selected] : [];
  }
  const ordered = [...candidates].sort((a, b) => {
    const affinity = precisionAffinity(base, b) - precisionAffinity(base, a);
    if (affinity !== 0) return affinity;
    return b.sizeBytes - a.sizeBytes;
  });

  if (family === "FLUX.1") {
    if (role === "text_encoder") {
      const clip = ordered.find((c) => /(^|[/ _-])clip_l/.test(normalized(c)));
      const t5 = ordered.find((c) => /t5xxl/.test(normalized(c)));
      return unique([clip, t5].filter((c): c is ModelComponent => Boolean(c)));
    }
  }
  if (family === "FLUX.2 Klein" && role === "text_encoder") {
    const wants4b = /4b/.test(normalized(base));
    const matched = ordered.find((c) => wants4b ? /4b/.test(normalized(c)) : /8b/.test(normalized(c)));
    return matched ? [matched] : [];
  }
  if (family === "MiniMax H3" && role === "vae") {
    const video = ordered.filter((c) => /video/.test(normalized(c)));
    return (video[0] ? [video[0]] : ordered.slice(0, minimum));
  }
  return ordered.slice(0, minimum);
}

function slotSpecs(model: LogicalModel): SlotSpec[] {
  const known = FAMILY_SLOTS[model.family] ?? [];
  const knownRoles = new Set(known.map((slot) => slot.role));
  return [...known, ...OPTIONAL_SLOTS.filter((slot) => !knownRoles.has(slot.role))];
}

function standaloneAdapterId(family: string, base: ModelComponent): string | undefined {
  const value = normalized(base);
  if (!/\.safetensors($|\s)/.test(value)) return undefined;
  // The native worker currently binds these exact checkpoints. Similar files stay
  // visible as mapped configurations, but are not marked runnable by substitution.
  if (family === "FLUX.1" && /diffusion_models\/flux1-dev\.safetensors$/.test(value)) return "flux";
  if (family === "FLUX.2" && /diffusion_models\/flux2_dev\.safetensors$/.test(value)) return "flux2";
  if (family === "FLUX.2 Klein" && /diffusion_models\/flux2\/flux-2-klein-(4b-fp8|9b-fp8mixed)\.safetensors$/.test(value)) return "klein-demo";
  if (family === "Krea 2" && /diffusion_models\/(?:krea 2\/)?krea2_raw_bf16\.safetensors$/.test(value)) return "krea-2";
  return undefined;
}

function buildForBase(model: LogicalModel, base: ModelComponent, global: ModelComponent[]): EngineConfig {
  const specs = slotSpecs(model);
  const familyComponents = model.components.filter((component) => component.path !== base.path);
  const slots = specs.map((spec) => {
    const candidates = unique([
      ...familyComponents.filter((component) => component.role === spec.role),
      ...globalMatches(model.family, spec.role, global),
    ]);
    const selected = selectComponents(model.family, base, spec.role, candidates, spec.minimum ?? 1);
    const selectedPaths = new Set(selected.map((component) => component.path.toLowerCase()));
    return {
      role: spec.role,
      label: spec.label,
      required: spec.required,
      selected,
      alternatives: candidates.filter((component) => !selectedPaths.has(component.path.toLowerCase())),
    };
  });
  const missing = slots
    .filter((slot) => slot.required && slot.selected.length === 0)
    .map((slot) => slot.label);
  const selected = unique([base, ...slots.flatMap((slot) => slot.selected)]);
  const adapterId = standaloneAdapterId(model.family, base);
  const status: EngineConfigStatus = missing.length > 0 ? "Missing components" : adapterId ? "Ready" : "Adapter unavailable";
  return {
    id: `engine:${base.path}`,
    displayName: base.displayName,
    family: model.family,
    modality: model.modality,
    base,
    slots,
    runtimeSizeBytes: selected.reduce((sum, component) => sum + component.sizeBytes, 0),
    familyFootprintBytes: model.sizeBytes,
    runtimeBackend: model.runtimeBackend,
    adapterId,
    status,
    missing,
  };
}

export function buildEngineConfigs(catalog: ModelCatalog): EngineConfig[] {
  const global = allComponents(catalog);
  const configs = catalog.models.flatMap((model) => {
    if (!model.independentlyUsable) return [];
    const bases = model.components.filter((component) => component.role === "transformer" || component.role === "standalone");
    return bases.map((base) => buildForBase(model, base, global));
  });
  return configs.sort((a, b) => {
    const modality = a.modality.localeCompare(b.modality);
    if (modality !== 0) return modality;
    const family = a.family.localeCompare(b.family);
    if (family !== 0) return family;
    return a.displayName.localeCompare(b.displayName);
  });
}
