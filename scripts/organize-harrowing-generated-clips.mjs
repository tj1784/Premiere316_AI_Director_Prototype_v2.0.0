import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadStoryboard, saveStoryboard } from "../server/storyboard.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const slug = "harrowing_of_hell";
const projectRoot = path.join(repoRoot, "projects", slug);
const clipsRoot = path.join(projectRoot, "media", "clips");
const comfyVideoRoot = path.join(repoRoot, "BlokeyUI", "ComfyUI", "output", "video");
const chapters = ["H01", "H02", "H03"];
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(projectRoot, "production", "backups", `clips-by-chapter.${runStamp}`);

if (path.resolve(projectRoot) !== path.resolve(repoRoot, "projects", "harrowing_of_hell")) {
  throw new Error(`Refusing unexpected project root: ${projectRoot}`);
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function chapterizeText(value) {
  if (typeof value !== "string") return value;
  return value.replace(/media[\\/]clips[\\/](H0[123])-/g, (_match, chapter) => `media/clips/${chapter}/${chapter}-`);
}

function chapterizeJson(value) {
  if (typeof value === "string") return chapterizeText(value);
  if (Array.isArray(value)) return value.map(chapterizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [chapterizeText(key), chapterizeJson(child)]));
}

function nextVersion(directory, clipId, segmentId) {
  const prefix = `${clipId}_${segmentId}_director_v`.toLowerCase();
  let max = 0;
  for (const name of fs.readdirSync(directory)) {
    if (!name.toLowerCase().startsWith(prefix) || !/\.mp4$/i.test(name) || /-audio/i.test(name)) continue;
    max = Math.max(max, Number(name.match(/_director_v(\d+)\.mp4$/i)?.[1]) || 0);
  }
  return max + 1;
}

function findSameTake(directory, clipId, segmentId, bytes, sha256) {
  const prefix = `${clipId}_${segmentId}_director_v`.toLowerCase();
  for (const name of fs.readdirSync(directory)) {
    if (!name.toLowerCase().startsWith(prefix) || !/\.mp4$/i.test(name) || /-audio/i.test(name)) continue;
    const candidate = path.join(directory, name);
    if (fs.statSync(candidate).size === bytes && sha256File(candidate) === sha256) return name;
  }
  return null;
}

