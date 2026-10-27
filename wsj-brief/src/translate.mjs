// Stages 3 + 4: translate with Claude, then a second-reader review pass.
// English text is never sent back through the model for storage: the edition keeps
// the collector's exact source strings, and the model only supplies Korean.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PHOTO_RULE, REVIEW_RULES, TRANSLATION_RULES } from "./rules.mjs";
import { BriefError, log } from "./util.mjs";

const MODEL = process.env.WSJ_MODEL || "claude-opus-5-5";

const TranslationOut = z.object({
  items: z.array(z.object({
    id: z.string(),
    headline: z.string(),
    summary: z.string(),
    byline: z.string(),
    photo: z.enum(["confident", "unsure", "none"]),
  })),
  labels: z.array(z.object({ en: z.string(), ko: z.string() })),
});

const ReviewOut = z.object({
  issues: z.array(z.object({
    id: z.string(),
    field: z.enum(["headline", "summary", "byline"]),
    problem: z.string(),
    corrected: z.string(),
  })),
});

// JSON Schema forms of the above for output_config.format.
const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "labels"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "headline", "summary", "byline", "photo"],
        properties: {
          id: { type: "string" },
          headline: { type: "string" },
          summary: { type: "string" },
          byline: { type: "string" },
          photo: { type: "string", enum: ["confident", "unsure", "none"] },
        },
      },
    },
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["en", "ko"],
        properties: { en: { type: "string" }, ko: { type: "string" } },
      },
    },
  },
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "field", "problem", "corrected"],
        properties: {
          id: { type: "string" },
          field: { type: "string", enum: ["headline", "summary", "byline"] },
          problem: { type: "string" },
          corrected: { type: "string" },
        },
      },
    },
  },
};

let client;
/** Tests inject a stand-in client here. */
export function _setClient(c) {
  client = c;
}
function getClient() {
  client ??= new Anthropic({ maxRetries: 4, timeout: 20 * 60 * 1000 });
  return client;
}

/** One structured call. Streams (large outputs), falls back server-side on a refusal. */
async function callJson({ system, user, schema, zod, effort = "high" }) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: { type: "json_schema", schema } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") {
    throw new BriefError("REFUSAL", `model declined (${msg.stop_details?.category ?? "no category"})`);
  }
  if (msg.stop_reason === "max_tokens") throw new BriefError("TRUNCATED", "model output hit max_tokens");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = zod.parse(JSON.parse(text));
  } catch (err) {
    throw new BriefError("BAD_JSON", `model returned invalid JSON: ${err.message}`);
  }
  log(`model ${msg.model}: in ${msg.usage.input_tokens} (+${msg.usage.cache_read_input_tokens ?? 0} cached), out ${msg.usage.output_tokens}`);
  return parsed;
}

/** Flatten items + related links into translation units keyed by id. */
export function units(items) {
  const out = [];
  for (const it of items) {
    out.push({ id: it.id, item: it, isRelated: false });
    for (const r of it.related || []) out.push({ id: r.id, item: r, isRelated: true });
  }
  return out;
}

/**
 * Translation memory from earlier editions: English (headline+summary+byline) -> Korean.
 * Identical cards carried over from earlier days reuse the earlier wording outright.
 */
export function buildMemory(editions) {
  const mem = new Map();
  for (const ed of editions) { // newest first: first write wins
    for (const u of units(ed.items)) {
      const en = u.item.en;
      const key = memKey(en);
      if (!mem.has(key) && u.item.ko) mem.set(key, u.item.ko);
      const hk = `h:${en.headline}`;
      if (!mem.has(hk) && u.item.ko) mem.set(hk, u.item.ko);
    }
  }
  return mem;
}

const memKey = (en) => `${en.headline}\u0001${en.summary || ""}\u0001${en.byline || ""}`;

