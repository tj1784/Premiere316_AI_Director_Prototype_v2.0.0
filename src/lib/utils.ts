import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function formatTimecode(totalSec: number, fps = 24) {
  const clamped = Math.max(0, totalSec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const f = Math.floor((clamped % 1) * fps);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export type ReadyFile = {
  filename: string;
  mime: string;
  contents: string;
  href: string;
};

export function readyTextFile(filename: string, contents: string, mime = "text/plain"): ReadyFile {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const href = URL.createObjectURL(blob);
  return { filename, mime, contents, href };
}

export async function saveReadyFile(file: ReadyFile): Promise<"saved" | "linked" | "cancelled"> {
  if (typeof window !== "undefined" && window.premiere316?.isDesktop) {
    const result = await window.premiere316.dialog.saveText({
      defaultName: file.filename,
      contents: file.contents,
      mime: file.mime,
    });
    return result.canceled ? "cancelled" : "saved";
  }
  if ("showSaveFilePicker" in window) {
    try {
      const ext = `.${file.filename.split(".").pop() ?? "txt"}`;
      const handle = await (
        window as unknown as {
          showSaveFilePicker: (opts: {
            suggestedName: string;
            types: { description: string; accept: Record<string, string[]> }[];
          }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
        }
      ).showSaveFilePicker({
        suggestedName: file.filename,
        types: [{ description: file.filename, accept: { [file.mime]: [ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([file.contents], { type: `${file.mime};charset=utf-8` }));
      await writable.close();
      return "saved";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    }
  }

  const a = document.createElement("a");
  a.href = file.href;
  a.download = file.filename;
  a.rel = "noopener";
  a.type = file.mime;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 4000);
  return "linked";
}

export async function copyText(contents: string) {
  try {
    await navigator.clipboard.writeText(contents);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = contents;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function parseJsonLoose<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Director returned no JSON picture.");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}
