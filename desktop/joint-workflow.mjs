/** Validate an explicit API-format H3 Ref2VA graph against the live runtime. No defaults or substitutions. */
export function compileJointWorkflow(workflow, info) {
  const prompt = workflow.joint?.prompt,
    issues = [];
  if (!prompt || typeof prompt !== "object" || Array.isArray(prompt))
    throw new Error("Expected an API-format workflow.");
  const ref = Object.entries(prompt).filter(
    ([, n]) => n.class_type === "MiniMaxH3ReferenceToVideo",
  );
  if (ref.length !== 1)
    throw new Error(
      "Expected one direct MiniMaxH3ReferenceToVideo node. Director timelines, FL2VA and hybrids require a separately verified adapter.",
    );
  const link = (v) =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isInteger(v[1]);
  for (const [id, node] of Object.entries(prompt)) {
    if (/tts|voicedesign|texttospeech/i.test(node.class_type))
      throw new Error("Separate TTS is not permitted in joint generation.");
    const schema = info[node.class_type];
    if (!schema) {
      issues.push(`Missing runtime node ${node.class_type}.`);
      continue;
    }
    const fields = { ...schema.input?.required, ...schema.input?.optional };
    // VHS advertises encoder controls under the selected format, not as top-level inputs.
    if (node.class_type === "VHS_VideoCombine" && typeof node.inputs.format === "string") {
      const widgets = fields.format?.[1]?.formats?.[node.inputs.format] ?? [];
      for (const widget of widgets)
        if (Array.isArray(widget) && typeof widget[0] === "string")
          fields[widget[0]] = widget.slice(1);
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      let rule = fields[name];
      if (!rule && name.includes(".")) {
        const [group, child] = name.split(".");
        const grow = fields[group];
        const template = grow?.[1]?.template;
        const suffix = child.slice(template?.prefix?.length ?? 0);
        if (
          grow?.[0] === "COMFY_AUTOGROW_V3" &&
          child.startsWith(template.prefix) &&
          /^\d+$/.test(suffix) &&
          Number(suffix) < template.max
        )
          rule = Object.values(template.input.required)[0];
      }
      if (!rule) {
        issues.push(`Unsupported input ${id}.${name}.`);
        continue;
      }
      if (link(value)) {
        const upstream = prompt[value[0]],
          type = info[upstream?.class_type]?.output?.[value[1]];
        if (!upstream || !type) issues.push(`Broken input ${id}.${name}.`);
        else if (
          typeof rule[0] === "string" &&
          rule[0] !== "*" &&
          type !== "*" &&
          !rule[0].split(",").includes(type)
        )
          issues.push(`Wrong socket type ${id}.${name}: ${type}.`);
      } else {
        const choices = Array.isArray(rule[0]) ? rule[0] : rule[1]?.options;
        if (
          choices &&
          !choices.includes(value) &&
          !["LoadAudio", "LoadImage"].includes(node.class_type)
        )
          issues.push(`Unavailable option/model ${id}.${name}.`);
        if (
          ["INT", "FLOAT"].includes(rule[0]) &&
          (!Number.isFinite(value) ||
            (rule[0] === "INT" && !Number.isInteger(value)) ||
            value < rule[1]?.min ||
            value > rule[1]?.max)
        )
          issues.push(`Invalid number ${id}.${name}.`);
        if (
          (rule[0] === "STRING" && typeof value !== "string") ||
          (rule[0] === "BOOLEAN" && typeof value !== "boolean")
        )
          issues.push(`Invalid value ${id}.${name}.`);
        if (!choices && !["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(rule[0]))
          issues.push(`Unconnected typed input ${id}.${name}.`);
      }
    }
    for (const name of Object.keys(schema.input?.required ?? {}))
      if (!(name in node.inputs)) issues.push(`Missing required ${id}.${name}.`);
  }
  const ancestors = (id, stack = new Set()) => {
    if (stack.has(id)) throw new Error("Cyclic joint workflow.");
    const n = prompt[id];
    if (!n) return new Set();
    const next = new Set(stack).add(id),
      found = new Set([id]);
    for (const v of Object.values(n.inputs))
      if (link(v)) for (const p of ancestors(v[0], next)) found.add(p);
    return found;
  };
  for (const id of Object.keys(prompt)) ancestors(id);
  const [refId, refNode] = ref[0];
  if (
    !Number.isInteger(refNode.inputs.length) ||
    refNode.inputs.length < 5 ||
    refNode.inputs.length > 362
  )
    issues.push(
      "Review an explicit bounded Ref2VA clip length of 5–362 frames; connected or full-film duration is unsupported.",
    );
  if (!link(refNode.inputs.audio_vae) || !link(refNode.inputs.vae))
    issues.push("Ref2VA requires connected image and audio VAEs for this adapter.");
  const audioKeys = Object.keys(refNode.inputs).filter((k) =>
    /^ref_audios\.ref_audio_\d+$/.test(k),
  );
  const imageKeys = Object.keys(refNode.inputs).filter((k) =>
    /^ref_images\.ref_image_\d+$/.test(k),
  );
  if (!audioKeys.length || audioKeys.length > 3 || imageKeys.length !== audioKeys.length)
    issues.push("Connect one image and audio reference per speaker, up to three.");
  // Prove the positive CONDITIONING socket itself carries our prompt. Latent/model
  // ancestry cannot establish this. Unknown conditioning transforms fail closed.
  const carriesPositive = (value) => link(value) && value[0] === refId && value[1] === 0;
  const samplerPositive = (id) => {
    const n = prompt[id];
    if (["KSampler", "KSamplerAdvanced"].includes(n.class_type))
      return carriesPositive(n.inputs.positive);
    if (
      n.class_type !== "SamplerCustomAdvanced" ||
      !link(n.inputs.guider) ||
      n.inputs.guider[1] !== 0
    )
      return false;
    const guider = prompt[n.inputs.guider[0]];
    if (guider?.class_type === "CFGGuider") return carriesPositive(guider.inputs.positive);
    if (guider?.class_type === "BasicGuider") return carriesPositive(guider.inputs.conditioning);
    return false;
  };
  const samplers = Object.keys(prompt).filter(
    (id) =>
      ["KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced"].includes(prompt[id].class_type) &&
      samplerPositive(id),
  );
  if (!samplers.length)
    issues.push(
      "Sampler positive conditioning must use Ref2VA positive output through a supported path.",
    );
  const loaders = samplers
    .flatMap((id) => [...ancestors(id)])
    .filter((id) => /UNETLoader|CheckpointLoader/.test(prompt[id].class_type));
  if (
    !loaders.length ||
    loaders.some(
      (id) =>
        !Object.values(prompt[id].inputs).some(
          (v) => typeof v === "string" && /ref2va/i.test(v) && !/fl2va|hybrid/i.test(v),
        ),
    )
  )
    issues.push(
      "The connected sampler must use an explicitly selected Ref2VA model; FL2VA/hybrid capabilities are not assumed.",
    );
  const av = Object.entries(prompt).some(([, n]) => {
    const video =
      n.class_type === "VHS_VideoCombine"
        ? n
        : n.class_type === "SaveVideo" && link(n.inputs.video)
          ? prompt[n.inputs.video[0]]
          : null;
    if (
      !video ||
      !["VHS_VideoCombine", "CreateVideo"].includes(video.class_type) ||
      !link(video.inputs.images) ||
      !link(video.inputs.audio)
    )
      return false;
    if (video.class_type === "VHS_VideoCombine" && video.inputs.save_output !== true) return false;
    const imageAncestors = ancestors(video.inputs.images[0]),
      audioAncestors = ancestors(video.inputs.audio[0]);
    const outputSamplers = [...new Set([...imageAncestors, ...audioAncestors])].filter((id) =>
      ["KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced"].includes(prompt[id].class_type),
    );
    return (
      outputSamplers.length > 0 &&
      outputSamplers.every(samplerPositive) &&
      samplers.some((id) => imageAncestors.has(id) && audioAncestors.has(id))
    );
  });
  if (!av)
    issues.push(
      "A saved video must connect both generated images and generated audio from the same Ref2VA sampler.",
    );
  return { prompt, issues: [...new Set(issues)], nodeCount: Object.keys(prompt).length };
}
