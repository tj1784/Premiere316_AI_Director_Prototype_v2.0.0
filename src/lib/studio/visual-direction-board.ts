import type { VisualDirection } from "./visual-direction.ts";

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("premiere316-visual-direction", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function boardImage(id: string): Promise<string> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const req = db.transaction("images").objectStore("images").get(id);
    req.onsuccess = () => req.result ? resolve(req.result) : reject(new Error("Visual reference image is missing from this app profile."));
    req.onerror = () => reject(req.error);
  }); } finally { db.close(); }
}
async function saveImage(id: string, value: string) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("images", "readwrite"); tx.objectStore("images").put(value, id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not decode reference image.")); img.src = src; });
}
export async function composeDirectionBoard(sources: VisualDirection["sources"]): Promise<string> {
  if (!sources.length) return "";
  const images = await Promise.all(sources.map(async s => decode(await boardImage(s.id))));
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const cell = 480, gap = 8;
  const canvas = document.createElement("canvas"); canvas.width = columns * cell; canvas.height = rows * cell;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#242424"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((img, i) => {
    const scale = Math.min((cell - gap * 2) / img.width, (cell - gap * 2) / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (i % columns) * cell + (cell - w) / 2, Math.floor(i / columns) * cell + (cell - h) / 2, w, h);
  });
  const id = crypto.randomUUID(); await saveImage(id, canvas.toDataURL("image/jpeg", .92)); return id;
}
export async function addDirectionFiles(current: VisualDirection | undefined, files: File[]): Promise<VisualDirection> {
  if ((current?.sources.length ?? 0) + files.length > 32) throw new Error("Use up to 32 visual direction images.");
  if (files.some(f => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 25 * 1024 * 1024)) throw new Error("Use JPG, PNG or WebP images, up to 25 MB each.");
  const added: VisualDirection["sources"] = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const img = await decode(url), scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const id = crypto.randomUUID(); await saveImage(id, canvas.toDataURL("image/jpeg", .92)); added.push({ id, name: file.name });
    } finally { URL.revokeObjectURL(url); }
  }
  const sources = [...(current?.sources ?? []), ...added];
  return { sources, boardId: await composeDirectionBoard(sources), notes: current?.notes ?? "" };
}
