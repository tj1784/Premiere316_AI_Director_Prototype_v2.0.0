import test from "node:test";
import assert from "node:assert/strict";
import type { Picture } from "./types.ts";
import { makePictureIntake } from "./picture-intake.ts";
import { makePictureScreenplay } from "./screenplay.ts";
import { createProductionBreakdown } from "../production/breakdown.ts";
import { writeGroundedAssetPrompts } from "./asset-prompt-pipeline.ts";
import { assetPromptContext, assertAssetDevelopmentReady, assertCharacterSheetPrompt, requireGroundedAssetPrompt } from "./asset-prompt-context.ts";
import { stableHash } from "../production/dependency-graph.ts";
import type { MoviePlanRuntime } from "./movie-plan-pipeline.ts";
import { makeProdigalSonPicture } from "./prodigal-son.ts";
import { seedVisualDevelopmentFromPicture } from "../visual-development.ts";
import { seedCinematographyFromPicture } from "../cinematography.ts";

const MODEL_PROMPT = 'Model-written character sheet collage on a plain grey background, with an upper row of full-body front, three-quarter, profile and rear views and a lower row of large front face close-up and profile close-up portraits of the same person.';

function fixture() {
  const fountain = 'EXT. RED SEA - NIGHT\n\nThe Egyptian soldier carries a torch. The pillar of fire illuminates Moses in his maroon and black robe.';
  const intake = { ...makePictureIntake(1), concept: 'Biblical-era ancient Egypt', sourcePassages: 'Exodus 14', suppliedSourceText: 'The wheels were stuck in mud.', fidelityRequirements: 'Bright pillar of fire at night; no modern clothing.' };
  const screenplay = { ...makePictureScreenplay(intake.workflow, null, 1), currentVersionId: 'v1', workingFountain: fountain };
  const production = createProductionBreakdown({ pictureId: 'p', versionId: 'v1', status: 'APPROVED', fountain, scenes: [{ id: 'SCENE-001', slugline: 'EXT. RED SEA - NIGHT' }], socialWorld: [] }, [{ id: 'req', name: 'Egyptian soldier', category: 'character', description: 'Egyptian soldier', sceneIds: ['SCENE-001'] }], 1);
  return { id: 'p', intake, screenplay, production, nativeFilm: { visualContinuity: 'Warm orange practical firelight and maroon wardrobe.' }, visualDevelopment: { boards: [{ id: 'look', title: 'Firelit crossing', intent: 'Warm fire reaches faces and linen; black robe panels remain readable.', palette: ['maroon', 'charcoal', 'amber'], motifs: ['light on linen'], status: 'DRAFT' }], characterBibles: [], wardrobeStates: [], locationBibles: [], propBibles: [], versions: [] }, cinematography: { manifestoVersions: [{ thesis: '35mm lens, readable warm firelight, soft shadow detail.' }], shotPlans: [{ sceneId: 'SCENE-001', lens: '35mm', lighting: 'Pillar of fire', framing: 'Medium full figure' }] } } as unknown as Picture;
}
function runtime(picture: Picture, quote = 'The Egyptian soldier carries a torch.'): MoviePlanRuntime {
  return { available: true, reason: '', servedModelId: 'local-qwen', generate: async (input) => {
    assert.equal(input.stepId, 'assetPrompts');
    const context = JSON.parse(input.prompt);
    assert.match(context.screenplay, /pillar of fire/);
    assert.match(context.cinematographyManifesto, /35mm/);
    assert.match(context.fidelity, /no modern clothing/);
    assert.match(context.output, /1024 TOKENS/);
    assert.match(input.system, /COHESION IS THE FIRST PRIORITY/);
    return { text: JSON.stringify({ assets: [{ assetId: picture.production!.assets[0].id, prompt: MODEL_PROMPT, sourceQuote: quote }] }) };
  } };
}
test('asset prompts use screenplay, cinematography and source requirements without rewriting the film', async () => {
  const p = fixture(); const next = await writeGroundedAssetPrompts(p, runtime(p), async () => 1100);
  assert.equal(next.screenplay, p.screenplay);
  assert.equal(next.cinematography, p.cinematography);
  const id = p.production!.assets[0].id;
  assert.equal(next.assetPromptSources![id].tokenCount, 1100);
  assert.equal(requireGroundedAssetPrompt(next, next.production!.assets[0]), MODEL_PROMPT);
});

