// Pure ComfyUI frontend-to-API conversion. No defaults, model substitutions,
// file access, process startup, or rendering belong in this module.
const has = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const scalarTypes = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO']);
const notes = new Set(['Note', 'MarkdownNote', 'Label (rgthree)']);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const widget = (schema) => Array.isArray(schema) && !schema[1]?.forceInput &&
  (Array.isArray(schema[0]) || scalarTypes.has(schema[0]));

function inputDefinitions(info, node, issues) {
  const definitions = { ...info?.input?.required, ...info?.input?.optional };
  const required = new Set(Object.keys(info?.input?.required ?? {}));
  const order = [...(info?.input_order?.required ?? Object.keys(info?.input?.required ?? {})),
    ...(info?.input_order?.optional ?? Object.keys(info?.input?.optional ?? {}))];
  for (const name of Object.keys(definitions)) if (!order.includes(name)) order.push(name);
  for (const [name, schema] of Object.entries(definitions)) {
    if (schema[0] !== 'COMFY_AUTOGROW_V3') continue;
    const template = schema[1]?.template;
    const children = Object.values({ ...template?.input?.required, ...template?.input?.optional });
    const names = Array.isArray(template?.names) ? template.names :
      typeof template?.prefix === 'string' && Number.isInteger(template.max) && template.max >= 0 && template.max <= 100
        ? Array.from({ length: template.max }, (_, index) => `${template.prefix}${index}`) : null;
    const minimum = required.has(name) && Object.keys(template?.input?.required ?? {}).length ? (template?.min ?? 0) : 0;
    if (!names || children.length !== 1 || !Number.isInteger(minimum) || minimum < 0 || minimum > names.length ||
      names.some(child => typeof child !== 'string' || !child) || new Set(names).size !== names.length) {
      issues.push(`Node ${node.id} ${name}: unsupported or invalid dynamic input template.`);
      continue;
    }
    // V3 expands the container into dotted inputs; the first min names are
    // required, rather than any arbitrary min-sized subset of connections.
    delete definitions[name]; required.delete(name);
    const expanded = names.map(child => `${name}.${child}`);
    order.splice(order.indexOf(name), 1, ...expanded);
    expanded.forEach((child, index) => {
      definitions[child] = [children[0][0], { ...children[0][1], forceInput: true }];
      if (index < minimum) required.add(child);
    });
    for (const input of node.inputs ?? []) if ((input.name === name || input.name.startsWith(`${name}.`)) && !expanded.includes(input.name)) {
      issues.push(`Node ${node.id} ${input.name}: unavailable dynamic input name.`);
    }
  }
  return { definitions, order, required };
}

function widgets(node, definitions, order, issues) {
  const values = {};
  const positional = Array.isArray(node.widgets_values) ? node.widgets_values : null;
  const mapped = !positional && node.widgets_values && typeof node.widgets_values === 'object' ? node.widgets_values : {};
  const named = node.widgets_values_named ?? {};
  let index = 0;
  for (const name of order) {
    if (!widget(definitions[name])) continue;
    let value;
    if (positional) {
      value = positional[index++];
      if ((definitions[name][1]?.control_after_generate || name === 'seed' || name === 'noise_seed') &&
        ['fixed', 'randomize', 'increment', 'decrement'].includes(positional[index])) index++;
    } else value = mapped[name];
    if (value === undefined && !has(node, 'widgets_values')) value = named[name];
    if (value !== undefined) values[name] = value;
    if (has(named, name) && value !== undefined && !equal(named[name], value)) {
      issues.push(`Node ${node.id} ${name}: widgets_values and widgets_values_named disagree. Update both copies.`);
    }
  }
  // VHS encoder options are dynamic widgets declared by the selected format.
  if (node.type === 'VHS_VideoCombine') {
    const formatOptions = definitions.format?.[1]?.formats?.[values.format] ?? [];
    for (const [name, type, config] of formatOptions) {
      definitions[name] = [type, config ?? {}];
      if (has(mapped, name)) values[name] = mapped[name];
      else if (!has(node, 'widgets_values') && has(named, name)) values[name] = named[name];
      if (has(named, name) && has(values, name) && !equal(named[name], values[name])) {
        issues.push(`Node ${node.id} ${name}: widgets_values and widgets_values_named disagree. Update both copies.`);
      }
    }
  }
  return values;
}