function publishCopy(source, destination, expectedBytes, expectedSha256) {
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    if (fs.statSync(temporary).size !== expectedBytes || sha256File(temporary) !== expectedSha256) {
      throw new Error(`Copied bytes failed verification: ${path.basename(source)}`);
    }
    fs.linkSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function takeReferencesFile(take, outName) {
  if (!take || typeof take !== "object") return false;
  return take.outputFile === outName
    || String(take.file || "").replace(/\\/g, "/").endsWith(`/${outName}`)
    || (Array.isArray(take.files) && take.files.includes(outName));
}

function addTake(storyboard, item, outName) {
  const segment = storyboard.segments?.[item.segmentId];
  if (!segment) throw new Error(`Missing storyboard segment ${item.segmentId}`);
  const version = Number(outName.match(/_director_v(\d+)\.mp4$/i)?.[1]);
  if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid director version in ${outName}`);
  const relativeFile = `media/clips/H01/${outName}`;
  segment.generatedVersions = Array.isArray(segment.generatedVersions) ? segment.generatedVersions : [];
  let record = segment.generatedVersions.find((take) => takeReferencesFile(take, outName));
  if (!record) {
    record = {
      v: version,
      id: `take-v${version}`,
      files: [outName],
      file: relativeFile,
      outputFile: outName,
      previewFile: relativeFile,
      mediaType: "video",
      source: "comfy-8188-legacy-output",
      workflowId: "LTX_2.5_Harrowing_AAA",
      segmentId: item.segmentId,
      segmentIndex: item.segmentIndex,
      promptId: item.promptId,
      sourceOutput: `video/${item.sourceName}`,
      durationSec: item.durationSec,
      bytes: item.bytes,
      sha256: item.sha256,
      createdAt: new Date().toISOString()
    };
    segment.generatedVersions.push(record);
  }
  if (!segment.activeTakeLocked) {
    segment.activeGeneratedVersion = version;
    segment.activeTakeId = record.id;
    segment.activeTakeFile = relativeFile;
    segment.status = "ready";
  }
  const plan = storyboard.videoPlans?.[segment.videoPlanId];
  const timelineSegment = plan?.timelineData?.segments?.find((entry) => entry?.id === item.segmentId);
  if (timelineSegment) {
    timelineSegment.generatedTakes = Array.isArray(timelineSegment.generatedTakes) ? timelineSegment.generatedTakes : [];
    if (!timelineSegment.generatedTakes.some((take) => takeReferencesFile(take, outName))) {
      timelineSegment.generatedTakes.push({ ...record });
    }
    if (!segment.activeTakeLocked) {
      timelineSegment.activeTakeId = record.id;
      timelineSegment.activeGeneratedVersion = version;
      timelineSegment.activeTakeFile = relativeFile;
    }
  }
}

const c01Hashes = [
  "527bc0ec538108413db91fc0acb48ac9c02ef572c7b292e47649a5ea4ea41745",
  "67d842ca5828b52a8c622bb0198b88b78c3e95088afffa0729c05f1ca0420215",
  "52a2b68c0cf7c1d8a7d67c8050a68f01e1872fe14d9fea3ebee97813be56362f",
  "03863bf3cceac60311ad500c4865d12556ebc2e7ff577d15f590645222480d5e",
  "3bf949e42ab5519e77e7e0cfa28ed41aea66323d526c672755efae3d3de208fa",
  "d0f9ab1ebaa96aa179ea0b86ec6765a090dd76d9c5e6fa3ee2c3232ce151edee",
  "1175ede23e3c7f74c17fbc72b9f0ea31f77c326d40f879c5676779f48be7289f",
  "fb7c8dccf626bb05b1b1492e29993a04e836ee5027f68933e77efa4f616891a0",
  "b9214eb4b961871d34b1d4388558b08b95fd473f239ea6fec6b95f435d9da31b",
  "39f23ae90e883e79de9f37408978f6407f9f7234489ecd371d9cdd4056241c8a",
  "d30b4614007a858d7cf7ff9c81b8ab120adabf53e93a1c15005f136c81640973",
  "44c0eba38fb6f3b6b7b162e703a282e2bbce1ca6ff4b442086b0153991745379",
  "358f0c78705a46dc546b48c13d4ade2e7279d09bb247534e6e85f9e8c978b9ca",
  "7aebc166947f17e3dbad138ff605a3d06789520de8252555359437a61594a21a",
  "6970f7c0d687dd0e7a755a881834226bb607a9957df05b5720212f6a0a5bed7b",
  "23ef80f442e3043af11fd8603cd27faed940bbc2fe245cb506dd7fcb047b1122",
  "2d16b759ae150a89845b3e94639fb0bb51e3422ef1b70b218fdf5a917d0454d3",
  "054b45ffbc7041eafeef8d4214d17d22f6bb7be7a2056c2873c31a9d03580320"
];
const c01Bytes = [6485382, 4763773, 4957290, 6102863, 5688495, 5635513, 5292834, 3627680, 3070124, 4753685, 4252352, 3643142, 6849790, 6312335, 9310825, 7049771, 7079097, 7839830];
const c01PromptIds = [
  "7b969919-e0e5-4952-be3e-655f27de3d97", "282fe097-4b08-4d67-80b8-a0b487f2f484",
  "7a60555b-e67b-40b8-983c-7e94d6673923", "b8a50310-e8de-41a6-a5e8-ae38806e6d47",
  "f30e8f8c-f213-4f29-9d3f-2dda3d291ffc", "9ecdb097-014c-4cdd-b936-fd20ddd5432c",
  "e483eb11-c392-4b51-b374-e57440504472", "c9c1a8e5-7b1a-44f4-9623-5acc8326da4f",
  "378eb57c-50d9-4492-8472-7d2cc4e41e94", "d4d98987-5662-4e39-abc3-2354846d4b2e",
  "6952cf1f-0960-4ac5-b814-803d0c6a36ed", "7b521125-8cac-46bb-8e42-b4ecae601a02",
  "63961555-e8ff-40f4-b0ee-fe53221fd669", "5a8ec9b5-f4e0-450a-82ff-a58485514bfb",
  "87d5074d-324e-408d-a836-a66a69dacecd", "faa71501-8d97-401d-847d-7b4ea0713388",
  "20c3e0c7-0c18-454a-ad30-51feab55df6e", "d4a11703-510f-4e19-990f-301da867ba9a"
];

const imports = Array.from({ length: 18 }, (_unused, index) => ({
  sourceNumber: 16 + index,
  promptNumber: 18 + index,
  promptId: c01PromptIds[index],
  clipId: "H01-S01-C01",
  segmentId: `segment-h01-s01-c01-${String(index + 1).padStart(2, "0")}`,
  segmentIndex: index + 1,
  durationSec: 13.041667,
  bytes: c01Bytes[index],
  sha256: c01Hashes[index]
}));

imports.push(...[
  [34, 37, "2a4c0891-7e65-4c6e-84ca-cb644cd6c453", "H01-S01-C02", 1, 5.041667, 1868674, "20cabd9d7a28f4b2f2587a3f85f62f3a0d22ff422fed70036e69708c37b898e7"],
  [35, 38, "cb31bbbe-e1e2-485a-9ae5-5d6075cf7b76", "H01-S01-C02", 2, 4.041667, 1292343, "90103a149b0c2eed411207628e3b08418f518ce039ddbd649077da4563a46e74"],
  [36, 39, "00227797-c3da-493a-96ee-49dbc4fcef40", "H01-S01-C02", 3, 5.041667, 2274906, "7c437a4057f0b2a71223f4ae444c64428603ab6d1f446f2993b38d2213b70733"],
  [37, 40, "5252cda5-9989-4157-84c4-a46359e8ddf2", "H01-S02-C01", 1, 6.041667, 2819560, "03d6d94783865dfcfd87c65896a3e7335cca055448f0604b0086cdd38eb60cbb"],
  [38, 41, "d942a6fd-b723-42ec-b82d-21dbe600e3c5", "H01-S02-C01", 2, 6.041667, 3225698, "05c49d9984e1d1acde143123349492389b12a10cfaf79eff945aa1449649f72f"],
  [39, 42, "7241837f-9f28-438e-b4b3-c7b17ce094f1", "H01-S02-C01", 3, 6.041667, 2979033, "71f117aa19657380a271946a663b912840de5e35b02c08523a6d845187970ea3"],
  [40, 43, "47e48a0a-ff16-4550-bb84-e8794100f74e", "H01-S02-C02", 1, 5.041667, 3007914, "8e2f0c5cdac52ef0ec0e9d1148c7ffbf948914adc4be39dc4e8e2db25e56adfe"],
  [41, 44, "f3700afd-bec3-4b06-9bda-488e632c12ad", "H01-S02-C02", 2, 4.041667, 1982879, "cb0abb21ca2298d4f659af14c7825938831a9b88c741a8f2c0d03f9d156b89dc"],
  [42, 45, "6be98957-6345-44aa-b90e-25c235dfc866", "H01-S02-C02", 3, 5.041667, 2270645, "5b0aae121492568969954a2a18fc5e7227c54aebcdfd2105901d1b9bde63d67c"]
].map(([sourceNumber, promptNumber, promptId, clipId, segmentIndex, durationSec, bytes, sha256]) => ({
  sourceNumber, promptNumber, promptId, clipId, segmentIndex, durationSec, bytes, sha256,
  segmentId: `segment-${clipId.toLowerCase()}-${String(segmentIndex).padStart(2, "0")}`
})));

for (const item of imports) {
  item.sourceName = `LTX-2.5_i2v_${String(item.sourceNumber).padStart(5, "0")}_.mp4`;
  item.source = path.join(comfyVideoRoot, item.sourceName);
  if (!fs.existsSync(item.source)) throw new Error(`Missing source ${item.source}`);
  const stat = fs.statSync(item.source);
  if (stat.size !== item.bytes) throw new Error(`Source size changed for ${item.sourceName}: expected ${item.bytes}, found ${stat.size}`);
  if (sha256File(item.source) !== item.sha256) throw new Error(`Source hash changed for ${item.sourceName}`);
}

fs.mkdirSync(backupRoot, { recursive: false });
const storyboardFile = path.join(projectRoot, "production", "storyboard.json");
const ledgerFile = path.join(projectRoot, "production", "comfy-output-ingest.json");
const cacheFile = path.join(projectRoot, "production", "edit-media-cache.json");
const workspaceFile = path.join(repoRoot, "director-webapp", "state", "workspace.local.json");
for (const file of [storyboardFile, ledgerFile, cacheFile, workspaceFile]) {
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(backupRoot, path.basename(file)));
}

fs.mkdirSync(clipsRoot, { recursive: true });
for (const chapter of chapters) fs.mkdirSync(path.join(clipsRoot, chapter), { recursive: true });
const movePlan = fs.readdirSync(clipsRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^(H01|H02|H03)-/i.test(entry.name))
  .map((entry) => {
    const chapter = entry.name.slice(0, 3).toUpperCase();
    const source = path.join(clipsRoot, entry.name);
    const destination = path.join(clipsRoot, chapter, entry.name);
    if (fs.existsSync(destination)) throw new Error(`Chapter destination already exists: ${destination}`);
    if (!destination.startsWith(path.join(clipsRoot, chapter) + path.sep)) throw new Error(`Unsafe move target: ${destination}`);
    return { source, destination, chapter };
  });

for (const move of movePlan) fs.renameSync(move.source, move.destination);

let storyboard = chapterizeJson(loadStoryboard(slug));
const imported = [];
for (const item of imports) {
  const directory = path.join(clipsRoot, "H01");
  let outName = findSameTake(directory, item.clipId, item.segmentId, item.bytes, item.sha256);
  let copied = false;
  if (!outName) {
    const version = nextVersion(directory, item.clipId, item.segmentId);
    outName = `${item.clipId}_${item.segmentId}_director_v${String(version).padStart(2, "0")}.mp4`;
    publishCopy(item.source, path.join(directory, outName), item.bytes, item.sha256);
    copied = true;
  }
  addTake(storyboard, item, outName);
  imported.push({ segmentId: item.segmentId, source: item.sourceName, file: `media/clips/H01/${outName}`, copied });
}
saveStoryboard(slug, storyboard);

if (fs.existsSync(cacheFile)) {
  const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  writeJsonAtomic(cacheFile, chapterizeJson(cache));
}
if (fs.existsSync(workspaceFile)) {
  const workspace = JSON.parse(fs.readFileSync(workspaceFile, "utf8"));
  writeJsonAtomic(workspaceFile, chapterizeJson(workspace));
}

console.log(JSON.stringify({
  ok: true,
  backupRoot,
  moved: Object.fromEntries(chapters.map((chapter) => [chapter, movePlan.filter((move) => move.chapter === chapter).length])),
  imported: imported.length,
  copied: imported.filter((entry) => entry.copied).length,
  files: imported
}, null, 2));