test('saved production instructions reach the writer and changing them invalidates generated prompts', async () => {
  const p = fixture();
  p.intake.directorNotes = "Ancient Egyptian setting. Preserve the maroon and black costume.";
  const r = runtime(p); const generate = r.generate!;
  r.generate = async (input) => {
    assert.equal(JSON.parse(input.prompt).productionInstructions.directorNotes, p.intake.directorNotes);
    return generate(input);
  };
  const next = await writeGroundedAssetPrompts(p, r, async () => 1400);
  const asset = next.production!.assets[0];
  assert.equal(requireGroundedAssetPrompt(next, asset), MODEL_PROMPT);
  next.intake = { ...next.intake, directorNotes: "Updated approved costume instructions." };
  assert.throws(() => requireGroundedAssetPrompt(next, asset), /missing or stale/);
});
test('invented scene evidence is rejected', async () => {
  const p = fixture(); await assert.rejects(writeGroundedAssetPrompts(p, runtime(p, 'A modern festival.'), async () => 1100), /does not match/);
});
test('a bare label cannot pass the actual tokenizer minimum', async () => {
  const p = fixture(); let attempts = 0; const r = runtime(p); const generate = r.generate!;
  r.generate = async (input) => { attempts++; return generate(input); };
  await assert.rejects(writeGroundedAssetPrompts(p, r, async () => 3), /required 1024/);
  assert.equal(attempts, 3);
});
test('cinematography changes invalidate prompts; direct edits remain verbatim', async () => {
  const p = fixture(); let next = await writeGroundedAssetPrompts(p, runtime(p), async () => 1100);
  const asset = next.production!.assets[0];
  next = { ...next, assetImagePrompts: { [asset.id]: 'User-edited prompt kept verbatim.' } };
  assert.equal(requireGroundedAssetPrompt(next, asset), 'User-edited prompt kept verbatim.');
  next = structuredClone(next); next.cinematography!.manifestoVersions[0].thesis = 'Different lighting.';
  assert.throws(() => requireGroundedAssetPrompt(next, asset), /missing or stale/);
});
test('explicit prompt rewrite retains previous user edits in history', async () => {
  const p = fixture(); const id = p.production!.assets[0].id; p.assetImagePrompts = { [id]: 'Existing direct edit' };
  const next = await writeGroundedAssetPrompts(p, runtime(p), async () => 1100, true);
  assert.equal(next.assetPromptHistory![0].prompts[id], 'Existing direct edit');
  assert.equal(next.assetImagePrompts![id], MODEL_PROMPT);
});

test('forced regeneration replaces an already-current prompt and preserves its previous version', async () => {
  const p = fixture();
  const saved = await writeGroundedAssetPrompts(p, runtime(p), async () => 1100);
  const id = p.production!.assets[0].id;
  let calls = 0;
  const r = runtime(p); const original = r.generate!;
  r.generate = async (input) => {
    calls++;
    const result = await original(input);
    return { text: result.text.replace(MODEL_PROMPT, MODEL_PROMPT + ' A newly generated replacement.') };
  };
  const kept = await writeGroundedAssetPrompts(saved, r, async () => 1200, true);
  assert.equal(calls, 0);
  assert.equal(kept.assetImagePrompts![id], MODEL_PROMPT);
  const replaced = await writeGroundedAssetPrompts(saved, r, async () => 1200, true, undefined, undefined, undefined, true);
  assert.equal(calls, 1);
  assert.equal(replaced.assetImagePrompts![id], MODEL_PROMPT + ' A newly generated replacement.');
  assert.equal(replaced.assetPromptHistory!.at(-1)!.prompts[id], MODEL_PROMPT);
  assert.equal(saved.assetImagePrompts![id], MODEL_PROMPT);
});

test('resuming a partial queue preserves the current prompt and writes only the missing asset', async () => {
  const p = fixture();
  const initial = p.production!.assets[0];
  const other = { ...initial, id: initial.id + '-second', name: 'Second character' };
  p.production!.assets.push(other);
  const saved = await writeGroundedAssetPrompts(p, runtime(p), async () => 1500, false, undefined, undefined, initial.id);
  const first = saved.production!.assets[0];
  saved.assetImagePrompts![first.id] = MODEL_PROMPT + ' Saved user adjustment.';
  const seen: string[] = [];
  const r = runtime(saved); const generate = r.generate!;
  r.generate = async (input) => {
    seen.push(input.assetIds![0]);
    const response = await generate(input);
    const body = JSON.parse(response.text);
    body.assets[0].assetId = input.assetIds![0];
    return { text: JSON.stringify(body) };
  };
  const resumed = await writeGroundedAssetPrompts(saved, r, async () => 1500, true);
  assert.deepEqual(seen, [other.id]);
  assert.equal(resumed.assetImagePrompts![first.id], MODEL_PROMPT + ' Saved user adjustment.');
  assert.ok(resumed.assetPromptSources![other.id]);
});

