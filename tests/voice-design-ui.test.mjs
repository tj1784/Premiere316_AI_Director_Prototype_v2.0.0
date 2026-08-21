import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const COMPONENT_URL = new URL("../client/src/components/VoiceDesignWorkspace.tsx", import.meta.url);
const COMPONENT_FILE = fileURLToPath(COMPONENT_URL);
const source = fs.readFileSync(COMPONENT_FILE, "utf8");
const syntax = ts.createSourceFile(COMPONENT_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const SHELL_URL = new URL("../client/src/components/CreateSoundWorkspace.tsx", import.meta.url);
const SHELL_FILE = fileURLToPath(SHELL_URL);
const shellSource = fs.readFileSync(SHELL_FILE, "utf8");
const shellSyntax = ts.createSourceFile(SHELL_FILE, shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function visit(node, predicate, matches = []) {
  if (predicate(node)) matches.push(node);
  ts.forEachChild(node, (child) => {
    visit(child, predicate, matches);
  });
  return matches;
}

function callsNamed(name, tree = syntax) {
  return visit(tree, (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name);
}

function functionNamed(name, tree) {
  return visit(tree, (node) => (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    && node.name
    && ts.isIdentifier(node.name)
    && node.name.text === name
  ))[0] || visit(tree, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === name
    && node.initializer
    && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
  ))[0]?.initializer;
}

function effectContaining(tree, fragment) {
  return callsNamed("useEffect", tree).find((call) => call.getText(tree).includes(fragment));
}

function jsxAttribute(element, name) {
  return element.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === name);
}

function propertyNames(objectLiteral) {
  assert.ok(ts.isObjectLiteralExpression(objectLiteral), "expected an object literal");
  return objectLiteral.properties.map((property) => {
    assert.ok(
      ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property),
      "API payloads should use explicit or shorthand properties"
    );
    return property.name.getText(syntax).replace(/^['"]|['"]$/g, "");
  });
}

function loadExecutableExports() {
  const cssImport = /^import\s+["']\.\/VoiceDesignWorkspace\.css["'];\s*$/m;
  assert.match(source, cssImport, "component should own its scoped stylesheet");
  const instrumented = `${source.replace(cssImport, "")}\nexport const __voiceDesignUiInternals = { defaultDraft, FORBIDDEN_AUDIBLE_METADATA, ACTIVE_JOB_STATUSES, collectAuditions, auditionName };\n`;
  const compiled = ts.transpileModule(instrumented, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: COMPONENT_FILE,
    reportDiagnostics: true
  });
  const errors = (compiled.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));

  const testModule = { exports: {} };
  const localRequire = createRequire(pathToFileURL(COMPONENT_FILE));
  vm.runInNewContext(compiled.outputText, {
    exports: testModule.exports,
    module: testModule,
    require: localRequire,
    __filename: COMPONENT_FILE,
    __dirname: path.dirname(COMPONENT_FILE),
    console
  }, { filename: COMPONENT_FILE });
  return testModule.exports;
}

const componentExports = loadExecutableExports();
const { compileVoiceDesignInstruct, __voiceDesignUiInternals } = componentExports;

test("structured casting fields compile into non-audible Qwen direction", () => {
  const description = {
    ...__voiceDesignUiInternals.defaultDraft().description,
    apparentAge: "nineteen-year-old",
    genderPresentation: "masculine",
    vocalRegister: "light baritone leaning toward tenor",
    timbre: "rich natural chestnut warmth",
    diction: "clear but unpolished",
    emotionalTemperament: "confident energy masking uncertainty",
    performanceStyle: "intimate live-action dramatic performance",
    exclusions: "no announcer delivery, no theatrical exaggeration, no synthetic or cartoonish delivery"
  };

  const instruct = compileVoiceDesignInstruct(description);
  assert.match(instruct, /nineteen-year-old, masculine voice/i);
  assert.match(instruct, /vocal register: light baritone leaning toward tenor/i);
  assert.match(instruct, /timbre: rich natural chestnut warmth/i);
  assert.match(instruct, /performance style: intimate live-action dramatic performance/i);
  assert.match(instruct, /exclusions: no announcer delivery, no theatrical exaggeration/i);
  assert.equal(compileVoiceDesignInstruct(__voiceDesignUiInternals.defaultDraft().description), "");
});

test("audible-text guard catches production metadata without rejecting ordinary dialogue", () => {
  const guard = __voiceDesignUiInternals.FORBIDDEN_AUDIBLE_METADATA;
  for (const metadata of ["[Character: JESUS]", "[Style: restrained]", "[Voice ID: jesus-01]", "[pause=0.5]"]) {
    assert.equal(guard.test(metadata), true, `${metadata} should be rejected from audible text`);
  }
  assert.equal(
    guard.test("Father, I need to speak with you. I have chosen my road, and I mean to leave at sunrise."),
    false
  );

  const appliedGuards = visit(syntax, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    return node.expression.name.text === "test"
      && node.expression.expression.getText(syntax) === "FORBIDDEN_AUDIBLE_METADATA"
      && node.arguments[0]?.getText(syntax) === "draft.auditionText";
  });
  assert.equal(appliedGuards.length, 1, "the guard must inspect the audible audition field");
});

