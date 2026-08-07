import fs from "node:fs/promises";
import path from "node:path";

const appUrl = "http://127.0.0.1:8789";
const slug = "harrowing_of_hell";
const projectPath = "C:/Users/Blokey/Documents/Premiere316_AI_Director_Prototype_v2.0.0/projects/harrowing_of_hell/project.json";

const commonContinuity = [
  "Use the clothing and armor silhouettes, layering, materials, trim, damage, stains, accessories, and front/profile/rear construction as the approved wardrobe reference.",
  "Use the individual approved character identity asset for facial anatomy; these boards are authoritative for wardrobe continuity and presentation scale.",
  "Maintain identical costume palette and construction across frontal, profile, three-quarter, and rear views.",
  "Embedded titles and labels are editorial metadata only and must never appear inside generated film frames.",
  "Preserve the warm divine-gold, ash, stone, ember, and restrained blue-fire lighting relationship without allowing lighting to change garment identity."
];

const boards = [
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (1).png",
    name: "Harrowing Wardrobe Continuity Board 01",
    variant: "Extended Principal Ensemble",
    description: "Approved ensemble costume bible presenting coordinated portrait, full-body, profile, three-quarter, and rear construction views for Jesus the Harrower, the Guardian Leader, Moses, Elijah, David, John the Baptist, Abraham, Isaac, and Jacob. Jesus wears layered blood-marked ivory linen with a narrow brown cord belt and sandals; the Guardian Leader carries a horned, articulated, corroded black-iron armor system with ragged skirt plates and cloak; Moses and the patriarchs use layered undyed linen, wool, weathered mantles, narrow leather belts, and staff-compatible sleeves; Elijah and John use deliberately rough animal-hide, fur, leather, and rope silhouettes; David is distinguished by a deep royal-blue robe with antique-gold woven borders. The sheet establishes a unified ash-and-gold biblical-epic wardrobe language while retaining clear class, vocation, and spiritual-state differences.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Jesus' blood stain map remains fixed at the wrists and right side wound.", "David's blue-and-gold court robe remains unique among the earth-tone freed patriarchs."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (2).png",
    name: "Harrowing Wardrobe Continuity Board 02",
    variant: "Labeled Principal Cast",
    description: "Approved labeled principal-cast wardrobe bible for Jesus Christ, the Guardian Leader, Moses, Elijah, David, John the Baptist, Abraham, Isaac, and Jacob. Each identity is paired with readable full-length costume views and rear or profile construction. The board confirms Jesus' damaged white linen and rope-belt simplicity, the Guardian's heavy black infernal plate and horned helm, Moses' layered cream shepherd robes and staff-ready mantle, Elijah and John in distinct wilderness hide garments, David in formal blue-and-gold royal textiles, and the patriarchs in aged cream, taupe, brown, and charcoal natural fibers. Use the lettering only to identify rows during production review; it is not a graphic element for final footage.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Keep each labeled row's costume attached to the named character only.", "Do not transfer royal embroidery to prophets or wilderness garments to patriarchs."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (3).png",
    name: "Harrowing Wardrobe Continuity Board 03",
    variant: "Eight-Character Hero Matrix",
    description: "Approved eight-character costume and silhouette matrix for Jesus the Harrower, the Guardian Leader, Moses, Elijah, David, John the Baptist, Abraham, and Adam. The layout combines a face-scale identity view with frontal, profile, and rear costume angles. It locks Jesus to torn and blood-marked ivory linen; the Guardian to layered black plate, horned crown-helm, spear-compatible gauntlets, and ragged dark drapery; Moses and Abraham to distinct elder robes in sand, cream, brown, and weathered wool; Elijah and John to separate hide-and-fur wilderness systems; David to deep blue court dress with antique-gold embroidery; and Adam to primitive light earth-tone cloth suitable for the first freed father. Golden shafts and drifting embers provide shared scene context without becoming costume ornament.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-adam"],
    continuity: ["Adam remains in primitive light natural cloth and must not inherit Abraham's structured mantle.", "Rear views contain only hair, armor, and garment construction—never a rear face."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (4).png",
    name: "Harrowing Wardrobe Continuity Board 04",
    variant: "Expanded Prophets Kings and Judges",
    description: "Approved expanded wardrobe bible covering Jesus, the Guardian Leader, Moses, Elijah, David, John the Baptist, Abraham, Solomon, Samson, Joseph, Daniel, and Eli. This board broadens the freed-soul wardrobe hierarchy: Jesus retains sacred distressed white linen; the Guardian retains infernal black plate; Moses and Abraham use dignified aged neutral layers; Elijah and John retain rough prophetic hides; David and Solomon carry differentiated royal palettes and embroidered court construction; Samson uses dark leather straps and a sleeveless warrior silhouette; Joseph and Daniel use restrained layered robes with period woven edging; Eli uses a blue-and-gold high-priest ensemble with a structured jeweled breastpiece. The expanded selection is authoritative for separating prophet, king, judge, steward, and priest costume classes.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Reserve jeweled or heavily embroidered priestly construction for Eli and royal ornament for David or Solomon.", "Samson's leather warrior harness remains distinct from John and Elijah's fur-and-hide prophetic garments."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (6).png",
    name: "Harrowing Wardrobe Continuity Board 05",
    variant: "Cinematic Four-Angle Set A",
    description: "Approved cinematic four-angle reference set for the central Harrowing cast: Jesus, Guardian Leader, Moses, Elijah, David, John the Baptist, and Abraham. Every row supplies portrait scale plus full-body, profile, or rear evidence under consistent volumetric gold-and-ember lighting. The board emphasizes realistic cloth weight, coarse handwoven fibers, layered hems, rope and leather closures, tarnished metal, armor articulation, fur direction, and stable rear silhouettes. It is especially useful for matching costumes between medium close-ups and wider body shots without losing stain placement, belt position, cloak length, shoulder mass, or hem damage.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Match portrait-level fabric and armor texture to the corresponding full-body and rear panels.", "Do not let volumetric light erase hems, belts, gauntlets, or cloak boundaries."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (5).png",
    name: "Harrowing Wardrobe Continuity Board 06",
    variant: "Cinematic Four-Angle Set B",
    description: "Approved alternate four-angle costume set for Jesus, Guardian Leader, Moses, Elijah, David, John the Baptist, and Abraham. This version uses a clean four-column rhythm—portrait, frontal or three-quarter full body, side profile, and rear construction—against a dark neutral hell-chamber atmosphere. It confirms Jesus' fixed white-linen blood geography and sleeve volume; the Guardian's horned helmet, asymmetrical battered plate, cape, and spear clearance; Moses' cream tunic with brown mantle; Elijah and John as separate rugged hide silhouettes; David's blue robe and gold trim; and Abraham's layered brown-and-cream elder garments. Use it as a secondary approved angle reference when the primary board lacks a garment seam or rear detail.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["This alternate board may clarify hidden construction but must not introduce a conflicting costume redesign.", "Maintain the same belt height, shoulder layers, and hem length across alternate angles."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (7).png",
    name: "Harrowing Wardrobe Continuity Board 07",
    variant: "Labeled Core Cast Matrix",
    description: "Approved clean labeled matrix for Jesus the Harrower, Guardian Leader, Moses, Elijah, David, John the Baptist, and Abraham. Each row separates the editorial nameplate from a close portrait, a readable standing costume view, a side profile, and a rear garment or armor view. The image is optimized as an on-set continuity index: Jesus in ivory blood-marked linen, Guardian in black horned plate, Moses and Abraham in differentiated elder neutrals, Elijah and John in distinct prophetic wilderness garments, and David in royal blue with antique-gold border work. The black-and-gold name column is a catalog aid only; the photographed wardrobe panels are the approved visual content.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Use the left name column only for production indexing and crop it out of visual conditioning when practical.", "Keep the core cast's costume color hierarchy stable in ensemble compositions."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (9).png",
    name: "Harrowing Wardrobe Continuity Board 08",
    variant: "Wide Contact Sheet",
    description: "Approved wide contact sheet supplying cinematic costume angles for Jesus, Guardian Leader, Moses, Elijah, David, John the Baptist, and Abraham. The horizontal format is useful for direct comparison of portrait texture, full-body silhouette, side construction, and rear drape across a 16:9 production canvas. Visual wardrobe content is authoritative; embedded captions contain an apparent duplicate or inconsistent David label in the lower rows, so captions must not be used as identity truth. Resolve identity through the project asset ID and the character's approved identity sheet, while retaining the shown garment materials and silhouettes as secondary wardrobe evidence.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Ignore duplicate or inconsistent embedded captions; project asset IDs remain canonical.", "Use this sheet for garment angle and texture reference, not for assigning facial identity from a printed label."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (10).png",
    name: "Harrowing Wardrobe Continuity Board 09",
    variant: "Selected Cast Presentation Sheet",
    description: "Approved selected-cast presentation sheet for Jesus, Guardian Leader, Moses, Elijah, David, John the Baptist, and Abraham. Each completed block combines a title strip, portrait, frontal costume, side profile, and rear construction. The sheet provides high-quality evidence for Jesus' linen folds and stains, the Guardian's plate layering, Moses' staff-compatible sleeve and mantle, Elijah and John's rugged hides, David's blue court robe, and Abraham's layered elder garments. The large unused white region in the lower-right is intentionally non-reference space and must be excluded from crops, conditioning, and generated compositions.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Treat the blank white lower-right region as unused layout space, never as a lighting or background reference.", "Crop individual completed blocks when conditioning a single character's wardrobe."]
  },
  {
    file: "C:/Users/Blokey/Downloads/ChatGPT Image Aug 6, 2026, 12_40_12 PM (8).png",
    name: "Harrowing Wardrobe Continuity Board 10",
    variant: "Prophets Kings and Elders Matrix",
    description: "Approved wardrobe matrix for Jesus, Guardian Leader, Moses, Elijah, David, John the Baptist, Abraham, Samuel, and Solomon. It extends the principal continuity set with Samuel's restrained cream-and-brown seer layers and Solomon's ornate dark royal robe with antique-gold embroidery, while preserving the established costumes for Jesus, the infernal Guardian, the freed prophets, and the patriarchs. The board clearly separates sacred white, infernal black, prophetic hide, patriarchal neutral, and royal blue or gold-coded costume families under a shared warm-ember production grade.",
    dependencies: ["ward-jesus-robe", "ward-jesus-belt", "ward-jesus-sandals", "ward-guardian-leader-armor", "ward-moses", "ward-elijah", "ward-david", "ward-john-the-baptist", "ward-souls"],
    continuity: ["Samuel's restrained seer garments and Solomon's ornate royal garments must remain visually distinct.", "Do not spread Solomon's gold ornament across the neutral freed-elder crowd wardrobe."]
  }
];

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${url} failed (${response.status}): ${payload.error || text}`);
  return payload;
}

async function jsonRequest(url, method, body) {
  return request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

const before = await request(`${appUrl}/api/projects/${slug}`);
const project = before.project || before;
if (project?.screenplay?.approval?.status !== "approved") throw new Error("The Harrowing screenplay is not approved.");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = projectPath.replace(/project\.json$/i, `project.before-wardrobe-boards-${stamp}.json`);
await fs.copyFile(projectPath, backup);

const results = [];
for (const board of boards) {
  const currentPayload = await request(`${appUrl}/api/projects/${slug}`);
  const currentProject = currentPayload.project || currentPayload;
  let asset = currentProject.assets?.items?.find((item) => item.name === board.name && item.variant === board.variant);

  if (!asset) {
    const created = await jsonRequest(`${appUrl}/api/projects/${slug}/assets`, "POST", {
      category: "wardrobe",
      name: board.name,
      variant: board.variant,
      workflowId: "krea2-cinematic-still-fp8",
      prompt: `PRODUCTION DESCRIPTION\n\n${board.description}\n\nAPPROVED USE\n\nThis director-supplied contact sheet is an immutable costume and wardrobe continuity reference for JESUS: THE HARROWING OF HELL. Preserve the depicted period construction, material response, palette hierarchy, garment damage, armor articulation, accessories, and silhouette. Do not reproduce contact-sheet borders, captions, typography, labels, or multi-panel layout inside final cinematic shots.`,
      dependencies: board.dependencies,
      continuity: [...commonContinuity, ...board.continuity]
    });
    asset = created.asset;
  }

  const sourceName = path.basename(board.file);
  let version = (asset.versions || []).find((item) => item.sourceFileName === sourceName);
  if (!version) {
    const buffer = await fs.readFile(board.file);
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: "image/png" }), sourceName);
    const imported = await request(`${appUrl}/api/projects/${slug}/assets/${asset.id}/import-image`, { method: "POST", body: form });
    asset = imported.asset;
    version = imported.version;
  }

  const refreshedPayload = await request(`${appUrl}/api/projects/${slug}`);
  const refreshedProject = refreshedPayload.project || refreshedPayload;
  asset = refreshedProject.assets.items.find((item) => item.id === asset.id);
  if (!asset.approvalCurrent) {
    const approved = await jsonRequest(`${appUrl}/api/projects/${slug}/assets/${asset.id}/approve`, "POST", {
      expectedVersion: asset.activeVersion,
      approvedBy: "Director"
    });
    asset = approved.asset;
  }

  results.push({
    id: asset.id,
    name: asset.name,
    variant: asset.variant,
    activeVersion: asset.activeVersion,
    sourceFileName: sourceName,
    description: board.description,
    dependencies: board.dependencies
  });
}

// Add traceable references from the original garment assets to every approved
// ensemble board that contains them. This does not create dependency cycles.
const afterImportPayload = await request(`${appUrl}/api/projects/${slug}`);
const afterImport = afterImportPayload.project || afterImportPayload;
for (const original of afterImport.assets.items.filter((item) => item.category === "wardrobe" && item.id.startsWith("ward-"))) {
  const boardIds = results
    .filter((result) => result.dependencies.includes(original.id))
    .map((result) => result.id);
  if (!boardIds.length) continue;
  const continuity = (original.continuity || [])
    .filter((line) => !String(line).startsWith("Approved wardrobe continuity boards:"));
  continuity.push(`Approved wardrobe continuity boards: ${boardIds.join(", ")}.`);
  await jsonRequest(`${appUrl}/api/projects/${slug}/assets/${original.id}`, "PATCH", { continuity });
}

const finalPayload = await request(`${appUrl}/api/projects/${slug}`);
const finalProject = finalPayload.project || finalPayload;
const finalAssets = results.map((result) => {
  const asset = finalProject.assets.items.find((item) => item.id === result.id);
  return {
    ...result,
    status: asset.status,
    approvalCurrent: asset.approvalCurrent,
    approvedAt: asset.approval?.approvedAt,
    approvalFingerprint: asset.approval?.versionFingerprint
  };
});

console.log(JSON.stringify({
  ok: finalAssets.every((asset) => asset.status === "generated" && asset.approvalCurrent === true),
  backup,
  projectTotal: finalProject.assets.total,
  wardrobeCount: finalProject.assets.counts?.wardrobe,
  assets: finalAssets
}, null, 2));
