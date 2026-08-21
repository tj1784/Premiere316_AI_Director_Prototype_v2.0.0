function array(value) {
  return Array.isArray(value) ? value : [];
}

export function readableCharacterText(value) {
  return String(value || "")
    .replace(/\u00e2(?:\u0080|\u20ac)(?:\u0098|\u0099|\u2018|\u2019)/g, "'")
    .replace(/\u00e2(?:\u0080|\u20ac)(?:\u0093|\u0094|\u201c|\u201d)/g, " - ")
    .replace(/[\u2012\u2013\u2014\u2015\u2212]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export function characterBundleKey(value) {
  return readableCharacterText(value)
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/^(?:character|voice|wardrobe|ward)[-_ ]+/i, "")
    .replace(/\b(?:voice design|wardrobe|appearance|primary appearance|close[- ]?up|action pose)\b.*$/i, "")
    .replace(/\d+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("-");
}

export function activeAssetVersion(asset) {
  if (asset?.activeVersionCurrent === false) return null;
  return array(asset?.versions).find((version) => Number(version?.v) === Number(asset?.activeVersion)) || null;
}

export function activeAssetFile(asset) {
  const version = activeAssetVersion(asset);
  return version?.file || array(version?.files)[0] || null;
}

function bundleLabel(asset) {
  return readableCharacterText(asset?.name || asset?.id || "Character").split(/\s+-\s+/, 1)[0].trim();
}

function normalizedIdentifier(value) {
  return readableCharacterText(value)
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function withoutAssetPrefix(value) {
  return normalizedIdentifier(value).replace(/^(?:character|char|voice|wardrobe|ward)-+/, "");
}

function characterIdAlias(asset) {
  let key = withoutAssetPrefix(asset?.id || asset?.sourceAssetId);
  const variant = normalizedIdentifier(asset?.variant);
  for (const suffix of [variant, "primary-appearance", "appearance", "close-up", "action-pose", "identity-ingredients", "production-reference"].filter(Boolean)) {
    if (key === suffix) return "";
    if (key.endsWith(`-${suffix}`)) {
      key = key.slice(0, -(suffix.length + 1));
      break;
    }
  }
  return key;
}

function relationValues(asset) {
  const direct = [
    asset?.characterId,
    asset?.characterAssetId,
    asset?.linkedCharacterId,
    asset?.ownerAssetId,
    asset?.subjectAssetId,
    asset?.parentAssetId,
    asset?.targetCharacterId
  ];
  return [...direct, ...array(asset?.characterIds), ...array(asset?.dependencies)]
    .map((value) => typeof value === "object" ? value?.assetId || value?.id : value)
    .filter(Boolean)
    .map(String);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function prefixMatch(candidate, alias) {
  return Boolean(candidate && alias && (candidate === alias || candidate.startsWith(`${alias}-`)));
}

function bestGroupMatch(groups, aliasesByKey, candidates) {
  const scores = new Map();
  for (const candidate of candidates) {
    if (!candidate?.value) continue;
    const normalized = withoutAssetPrefix(candidate.value);
    if (!normalized) continue;
    for (const [key, group] of groups) {
      for (const alias of aliasesByKey.get(key) || []) {
        if (!prefixMatch(normalized, alias)) continue;
        const specificity = alias.split("-").length * 10 + alias.length / 100;
        scores.set(group, Math.max(scores.get(group) || 0, candidate.weight + specificity));
      }
    }
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

export function sourceImportState(source) {
  const existingVersionNumber = Number(source?.existingVersion || 0);
  const sha256 = String(source?.sha256 || source?.sourceHash || "").trim().toLowerCase();
  const existingAssetId = String(source?.existingAssetId || "").trim() || null;
  return {
    alreadyImported: source?.alreadyImported === true || Boolean(existingAssetId && existingVersionNumber > 0),
    suggested: source?.suggested !== false,
    existingAssetId,
    existingAssetName: readableCharacterText(source?.existingAssetName || ""),
    existingVersion: existingVersionNumber > 0 ? existingVersionNumber : null,
    sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null
  };
}

export function buildCharacterBundles(assets = [], sources = []) {
  const groups = new Map();
  const aliasesByKey = new Map();
  const ownerByAssetId = new Map();
  const characters = array(assets).filter((asset) => asset?.category === "character");
  for (const asset of characters) {
    const key = characterBundleKey(asset.name || asset.id);
    if (!key) continue;
    const current = groups.get(key) || {
      key,
      name: bundleLabel(asset),
      characterAssets: [],
      wardrobeAssets: [],
      voiceAssets: [],
      recordings: []
    };
    current.characterAssets.push(asset);
    groups.set(key, current);
    const aliases = aliasesByKey.get(key) || new Set();
    for (const alias of [key, characterIdAlias(asset), characterBundleKey(asset?.characterKey)]) {
      if (alias) aliases.add(alias);
    }
    aliasesByKey.set(key, aliases);
    ownerByAssetId.set(String(asset.id), current);
  }

  for (const asset of array(assets)) {
    if (!asset || !["wardrobe", "voice"].includes(asset.category)) continue;
    const relations = relationValues(asset);
    const explicitGroups = unique(relations.map((id) => ownerByAssetId.get(id))).filter(Boolean);
    const group = explicitGroups.length === 1
      ? explicitGroups[0]
      : explicitGroups.length > 1
        ? null
        : bestGroupMatch(groups, aliasesByKey, [
          ...relations.map((value) => ({ value, weight: 900 })),
          { value: asset.id, weight: 600 },
          { value: asset.sourceAssetId, weight: 590 },
          { value: asset.characterKey, weight: 550 },
          { value: String(asset.name || "").replace(/\bwardrobe\b/ig, ""), weight: 500 }
        ]);
    if (!group) continue;
    if (asset.category === "wardrobe") group.wardrobeAssets.push(asset);
    else group.voiceAssets.push(asset);
    ownerByAssetId.set(String(asset.id), group);
  }
  for (const source of array(sources)) {
    const importState = sourceImportState(source);
    const exactOwner = importState.existingAssetId ? ownerByAssetId.get(importState.existingAssetId) : null;
    const group = exactOwner || (importState.suggested || importState.alreadyImported ? bestGroupMatch(groups, aliasesByKey, [
      { value: source?.characterKey, weight: 700 },
      { value: source?.fileName || source?.name, weight: 500 }
    ]) : null);
    if (group) group.recordings.push(source);
  }

  const versionSort = (left, right) => Number(Boolean(activeAssetFile(right))) - Number(Boolean(activeAssetFile(left)))
    || String(left.variant || left.name || "").localeCompare(String(right.variant || right.name || ""));
  for (const group of groups.values()) {
    group.characterAssets.sort(versionSort);
    group.wardrobeAssets.sort(versionSort);
    group.voiceAssets.sort(versionSort);
    group.recordings.sort((left, right) => String(right.modifiedAt || "").localeCompare(String(left.modifiedAt || "")) || String(left.fileName).localeCompare(String(right.fileName)));
    group.primaryAsset = group.characterAssets.find((asset) => /primary|appearance/i.test(String(asset.variant || "")) && activeAssetFile(asset))
      || group.characterAssets.find(activeAssetFile)
      || group.characterAssets[0];
    group.complete = Boolean(group.characterAssets.some(activeAssetFile) && group.wardrobeAssets.some(activeAssetFile) && group.voiceAssets.some(activeAssetFile));
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}