test("new drafts request three auditions and keep text separate from instruct in the API payload", () => {
  const draft = __voiceDesignUiInternals.defaultDraft();
  assert.equal(draft.auditionCount, 3);
  assert.equal(draft.seed, "");
  assert.equal(draft.settings.create48kCopy, true);

  const payloadDeclaration = visit(syntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "payload"
    && Boolean(node.initializer)
  ))[0];
  assert.ok(payloadDeclaration, "generation payload declaration should exist");
  const keys = new Set(propertyNames(payloadDeclaration.initializer));
  assert.deepEqual(
    [...keys].sort(),
    ["auditionCount", "auditionText", "characterId", "descriptionFields", "instruct", "language", "projectId", "seed", "settings", "voiceName"].sort()
  );
  assert.equal(keys.has("text"), false, "audible text must not be merged into a generic direction field");

  const generationRequest = callsNamed("requestJson").find((call) => (
    call.arguments[0]?.getText(syntax).includes("/sound/voice-design/auditions")
    && call.arguments[2]?.getText(syntax) === "payload"
  ));
  assert.ok(generationRequest, "generation should post the explicit Voice Design payload");
  assert.equal(generationRequest.arguments[1]?.getText(syntax), '"POST"');
});

test("audition cards expose the production actions and route them through project-scoped APIs", () => {
  const actionNames = new Set(
    callsNamed("auditionAction")
      .map((call) => call.arguments[1])
      .filter((argument) => argument && ts.isStringLiteral(argument))
      .map((argument) => argument.text)
  );
  for (const action of ["regenerate", "select", "save-to-library", "send-to-index-tts", "open-folder"]) {
    assert.ok(actionNames.has(action), `missing ${action} API action`);
  }

  const controlLabels = new Set(
    visit(syntax, ts.isJsxText)
      .map((node) => node.getText(syntax).replace(/\s+/g, " ").trim())
      .filter(Boolean)
  );
  for (const label of ["Regenerate", "Rename", "Delete", "Select voice", "Save to library", "Send to IndexTTS", "Open folder", "Cancel"]) {
    assert.ok(controlLabels.has(label), `missing ${label} control`);
  }

  const handoffCalls = callsNamed("onSendToIndexTts").filter((call) => call.arguments[0]?.getText(syntax) === "voiceId");
  assert.equal(handoffCalls.length, 1, "successful handoff should select the returned IndexTTS voice immediately");

  const actionRoute = visit(syntax, (node) => (
    ts.isTemplateExpression(node)
    && node.getText(syntax).includes("/sound/voice-design/auditions/")
    && node.getText(syntax).includes("encodeURIComponent(id)")
    && node.getText(syntax).includes("suffix")
  ));
  assert.equal(actionRoute.length, 1, "audition actions should stay project scoped and append their action suffix");
});