function normalizedLink(link) {
  const value = Array.isArray(link) ? { id: link[0], origin_id: link[1], origin_slot: link[2], target_id: link[3], target_slot: link[4] } : link;
  if (!value || value.id == null || !Number.isInteger(value.origin_slot) || value.origin_slot < 0 ||
    !Number.isInteger(value.target_slot) || value.target_slot < 0) throw new Error('Malformed workflow link.');
  return value;
}

function expand(graph, issues) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) throw new Error('Expected a ComfyUI workflow with nodes and links.');
  const definitions = new Map();
  for (const definition of graph.definitions?.subgraphs ?? []) {
    if (!definition?.id || definitions.has(definition.id)) throw new Error('Duplicate or missing subgraph definition id.');
    definitions.set(definition.id, definition);
  }
  const executable = new Map();
  function context(container, parent = null, wrapper = null, stack = []) {
    if (!Array.isArray(container.nodes) || !Array.isArray(container.links)) throw new Error('Malformed subgraph nodes or links.');
    const ctx = { container, parent, wrapper, nodes: new Map(), links: new Map(), children: new Map(), values: {} };
    for (const node of container.nodes) {
      const id = String(node?.id);
      if (node?.id == null || !['string', 'number'].includes(typeof node.id) || typeof node.type !== 'string' || !node.type || id === '-10' || id === '-20' || ctx.nodes.has(id)) throw new Error(`Duplicate or invalid node id ${id}.`);
      if (node.mode && node.mode !== 0) throw new Error(`Node ${id} uses unsupported muted/bypassed mode ${node.mode}. Enable it or remove it explicitly.`);
      const names = new Set();
      for (const input of node.inputs ?? []) {
        if (typeof input.name !== 'string' || names.has(input.name)) throw new Error(`Node ${id} has duplicate or invalid input names.`);
        names.add(input.name);
      }
      ctx.nodes.set(id, node);
    }
    for (const raw of container.links) {
      const link = normalizedLink(raw);
      if (ctx.links.has(String(link.id))) throw new Error(`Duplicate workflow link ${link.id}.`);
      const source = String(link.origin_id) === '-10' && parent ? container.inputs?.[link.origin_slot] : ctx.nodes.get(String(link.origin_id))?.outputs?.[link.origin_slot];
      const target = String(link.target_id) === '-20' && parent ? container.outputs?.[link.target_slot] : ctx.nodes.get(String(link.target_id))?.inputs?.[link.target_slot];
      if (!source || !target) throw new Error(`Link ${link.id} has a missing node or invalid socket.`);
      if (String(link.target_id) !== '-20' && String(target.link) !== String(link.id)) throw new Error(`Link ${link.id} disagrees with its destination input.`);
      ctx.links.set(String(link.id), link);
    }
    for (const node of container.nodes) {
      for (const [slot, input] of (node.inputs ?? []).entries()) if (input.link != null) {
        const link = ctx.links.get(String(input.link));
        if (!link || String(link.target_id) !== String(node.id) || link.target_slot !== slot) throw new Error(`Node ${node.id} input ${input.name} has a broken link.`);
      }
      const definition = definitions.get(node.type);
      if (definition) {
        if (stack.includes(node.type)) throw new Error(`Recursive subgraph ${node.type} is unsupported.`);
        const child = context(definition, ctx, node, [...stack, node.type]);
        const schemas = Object.fromEntries((definition.inputs ?? []).map((input) => {
          const socket = node.inputs?.find(item => item.name === input.name);
          // A linked scalar port is not necessarily a converted widget. Decode's
          // plain fps socket has no saved positional value; a promoted seed does.
          const portOnly = socket?.link != null && !socket.widget && !has(node.widgets_values_named, input.name);
          return [input.name, [input.type, { forceInput: portOnly }]];
        }));
        child.values = widgets(node, schemas, Object.keys(schemas), issues);
        ctx.children.set(String(node.id), child);
      } else {
        if (executable.has(String(node.id))) throw new Error(`Workflow reuses executable node id ${node.id}; repeated subgraph instances need unique node ids.`);
        executable.set(String(node.id), { node, ctx });
      }
    }
    return ctx;
  }
  const root = context(graph);
  function source(ctx, id, slot, stack = new Set()) {
    const key = `${ctx.wrapper?.id ?? 'root'}/${id}/${slot}`;
    if (stack.has(key)) throw new Error('Cyclic workflow boundary or reroute.');
    const next = new Set(stack).add(key);
    if (String(id) === '-10') {
      const name = ctx.container.inputs?.[slot]?.name;
      if (!ctx.parent || !name) throw new Error('Unresolved subgraph input boundary.');
      const input = ctx.wrapper.inputs?.find((item) => item.name === name);
      if (input?.link != null) return linked(ctx.parent, input.link, next);
      return has(ctx.values, name) ? { literal: ctx.values[name] } : null;
    }
    const node = ctx.nodes.get(String(id));
    const child = ctx.children.get(String(id));
    if (child) {
      const boundaries = [...child.links.values()].filter((link) => String(link.target_id) === '-20' && link.target_slot === slot);
      if (boundaries.length !== 1) throw new Error(`Subgraph ${id} output ${slot} needs exactly one source.`);
      return linked(child, boundaries[0].id, next);
    }
    if (!node) throw new Error(`Missing source node ${id}.`);
    if (node.type === 'Reroute') {
      if (node.inputs?.length !== 1 || node.inputs[0].link == null) throw new Error(`Unconnected reroute ${id}.`);
      return linked(ctx, node.inputs[0].link, next);
    }
    if (notes.has(node.type)) throw new Error(`Annotation node ${id} cannot supply an executable input.`);
    return { reference: [String(id), slot] };
  }
  function linked(ctx, linkId, stack) {
    const link = ctx.links.get(String(linkId));
    if (!link) throw new Error(`Missing workflow link ${linkId}.`);
    return source(ctx, link.origin_id, link.origin_slot, stack);
  }
  return { executable, resolve: (ctx, link) => linked(ctx, link, new Set()), root };
}