const POLITE = /(습니다|습니까|합니다|입니다|됩니다|십시오|하세요|세요|해요|이에요|예요)(?=[\s.,!?'"”’」)\]…]|$)/;
const HANGUL = /[가-힣]/;

/** Mechanical checks that do not need a model. Returns a list of problems. */
export function lint(items) {
  const problems = [];
  for (const u of units(items)) {
    const { en, ko } = u.item;
    if (!ko) { problems.push({ id: u.id, field: "headline", problem: "missing translation" }); continue; }
    for (const field of ["headline", "summary", "byline"]) {
      const k = ko[field] || "";
      if (POLITE.test(k)) problems.push({ id: u.id, field, problem: "polite (존댓말) ending" });
      if ((en[field] || "") && !k) problems.push({ id: u.id, field, problem: "English has text but Korean is empty" });
      if (!(en[field] || "") && k) problems.push({ id: u.id, field, problem: "Korean has text the English lacks" });
    }
    if (!HANGUL.test(ko.headline) && !/^[A-Za-z0-9 .,'&:-]+$/.test(en.headline)) {
      problems.push({ id: u.id, field: "headline", problem: "headline has no Korean text" });
    }
  }
  return problems;
}

function unitPayload(u, memory, photo) {
  const en = u.item.en;
  const p = {
    id: u.id,
    kind: u.isRelated ? "related link" : "card",
    headline: en.headline,
    summary: en.summary || "",
    byline: en.byline || "",
  };
  if (photo && u.item.image && !u.item.image.likelyHeadshot) {
    p.photo_alt = u.item.image.alt || u.item.image.title || "";
  }
  const prev = memory.get(`h:${en.headline}`);
  if (prev) p.previous_translation = prev;
  return p;
}

/**
 * Fill `ko` on every item and related link, `section.ko` on every item.
 * Returns { photoVerdicts: Map(id -> verdict), newLabels: {en: ko}, reused }.
 */
export async function translate(items, { memory = new Map(), labels = {} } = {}) {
  const todo = [];
  const photoVerdicts = new Map();
  let reused = 0;
  for (const u of units(items)) {
    const hit = memory.get(memKey(u.item.en));
    // Reuse only when the photo question does not need asking.
    const needsPhoto = !u.isRelated && u.item.image && !u.item.image.likelyHeadshot;
    if (hit && !needsPhoto) {
      u.item.ko = { headline: hit.headline, summary: hit.summary || "", byline: hit.byline || "" };
      reused++;
    } else {
      todo.push(u);
    }
  }
  const unknownLabels = [...new Set(items.map((i) => i.section.en))].filter((l) => !(l in labels));
  log(`translation: ${todo.length} units to translate, ${reused} reused from earlier editions, ${unknownLabels.length} new labels`);

  const newLabels = {};
  const BATCH = 40;
  for (let i = 0; i < todo.length || (i === 0 && unknownLabels.length); i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const user = [
      "Known section labels (English -> Korean):",
      JSON.stringify(labels, null, 0),
      i === 0 && unknownLabels.length ? `\nTranslate these new section labels and return them in "labels": ${JSON.stringify(unknownLabels)}` : '\nReturn "labels" as an empty list.',
      `\n${PHOTO_RULE}`,
      "\nReturn one entry per input id, same ids, Korean text only. Items:",
      JSON.stringify(batch.map((u) => unitPayload(u, memory, true)), null, 1),
    ].join("\n");
    const out = await callJson({ system: TRANSLATION_RULES, user, schema: TRANSLATION_SCHEMA, zod: TranslationOut });
    const byId = new Map(out.items.map((x) => [x.id, x]));
    for (const u of batch) {
      const t = byId.get(u.id);
      if (!t) throw new BriefError("MISSING", `model skipped ${u.id}`);
      u.item.ko = { headline: t.headline.trim(), summary: t.summary.trim(), byline: t.byline.trim() };
      photoVerdicts.set(u.id, t.photo);
    }
    for (const l of out.labels) if (unknownLabels.includes(l.en)) newLabels[l.en] = l.ko.trim();
    if (!batch.length) break;
  }
  for (const it of items) {
    it.section.ko = labels[it.section.en] ?? newLabels[it.section.en] ?? it.section.en;
  }
  return { photoVerdicts, newLabels, reused, translated: todo.length };
}

/** Second reader over every item. Applies corrections; returns the issues it found. */
export async function review(items) {
  const payload = units(items).map((u) => ({
    id: u.id,
    en: { headline: u.item.en.headline, summary: u.item.en.summary || "", byline: u.item.en.byline || "" },
    ko: u.item.ko,
  }));
  const issues = [];
  const BATCH = 60;
  for (let i = 0; i < payload.length; i += BATCH) {
    const out = await callJson({
      system: `${TRANSLATION_RULES}\n\n${REVIEW_RULES}`,
      user: JSON.stringify(payload.slice(i, i + BATCH), null, 1),
      schema: REVIEW_SCHEMA,
      zod: ReviewOut,
    });
    issues.push(...out.issues);
  }
  applyFixes(items, issues);
  return issues;
}

/** Ask for corrected Korean for specific fields flagged by lint. */
export async function fixLint(items, problems) {
  const byId = new Map(units(items).map((u) => [u.id, u.item]));
  const payload = problems.map((p) => ({ ...p, en: byId.get(p.id)?.en, ko: byId.get(p.id)?.ko }));
  const out = await callJson({
    system: `${TRANSLATION_RULES}\n\n${REVIEW_RULES}`,
    user: `These fields failed an automatic check. Return a corrected Korean value for each listed field.\n${JSON.stringify(payload, null, 1)}`,
    schema: REVIEW_SCHEMA,
    zod: ReviewOut,
  });
  applyFixes(items, out.issues);
  return out.issues;
}

function applyFixes(items, issues) {
  const byId = new Map(units(items).map((u) => [u.id, u.item]));
  for (const f of issues) {
    const it = byId.get(f.id);
    if (it?.ko && f.corrected.trim()) it.ko[f.field] = f.corrected.trim();
  }
}