test("audition cards preserve session transcripts, 1-based labels, and the IndexTTS duration contract", () => {
  const [audition] = __voiceDesignUiInternals.collectAuditions({
    sessions: [{
      id: "session-1",
      auditionText: "This exact sentence should remain visible beneath every take.",
      auditions: [{ id: "audition-1", index: 1, durationSec: 10 }]
    }]
  });
  assert.equal(audition.auditionText, "This exact sentence should remain visible beneath every take.");
  assert.equal(__voiceDesignUiInternals.auditionName(audition), "Audition 1");

  const durationGuard = visit(syntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "indexTtsDurationEligible"
  ))[0];
  assert.ok(durationGuard?.initializer);
  assert.match(durationGuard.initializer.getText(syntax), /durationSec >= 7\.95/);
  assert.match(durationGuard.initializer.getText(syntax), /durationSec <= 15\.05/);

  const sendButton = visit(syntax, (node) => (
    ts.isJsxElement(node)
    && node.openingElement.tagName.getText(syntax) === "button"
    && node.children.some((child) => ts.isJsxText(child) && child.getText(syntax).trim() === "Send to IndexTTS")
  ))[0];
  assert.ok(sendButton, "IndexTTS handoff control should exist");
  assert.match(jsxAttribute(sendButton.openingElement, "disabled")?.initializer?.getText(syntax) || "", /!indexTtsDurationEligible/);
  assert.ok(jsxAttribute(sendButton.openingElement, "aria-describedby"), "an ineligible take should point assistive technology to the duration hint");

  const durationHint = visit(syntax, ts.isJsxText)
    .map((node) => node.getText(syntax).replace(/\s+/g, " ").trim())
    .find((label) => label.startsWith("IndexTTS requires an 8–15 second audition."));
  assert.ok(durationHint, "the UI should explain the 8–15 second IndexTTS reference requirement");
});

test("generating sessions remain cancellable while Qwen is producing audio", () => {
  assert.equal(__voiceDesignUiInternals.ACTIVE_JOB_STATUSES.has("generating"), true);

  const activeFilter = visit(syntax, (node) => (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "filter"
    && node.getText(syntax).includes("ACTIVE_JOB_STATUSES.has")
    && node.getText(syntax).includes("job?.status")
  ))[0];
  assert.ok(activeFilter, "session status should determine whether a Voice Design job remains active");

  const cancelControl = visit(syntax, (node) => (
    ts.isConditionalExpression(node)
    && node.condition.getText(syntax) === "ACTIVE_JOB_STATUSES.has(status)"
    && node.whenTrue.getText(syntax).includes("cancelJob")
  ));
  assert.equal(cancelControl.length, 1, "active statuses should keep the per-job Cancel control visible");
});

test("the engine header does not advertise lazy loading when pinned model files are unavailable", () => {
  const statusDeclaration = visit(syntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "engineModelLabel"
  ))[0];
  assert.ok(statusDeclaration?.initializer, "the model header should derive a readiness-aware label");
  const statusText = statusDeclaration.initializer.getText(syntax);
  assert.match(statusText, /engineReady/);
  assert.match(statusText, /Installed · model unavailable/);

  const loadControl = visit(syntax, (node) => (
    ts.isJsxElement(node)
    && node.openingElement.tagName.getText(syntax) === "button"
    && node.getText(syntax).includes('engineAction("load")')
    && node.getText(syntax).includes('"Load model"')
  ))[0];
  assert.ok(loadControl, "the lazy-load control should exist");
  assert.match(jsxAttribute(loadControl.openingElement, "disabled")?.initializer?.getText(syntax) || "", /!engineReady/);
});

test("project drafts are slug-bound before rendering or persistence", () => {
  assert.match(source, /premiere316\.voice-design:v1:/);
  for (const [label, tree] of [["Voice Design", syntax], ["Create Sound", shellSyntax]]) {
    const draftDeclaration = visit(tree, (node) => (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "draft"
    ))[0];
    assert.ok(draftDeclaration?.initializer && ts.isConditionalExpression(draftDeclaration.initializer), `${label} draft should be derived for the active slug`);
    assert.match(draftDeclaration.initializer.getText(tree), /draftState\.slug === slug/);

    const persistenceEffect = effectContaining(tree, "localStorage.setItem");
    assert.ok(persistenceEffect, `${label} should persist its draft`);
    assert.match(persistenceEffect.getText(tree), /draftState\.slug !== slug/);

    const slugResetEffect = effectContaining(tree, "setDraftState({ slug, draft: loadDraft(slug) })");
    assert.ok(slugResetEffect, `${label} should load a fresh project draft when the slug changes`);
  }

  const shellReset = effectContaining(shellSyntax, "setDraftState({ slug, draft: loadDraft(slug) })");
  assert.match(shellReset.getText(shellSyntax), /setSnapshot\(\{ sound: null, health: null \}\)/, "old project sound data should not remain visible during the handoff");
  assert.match(shellReset.getText(shellSyntax), /setReferenceFile\(null\)/, "a local clone reference must not cross project boundaries");

  const voiceReset = effectContaining(syntax, "setDraftState({ slug, draft: loadDraft(slug) })");
  assert.match(voiceReset.getText(syntax), /setPendingActions\(\{\}\)/, "pending controls from the prior project should be released");
  const mutationSlugGuards = visit(syntax, (node) => (
    ts.isBinaryExpression(node)
    && node.getText(syntax) === "slugRef.current !== requestSlug"
  ));
  assert.ok(mutationSlugGuards.length >= 5, "late project-scoped responses must not merge into the newly selected project");
});