test('imported asset context retains exact scene identities, states, reference packages and sourced uncertainty', () => {
  const p = makeProdigalSonPicture();
  const child = p.production!.assets.find((asset) => p.importedPackage!.sourceAssets.find((item) => item.id === asset.id)?.parent)!;
  const { context } = assetPromptContext(p, child);
  assert.deepEqual(context.scenes.map((scene) => scene.id), child.requiredSceneIds);
  assert.ok(context.scenes.every((scene) => /^PS-S\d+$/.test(scene.id)));
  assert.ok(context.asset.importedSpecification!.reference);
  assert.equal(context.asset.sceneUses.length, p.importedPackage!.sceneAssetLinks.filter((item) => item.asset_id === child.id).length);
  assert.ok(context.research!.sources.length > 0);
  assert.ok(context.canonicalParents.length > 0);
  assert.ok(context.canonicalParents.every((parent) => parent.approvedMedia === null));
  assert.equal(context.asset.approvedMedia, null, 'Imported specifications must not imply generated media');
  assert.ok(context.scenes.every((scene) => scene.durationSeconds! > 0));
});

test('asset prompt writing waits for actual visual and camera development, without demanding canonical media approval', async () => {
  const p = makeProdigalSonPicture();
  let calls = 0;
  const model = { available: true, servedModelId: 'test', reason: '', generate: async () => { calls++; return { text: '{}' }; } };
  await assert.rejects(writeGroundedAssetPrompts(p, model, async () => 1500), /Complete visual development/);
  p.visualDevelopment = seedVisualDevelopmentFromPicture(p, 1);
  p.cinematography = seedCinematographyFromPicture(p, 1);
  assert.throws(() => assertAssetDevelopmentReady(p), /Complete visual development/);
  const developed = fixture();
  p.visualDevelopment = developed.visualDevelopment;
  assert.throws(() => assertAssetDevelopmentReady(p), /Develop cinematography/);
  p.cinematography = developed.cinematography;
  assert.doesNotThrow(() => assertAssetDevelopmentReady(p));
  assert.equal(calls, 0);
  assert.ok(p.production!.assets.every((asset) => asset.approvedIterationId === null));
});

test('largest imported character request keeps all scene evidence and related assets inside a bounded text envelope', async () => {
  const p = makeProdigalSonPicture();
  const developed = fixture();
  p.visualDevelopment = developed.visualDevelopment;
  p.cinematography = developed.cinematography;
  const asset = p.production!.assets.find((item) => item.id === 'PS-CHR-YOUNGER')!;
  const full = assetPromptContext(p, asset).context;
  let checked = false;
  const model: MoviePlanRuntime = { available: true, servedModelId: 'test', reason: '', generate: async (input) => {
    const payload = JSON.parse(input.prompt);
    assert.ok(input.system.length + input.prompt.length < 100_000, 'Character envelope leaves room for a full image prompt in the selected 32K context; exact tokens are model-specific');
    assert.deepEqual(payload.sceneIndex.map((scene: { id: string }) => scene.id), full.scenes.map((scene) => scene.id));
    assert.ok(payload.sceneIndex.every((scene: Record<string, unknown>) => !('text' in scene)), 'Do not duplicate the screenplay in every scene-index entry');
    assert.deepEqual(payload.relatedAssets.map((row: unknown[]) => row[0]), full.relatedAssets.map((item) => item.id));
    assert.deepEqual(payload.targetAsset.specification, asset.canonicalSpec);
    assert.deepEqual(payload.targetAsset.sceneUses, full.asset.sceneUses);
    assert.ok(full.scenes.every((scene) => payload.screenplay.includes(scene.text.trimEnd())));
    checked = true;
    throw new Error('Request measured; no generation');
  } };
  await assert.rejects(writeGroundedAssetPrompts(p, model, async () => 1500, false, undefined, undefined, asset.id), /Request measured/);
  assert.equal(checked, true);
});

test('a partially broken scene link cannot silently omit required continuity context', () => {
  const p = fixture();
  const asset = p.production!.assets[0];
  asset.requiredSceneIds.push('SCENE-999');
  assert.throws(() => assetPromptContext(p, asset), /linked screenplay scenes are missing \(SCENE-999\)/);
});