function validateValue(label, value, schema, issues) {
  const [type, config = {}] = schema;
  const options = Array.isArray(type) ? type : type === 'COMBO' ? config.options : null;
  if (options && !options.some((option) => equal(option, value))) issues.push(`${label}: selected value ${JSON.stringify(value)} is unavailable in ComfyUI (check the installed model or option).`);
  else if (typeof type === 'string') {
    const types = type.split(',');
    const matches = candidate => candidate === 'INT' ? Number.isInteger(value) : candidate === 'FLOAT' ? typeof value === 'number' && Number.isFinite(value) :
      candidate === 'STRING' ? typeof value === 'string' : candidate === 'BOOLEAN' ? typeof value === 'boolean' : true;
    if (!types.some(matches)) issues.push(`${label}: expected ${type}.`);
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || (typeof config.min === 'number' && value < config.min) || (typeof config.max === 'number' && value > config.max))) {
    issues.push(`${label}: value must be finite and within ${config.min ?? '-∞'} to ${config.max ?? '∞'}.`);
  }
}

const typeNames = type => Array.isArray(type) ? ['COMBO'] : String(type).split(',').map(name => name.trim());
const compatible = (actual, expected) => actual === '*' || expected === '*' ||
  typeNames(actual).some(type => typeNames(expected).includes(type) || (type === 'INT' && typeNames(expected).includes('FLOAT')));