test("hidden Voice Design panels pause media and suspend network polling", () => {
  const lifecycleEffect = effectContaining(syntax, 'querySelectorAll("audio")');
  assert.ok(lifecycleEffect, "Voice Design should own an active/inactive lifecycle effect");
  const effectText = lifecycleEffect.getText(syntax);
  assert.match(effectText, /if \(!active\)/);
  assert.match(effectText, /audio\.pause\(\)/);
  assert.match(effectText, /setInterval/);
  assert.match(effectText, /\[active, refreshWorkspace\]/, "visibility must participate in polling cleanup");

  const workspaceElement = visit(shellSyntax, (node) => (
    ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(shellSyntax) === "VoiceDesignWorkspace"
  ))[0];
  assert.ok(workspaceElement, "Create Sound should render Voice Design");
  assert.equal(jsxAttribute(workspaceElement, "active")?.initializer?.getText(shellSyntax), '{activeTab === "voice-design"}');
});

test("Create Sound uses live Qwen health, failure-propagating cancellation, and accessible tab focus", () => {
  const workspaceElement = visit(shellSyntax, (node) => (
    ts.isJsxSelfClosingElement(node)
    && node.tagName.getText(shellSyntax) === "VoiceDesignWorkspace"
  ))[0];
  assert.ok(workspaceElement);
  assert.equal(jsxAttribute(workspaceElement, "onEngineStatusChange")?.initializer?.getText(shellSyntax), "{setVoiceDesignCommandStatus}");
  assert.equal(jsxAttribute(workspaceElement, "onCancelJob")?.initializer?.getText(shellSyntax), "{cancelSoundJob}");

  const commandSummary = visit(shellSyntax, (node) => (
    ts.isVariableDeclaration(node)
    && ts.isIdentifier(node.name)
    && node.name.text === "commandSummary"
  ))[0];
  assert.ok(commandSummary?.initializer?.getText(shellSyntax).includes("...voiceDesignCommandStatus"), "top status should consume the live child health summary");

  const cancellation = functionNamed("cancelSoundJob", shellSyntax);
  assert.ok(cancellation, "Create Sound should expose a dedicated cancellation callback");
  const cancellationText = cancellation.getText(shellSyntax);
  assert.match(cancellationText, /await responseJson\(response\)/, "HTTP failures must reject the callback");
  assert.match(cancellationText, /await store\.refreshQueue\(\)/, "successful cancellation should refresh queue state");

  const tabButton = visit(shellSyntax, (node) => (
    ts.isJsxOpeningElement(node)
    && node.tagName.getText(shellSyntax) === "button"
    && jsxAttribute(node, "role")?.initializer?.getText(shellSyntax) === '"tab"'
  ))[0];
  assert.ok(tabButton, "Create Sound should render ARIA tabs");
  assert.equal(jsxAttribute(tabButton, "tabIndex")?.initializer?.getText(shellSyntax), "{activeTab === tab.id ? 0 : -1}");

  const keyHandler = functionNamed("handleTabKeyDown", shellSyntax);
  assert.ok(keyHandler);
  const keyHandlerText = keyHandler.getText(shellSyntax);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(keyHandlerText, new RegExp(`"${key}"`));
  assert.match(keyHandlerText, /selectTab\(SOUND_TABS\[nextIndex\]\.id, true\)/);

  const handoff = functionNamed("useDesignedVoice", shellSyntax);
  assert.match(handoff.getText(shellSyntax), /selectTab\("voice-clone", true\)/, "Qwen to IndexTTS handoff should move both selection and keyboard focus");
});