test('related asset changes invalidate prompts, while unrelated scenes stay outside the target context', async () => {
  const p = fixture();
  const parent = { ...structuredClone(p.production!.assets[0]), id: 'parent', name: 'Canonical parent', requiredSceneIds: ['ELSEWHERE'] };
  const unrelated = { ...structuredClone(parent), id: 'unrelated', name: 'Unrelated scene asset' };
  p.production!.assets.push(parent, unrelated);
  p.production!.dependencies.push({ fromType: 'asset', fromId: parent.id, toType: 'asset', toId: p.production!.assets[0].id });
  const saved = await writeGroundedAssetPrompts(p, runtime(p), async () => 1500, false, undefined, undefined, p.production!.assets[0].id);
  const asset = saved.production!.assets[0];
  const context = assetPromptContext(saved, asset).context;
  assert.deepEqual(context.canonicalParents.map((item) => item.id), ['parent']);
  assert.ok(!context.relatedAssets.some((item) => item.id === 'unrelated'));
  saved.production!.assets.find((item) => item.id === 'unrelated')!.canonicalSpec.visualDescription = 'Unrelated change';
  assert.equal(requireGroundedAssetPrompt(saved, asset), MODEL_PROMPT);
  saved.production!.assets.find((item) => item.id === 'parent')!.canonicalSpec.visualDescription = 'Changed canonical construction';
  assert.throws(() => requireGroundedAssetPrompt(saved, asset), /missing or stale/);
});

test('model-written paragraphs are joined verbatim and a short retry receives its previous draft', async () => {
  const p = fixture(); const id = p.production!.assets[0].id;
  const paragraphs = Array.from({ length: 10 }, (_, index) => index === 0 ? MODEL_PROMPT : `Model-written visual paragraph ${index + 1}.`);
  let attempts = 0;
  const r: MoviePlanRuntime = { available: true, reason: '', servedModelId: 'local-qwen', generate: async (input) => {
    const payload = JSON.parse(input.prompt);
    if (attempts++) assert.equal(payload.previousDraft, paragraphs.join('\n\n'));
    return { text: JSON.stringify({ assets: [{ assetId: id, promptParagraphs: paragraphs, sourceQuote: 'The Egyptian soldier carries a torch.' }] }) };
  } };
  let counts = 0;
  const next = await writeGroundedAssetPrompts(p, r, async () => counts++ ? 1400 : 700);
  assert.equal(attempts, 2);
  assert.equal(next.assetImagePrompts![id], paragraphs.join('\n\n'));
});

test('malformed model output retries the same asset and then saves its valid response', async () => {
  const p = fixture(); let attempts = 0;
  const r = runtime(p); const valid = r.generate!;
  r.generate = async (input) => attempts++ === 0 ? { text: '{ invalid model output' } : valid(input);
  const messages: string[] = [];
  const next = await writeGroundedAssetPrompts(p, r, async () => 1500, false, undefined, (message) => messages.push(message));
  assert.equal(attempts, 2);
  assert.equal(Object.keys(next.assetPromptSources!).length, 1);
  assert.ok(messages.some((message) => /Retrying this asset/.test(message)));
});

test('character context adds the versioned grey collage contract without changing other asset hashes', () => {
  const p = fixture();
  const character = p.production!.assets[0];
  const characterContext = assetPromptContext(p, character);
  assert.equal(characterContext.context.asset.imageContract?.kind, 'character-identity-sheet');
  assert.match(characterContext.context.asset.imageContract!.background, /plain neutral grey/i);
  const legacyCharacter = structuredClone(characterContext.context);
  delete legacyCharacter.asset.imageContract;
  assert.notEqual(characterContext.hash, stableHash(legacyCharacter));
  const prop = { ...character, category: 'prop' as const };
  const propContext = assetPromptContext(p, prop);
  assert.equal(Object.hasOwn(propContext.context.asset, 'imageContract'), false);
  const unchanged = structuredClone(propContext.context);
  delete unchanged.asset.imageContract;
  assert.equal(propContext.hash, stableHash(unchanged));
});