function matchTypes(prompt, objectInfo, schemas, issues) {
  const groups = new Map();
  const group = (id, name) => {
    if (typeof name !== 'string' || !name) {
      issues.push(`Node ${id}: missing dynamic match-type template id.`);
      return null;
    }
    const key = `${id}/${name}`;
    if (!groups.has(key)) groups.set(key, { key, parent: key, constraints: [] });
    return key;
  };
  const root = key => {
    const entry = groups.get(key);
    if (entry.parent !== key) entry.parent = root(entry.parent);
    return entry.parent;
  };
  const inputGroup = (id, schema) => schema?.[0] === 'COMFY_MATCHTYPE_V3' ? group(id, schema[1]?.template?.template_id) : null;
  const outputGroup = (id, slot) => {
    const info = objectInfo[prompt[id]?.class_type];
    return info?.output?.[slot] === 'COMFY_MATCHTYPE_V3' ? group(id, info.output_matchtypes?.[slot]) : null;
  };
  const constrain = (key, type, producer = true) => {
    if (key && type !== undefined) groups.get(key).constraints.push({ type, producer });
  };
  for (const [id, node] of Object.entries(prompt)) {
    for (const schema of Object.values(schemas.get(id).definitions)) {
      const key = inputGroup(id, schema);
      const allowed = schema[1]?.template?.allowed_types ?? '*';
      if (key) constrain(key, Array.isArray(allowed) ? allowed.join(',') : allowed);
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      const schema = schemas.get(id).definitions[name];
      const expected = inputGroup(id, schema);
      if (Array.isArray(value) && typeof value[0] === 'string' && Number.isInteger(value[1])) {
        const actual = outputGroup(value[0], value[1]);
        if (actual && expected) groups.get(root(actual)).parent = root(expected);
        else if (expected) constrain(expected, objectInfo[prompt[value[0]]?.class_type]?.output?.[value[1]]);
        else if (actual && schema) constrain(actual, Array.isArray(schema[0]) ? 'COMBO' : schema[0], false);
      } else if (expected) {
        const literal = typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' :
          typeof value === 'number' ? Number.isInteger(value) ? 'INT' : 'FLOAT' : '*';
        constrain(expected, literal);
      }
    }
  }
  const combined = new Map();
  for (const entry of groups.values()) {
    const key = root(entry.key);
    if (!combined.has(key)) combined.set(key, []);
    combined.get(key).push(...entry.constraints);
  }
  const resolved = new Map();
  for (const [key, constraints] of combined) {
    const concrete = constraints.filter(item => item.type !== '*');
    const candidates = new Set(concrete.flatMap(item => typeNames(item.type)));
    if (concrete.some(item => !item.producer && typeNames(item.type).includes('FLOAT'))) candidates.add('INT');
    const allowed = [...candidates].filter(type => concrete.every(item => item.producer ? typeNames(item.type).includes(type) : compatible(type, item.type)));
    if (concrete.length && !allowed.length) issues.push(`Node ${key}: incompatible dynamic match-type connections (${concrete.map(item => item.type).join(', ')}).`);
    resolved.set(key, allowed.length ? allowed.join(',') : '*');
  }
  return {
    input: (id, schema) => { const key = inputGroup(id, schema); return key ? resolved.get(root(key)) ?? '*' : schema?.[0]; },
    output: (id, slot) => { const key = outputGroup(id, slot); return key ? resolved.get(root(key)) ?? '*' : objectInfo[prompt[id]?.class_type]?.output?.[slot]; },
  };
}

