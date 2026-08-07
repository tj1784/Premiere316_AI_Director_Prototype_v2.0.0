import crypto from "crypto";
import fs from "fs";
import path from "path";
import { loadProject, saveProject } from "../server/projects.js";
import { projectDir } from "../server/paths.js";

const slug = process.argv[2] || "harrowing_of_hell";
const screenplayPath = process.argv[3];
if (!screenplayPath) throw new Error("Usage: node scripts/import-approved-screenplay.mjs <project-slug> <screenplay-path>");

const absoluteScreenplayPath = path.resolve(screenplayPath);
if (!fs.existsSync(absoluteScreenplayPath)) throw new Error(`Screenplay file not found: ${absoluteScreenplayPath}`);

const markdown = fs.readFileSync(absoluteScreenplayPath, "utf8").replace(/\r\n/g, "\n").trim();
if (!markdown) throw new Error(`Screenplay file is empty: ${absoluteScreenplayPath}`);

const project = loadProject(slug);
const root = projectDir(slug);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(root, "production", "screenplay-import", timestamp);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(path.join(root, "project.json"), path.join(backupDir, "project.before.json"));

const revision = crypto.createHash("sha256").update(markdown).digest("hex");
const now = new Date().toISOString();
project.screenplay = {
  ...(project.screenplay || {}),
  markdown,
  model: project.screenplay?.model || null,
  source: "director-import",
  settings: project.screenplay?.settings || {},
  updatedAt: now,
  revision,
  approval: {
    status: "approved",
    approvedAt: now,
    screenplayUpdatedAt: now,
    screenplayRevision: revision,
    approvedBy: "Director import"
  }
};
project.updatedAt = now;

const revisionsDir = path.join(root, "production", "screenplay-revisions");
fs.mkdirSync(revisionsDir, { recursive: true });
fs.writeFileSync(path.join(revisionsDir, `${revision}.md`), markdown, "utf8");

saveProject(project);

const report = {
  importedAt: now,
  project: slug,
  revision,
  screenplayCharacters: markdown.length,
  sourceFile: absoluteScreenplayPath,
  backup: path.relative(root, backupDir).replace(/\\/g, "/"),
  approved: project.screenplay.approval
};
const reportPath = path.join(root, "production", "screenplay-import-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