test('character writer receives identity-sheet and costume-only reference instructions', async () => {
  const p = fixture();
  const r = runtime(p); const generate = r.generate!;
  r.generate = async (input) => {
    const payload = JSON.parse(input.prompt);
    assert.equal(payload.targetAsset.id, p.production!.assets[0].id);
    assert.match(payload.targetIdentityRule, /Never transfer another character's age/);
    assert.ok(payload.finalTargetReminder.includes(p.production!.assets[0].name));
    assert.match(input.system, /CHARACTER ASSET OVERRIDE/);
    assert.match(input.system, /SAME individual/);
    assert.match(input.system, /Costume references guide clothing only/);
    assert.match(payload.assets[0].imageContract.layout, /upper row.*FIVE/);
    assert.match(payload.characterSheetParagraphCoverage, /plain neutral grey/);
    assert.match(payload.characterSheetParagraphCoverage, /soft even facial lighting/);
    return generate(input);
  };
  await writeGroundedAssetPrompts(p, r, async () => 1500);
  assert.throws(() => assertCharacterSheetPrompt('A distant full-body hero standing before fire.'), /Character-sheet prompt omitted/);
});

test('character sheet validation accepts model typography without weakening required views', () => {
  assert.doesNotThrow(() => assertCharacterSheetPrompt('Identity-sheet collage on plain grey background, lower row of large front face close\u2011up and profile close\u2011up, upper row of full\u2011body front and rear view.'));
  assert.doesNotThrow(() => assertCharacterSheetPrompt('Character turnaround sheet on grey, top row of full-body front, profile and back-facing poses, bottom row of face close-ups.'));
  assert.throws(() => assertCharacterSheetPrompt('Identity-sheet collage on grey background, profile and rear view.'), /large face close-up, full-body view/);
});

test('single-asset character rewrite preserves every other prompt and source', async () => {
  const p = fixture();
  const target = p.production!.assets[0];
  const other = { ...target, id: `${target.id}-other`, name: 'Other character' };
  p.production!.assets.push(other);
  const source = { prompt: 'Untouched model prompt', tokenCount: 1600, sourceQuote: 'The Egyptian soldier carries a torch.', contextHash: 'previous-contract', sceneIds: ['SCENE-001'], modelId: 'local-qwen', generatedAt: 5 };
  p.assetImagePrompts = { [target.id]: 'Previous target prompt', [other.id]: 'Untouched direct edit' };
  p.assetPromptSources = { [target.id]: { ...source, contextHash: assetPromptContext(p, target).hash }, [other.id]: { ...source } };
  let calls = 0;
  const r = runtime(p); const generate = r.generate!;
  r.generate = async (input) => {
    calls++;
    assert.deepEqual(input.assetIds, [target.id]);
    assert.equal(JSON.parse(input.prompt).relatedAssets.length, 2);
    assert.equal(JSON.parse(input.prompt).assets[0].currentUserPrompt, undefined, 'Replacement must not feed the rejected old prompt back to the writer');
    return generate(input);
  };
  const next = await writeGroundedAssetPrompts(p, r, async () => 1600, true, undefined, undefined, target.id);
  assert.equal(calls, 1);
  assert.equal(next.assetImagePrompts![target.id], MODEL_PROMPT);
  assert.equal(next.assetImagePrompts![other.id], 'Untouched direct edit');
  assert.deepEqual(next.assetPromptSources![other.id], p.assetPromptSources[other.id]);
  assert.equal(next.assetPromptHistory!.at(-1)!.prompts[target.id], 'Previous target prompt');
});

test('KREA 2 uses its own text-only contract, tokenizer identity and prompt instructions', async () => {
  const p = fixture();
  const fluxHash = assetPromptContext(p, p.production!.assets[0]).hash;
  p.selectedEngine = { image: 'krea-2' } as Picture['selectedEngine'];
  assert.notEqual(assetPromptContext(p, p.production!.assets[0]).hash, fluxHash);
  const r = runtime(p); const generate = r.generate!;
  r.generate = async (input) => {
    const payload = JSON.parse(input.prompt);
    assert.match(payload.output, /KREA 2 RAW natural-language text-to-image/);
    assert.doesNotMatch(payload.output, /FLUX/);
    assert.equal(payload.rendererContract.input, 'text-only');
    assert.match(input.system, /does not directly condition on attached images/);
    return generate(input);
  };
  const messages: string[] = [];
  const result = await writeGroundedAssetPrompts(p, r, async () => 1500, true, undefined, (message) => messages.push(message));
  const source = result.assetPromptSources![p.production!.assets[0].id];
  assert.equal(source.imageEngineId, 'krea-2');
  assert.equal(source.tokenizerModel, 'Qwen/Qwen3-VL-4B-Instruct');
  assert.ok(messages.some((message) => /1500 KREA 2 RAW tokens/.test(message)));
  assert.ok(messages.every((message) => !/FLUX/.test(message)));
});