/** Compile the approved UI graph without changing its timing or generation settings. */
export function compileDirectorWorkflow(workflow, objectInfo) {
  if (!objectInfo || typeof objectInfo !== 'object' || Array.isArray(objectInfo)) throw new Error('ComfyUI object_info is required.');
  const issues = [];
  const { executable, resolve } = expand(workflow, issues);
  const prompt = Object.create(null);
  const schemas = new Map();
  for (const [id, { node, ctx }] of executable) {
    if (notes.has(node.type) || node.type === 'Reroute') continue;
    const info = has(objectInfo, node.type) ? objectInfo[node.type] : undefined;
    if (!info) issues.push(`Node ${id}: missing ComfyUI node class ${node.type}.`);
    const { definitions, order, required } = inputDefinitions(info, node, issues);
    const values = widgets(node, definitions, order, issues);
    const inputs = { ...values };
    for (const input of node.inputs ?? []) if (input.link != null) {
      const resolved = resolve(ctx, input.link);
      if (resolved) inputs[input.name] = resolved.reference ?? resolved.literal;
      else delete inputs[input.name];
    }
    if (node.type === 'LTXDirector') {
      for (const name of Object.keys(values)) if (has(node.properties, name) && !equal(node.properties[name], values[name])) {
        issues.push(`Node ${id} ${name}: properties and widgets_values disagree. Update both copies.`);
      }
      try {
        const timeline = JSON.parse(inputs.timeline_data);
        if (!timeline || !Array.isArray(timeline.segments) || !timeline.segments.length) throw new Error('No segments');
        for (const segment of timeline.segments) if (!Number.isInteger(segment.start) || segment.start < 0 || !Number.isInteger(segment.length) || segment.length <= 0 || typeof segment.prompt !== 'string') throw new Error('Invalid segment timing or prompt');
        for (const copy of [node.properties, node.widgets_values_named]) if (has(copy, 'global_prompt') && !equal(copy.global_prompt, timeline.global_prompt)) {
          issues.push(`Node ${id} global_prompt: timeline and duplicated global prompt disagree. Update both copies.`);
        }
      } catch { issues.push(`Node ${id}: timeline_data must contain segments with nonnegative integer starts, positive frame lengths, and prompts.`); }
    }
    prompt[id] = { class_type: node.type, inputs };
    schemas.set(id, { definitions, required });
  }
  const directors = Object.entries(prompt).filter(([, node]) => node.class_type === 'LTXDirector');
  if (directors.length !== 1) issues.push('The workflow must contain exactly one enabled LTXDirector node.');
  const dynamicTypes = matchTypes(prompt, objectInfo, schemas, issues);
  for (const [id, node] of Object.entries(prompt)) {
    for (const name of schemas.get(id).required) if (!has(node.inputs, name)) issues.push(`Node ${id} ${node.class_type}: missing required input ${name}.`);
    for (const [name, value] of Object.entries(node.inputs)) {
      const schema = schemas.get(id).definitions[name];
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1])) {
        const upstream = prompt[value[0]];
        const outputs = objectInfo[upstream?.class_type]?.output;
        if (!upstream) issues.push(`Node ${id} ${name}: missing upstream node ${value[0]}.`);
        else if (outputs && (value[1] < 0 || value[1] >= outputs.length)) issues.push(`Node ${id} ${name}: invalid upstream output slot ${value[1]}.`);
        else if (schema && outputs) {
          const expected = Array.isArray(schema[0]) ? 'COMBO' : dynamicTypes.input(id, schema);
          const actual = dynamicTypes.output(value[0], value[1]);
          if (!compatible(actual, expected)) issues.push(`Node ${id} ${name}: cannot connect ${actual} to ${expected}.`);
        }
      } else if (schema) validateValue(`Node ${id} ${name}`, value, schema, issues);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function checkCycle(id) {
    if (visiting.has(id)) throw new Error(`Cyclic executable graph at node ${id}.`);
    if (visited.has(id) || !prompt[id]) return;
    visiting.add(id);
    for (const value of Object.values(prompt[id].inputs)) if (Array.isArray(value) && typeof value[0] === 'string') checkCycle(value[0]);
    visiting.delete(id); visited.add(id);
  }
  for (const id of Object.keys(prompt)) checkCycle(id);
  function fromDirector(value, seen = new Set()) {
    if (!Array.isArray(value) || !prompt[value[0]] || seen.has(value[0])) return false;
    const upstream = prompt[value[0]];
    if (upstream.class_type === 'LTXDirector') return ['CONDITIONING', 'LATENT', 'IMAGE', 'VIDEO'].includes(objectInfo.LTXDirector?.output?.[value[1]]);
    const next = new Set(seen).add(value[0]);
    return Object.values(upstream.inputs).some((input) => fromDirector(input, next));
  }
  const output = Object.values(prompt).some((node) => objectInfo[node.class_type]?.output_node &&
    ((node.class_type === 'VHS_VideoCombine' && node.inputs.save_output === true && typeof node.inputs.format === 'string' && node.inputs.format.startsWith('video/') && fromDirector(node.inputs.images)) ||
     (node.class_type === 'SaveVideo' && fromDirector(node.inputs.video))));
  if (!output) issues.push('The workflow needs a saved video output connected to LTXDirector image, latent, or conditioning outputs.');
  return { prompt, issues: [...new Set(issues)], nodeCount: Object.keys(prompt).length };
}
