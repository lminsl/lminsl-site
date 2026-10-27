import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.WSJ_DATA_DIR || path.join(ROOT, "data");
export const EDITIONS_DIR = path.join(DATA_DIR, "editions");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const LABELS_FILE = path.join(DATA_DIR, "labels.json");
// The Hugo site copies everything under static/ verbatim, so the brief lives at /wsj/.
export const SITE_DIR = process.env.WSJ_SITE_DIR || path.resolve(ROOT, "..", "static", "wsj");
export const IMG_DIR = path.join(SITE_DIR, "img");
export const DEBUG_DIR = process.env.WSJ_DEBUG_DIR || path.join(ROOT, "debug");
export const TZ = "America/New_York";

/** Calendar date (YYYY-MM-DD) and hour/minute in America/New_York. */
export function nyNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

export function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (fallback !== undefined && err.code === "ENOENT") return fallback;
    throw err;
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function editionPath(date) {
  return path.join(EDITIONS_DIR, `${date}.json`);
}

/** All archived edition dates, newest first. */
export function listEditionDates() {
  if (!fs.existsSync(EDITIONS_DIR)) return [];
  return fs.readdirSync(EDITIONS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

/** Collapse whitespace only. Used for stored source text, which must stay otherwise exact. */
export function squash(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/** Loose form for comparisons only (quotes unified). Never store this. */
export function normText(s) {
  return String(s || "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(("a an the and or but of to in on at for from by with as is are was were be been " +
  "it its this that these those he she they his her their our your you we i not no new how why what " +
  "who will would can could has have had after over into about more than says say said").split(" "));

export function tokens(s) {
  return normText(s).toLowerCase().replace(/[^a-z0-9'$%. -]/g, " ")
    .split(/\s+/).map((t) => t.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Share of the headline's significant words that appear in the other text. */
export function overlap(headline, other) {
  const a = tokens(headline);
  if (!a.length) return 0;
  const b = new Set(tokens(other));
  return a.filter((t) => b.has(t)).length / a.length;
}

export function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

export class BriefError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
