// Daily run. Usage:
//   node src/run.mjs [--date YYYY-MM-DD] [--gate] [--publish] [--dry-run]
//
//   --gate     only run inside the morning window (America/New_York); used by the scheduler
//   --publish  commit and push the new edition (and a failure notice on failure)
//   --dry-run  do everything except saving the edition and publishing
//
// Safety rules (guide section 7):
//   * one edition per date: if the date's file exists, the run is a no-op
//   * an edition is written once, atomically, only after every check passes
//   * a failure never writes edition data; it records a notice and leaves past editions alone
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collect, loadHomepage, buildItems, makeVerifier, openBrowser } from "./collect.mjs";
import { attachPhotos } from "./photos.mjs";
import { renderSite } from "./render.mjs";
import { visualCheck } from "./check.mjs";
import { buildMemory, fixLint, lint, review, translate, units } from "./translate.mjs";
import {
  BriefError, LABELS_FILE, ROOT, RUNS_DIR, editionPath, isDate, listEditionDates,
  DEBUG_DIR, log, normText, nyNow, readJson, writeJsonAtomic,
} from "./util.mjs";

function parseArgs(argv) {
  const a = { gate: false, publish: false, dryRun: false, date: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--gate") a.gate = true;
    else if (v === "--publish") a.publish = true;
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--date") a.date = argv[++i];
    else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

/** GitHub Actions step output, when running there. */
function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** The morning window: from 06:25 to 11:59 New York time. DST is handled by the named zone. */
export function inWindow(now = nyNow()) {
  const mins = now.hour * 60 + now.minute;
  return mins >= 6 * 60 + 25 && mins < 12 * 60;
}

function recentEditions(n = 30) {
  return listEditionDates().slice(0, n).map((d) => readJson(editionPath(d)));
}

/** headline -> link from earlier editions, used only as a candidate that must be re-verified. */
function priorLinkMap(editions) {
  const m = new Map();
  for (const ed of editions) {
    for (const u of units(ed.items)) {
      const k = normText(u.item.en.headline).toLowerCase();
      if (u.item.url && !m.has(k)) m.set(k, u.item.url);
    }
  }
  return m;
}

const englishOf = (items) => JSON.stringify(units(items).map((u) => u.item.en));

/** Re-read the live homepage and compare the top 10 for corrections or re-headlining. */
async function recheckTop(context, items, memory, labels) {
  const raw = await loadHomepage(context, {});
  const { items: fresh } = await buildItems(raw, { verify: makeVerifier(context) });
  const key = (it) => it.url || normText(it.en.headline).toLowerCase();
  const freshBy = new Map(fresh.map((f) => [key(f), f]));
  const changed = [];
  const missing = [];
  for (const it of items.slice(0, 10)) {
    const f = freshBy.get(key(it));
    if (!f) { missing.push(it.en.headline); continue; }
    if (f.en.headline !== it.en.headline || f.en.summary !== it.en.summary) {
      changed.push({ id: it.id, before: { ...it.en }, after: { ...f.en } });
      it.en = { ...it.en, headline: f.en.headline, summary: f.en.summary };
      delete it.ko;
    }
  }
  if (changed.length) {
    const redo = items.filter((it) => !it.ko);
    await translate(redo, { memory, labels });
  }
  return { checked: Math.min(10, items.length), changed, missing, liveCount: fresh.length };
}

/** Final structural validation of an edition before it is saved. */
export function validateEdition(ed, collectedEnglish) {
  const errs = [];
  if (!isDate(ed.date)) errs.push("bad date");
  if (!ed.items.length) errs.push("no items");
  ed.items.forEach((it, i) => {
    if (it.rank !== i + 1) errs.push(`${it.id}: rank out of order`);
    if (!it.section?.ko) errs.push(`${it.id}: no Korean section label`);
  });
  for (const u of units(ed.items)) {
    if (!u.item.ko?.headline) errs.push(`${u.id}: no Korean headline`);
    if (u.item.url && !/^https:\/\/([a-z0-9-]+\.)*wsj\.com\//.test(u.item.url)) errs.push(`${u.id}: non-WSJ link`);
    if (!u.item.url && u.item.urlStatus !== "none") errs.push(`${u.id}: link status without link`);
    if (u.item.url && !["direct", "verified", "reused-verified"].includes(u.item.urlStatus)) errs.push(`${u.id}: unverified link`);
  }
  if (collectedEnglish !== englishOf(ed.items)) errs.push("English originals differ from the collected source text");
  return errs;
}

function gitPublish(message, paths) {
  const repo = path.resolve(ROOT, "..");
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "inherit" });
  git("add", "--", ...paths);
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: repo });
    log("nothing to commit");
    return false;
  } catch { /* there are staged changes */ }
  git("commit", "-m", message);
  for (let i = 0, wait = 2000; ; i++, wait *= 2) {
    try {
      git("pull", "--rebase", "--autostash");
      git("push");
      return true;
    } catch (err) {
      if (i >= 3) throw err;
      log(`push failed, retrying in ${wait / 1000}s`);
      execFileSync("sleep", [String(wait / 1000)]);
    }
  }
}

const PUBLISH_PATHS = ["wsj-brief/data", "static/wsj"];

export async function runDaily(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const now = nyNow();
  const date = args.date || now.date;
  if (!isDate(date)) throw new Error(`bad --date ${date}`);

  // Publishing runs sync first, so an edition already pushed from elsewhere counts.
  if (args.publish) {
    execFileSync("git", ["pull", "--rebase", "--autostash"], { cwd: path.resolve(ROOT, ".."), stdio: "inherit" });
  }
  if (fs.existsSync(editionPath(date))) {
    log(`edition ${date} already published; nothing to do`);
    setOutput("result", "exists");
    return;
  }
  if (args.gate && !inWindow(now)) {
    log(`outside the morning window (New York time ${now.hour}:${String(now.minute).padStart(2, "0")}); skipping`);
    setOutput("result", "skipped");
    return;
  }
  if (date !== now.date) {
    // The source is the live homepage; it cannot reproduce another day's page.
    throw new BriefError("DATE", `can only build today's edition (${now.date} in New York), not ${date}`);
  }

  const labels = readJson(LABELS_FILE, {});
  const prior = recentEditions();
  const memory = buildMemory(prior);
  const { browser, context } = await openBrowser();
  try {
    // 1-2. Collect and verify links.
    const { items, dropped } = await collect(context, { priorLinks: priorLinkMap(prior), debugTag: date });
    const collectedCount = items.length;

    // 3. Translate.
    const tr = await translate(items, { memory, labels });

    // 4. Review: mechanical lint, second-reader pass, then lint again.
    const lintFixes = [];
    let problems = lint(items);
    if (problems.length) lintFixes.push(...(await fixLint(items, problems)));
    const reviewIssues = await review(items);
    log(`review: ${reviewIssues.length} problem(s) found and corrected`);
    const recheck = await recheckTop(context, items, memory, labels);
    log(`recheck: ${recheck.changed.length} changed, ${recheck.missing.length} gone from the live top 10`);
    for (let round = 0; round < 2; round++) {
      problems = lint(items);
      if (!problems.length) break;
      lintFixes.push(...(await fixLint(items, problems)));
    }
    problems = lint(items);
    if (problems.length) {
      throw new BriefError("LINT", `translation still fails checks:\n${problems.map((p) => `- ${p.id} ${p.field}: ${p.problem}`).join("\n")}`);
    }
    const collectedEnglish = englishOf(items);

    // 5. Photos (confident matches only).
    const photos = await attachPhotos(items, tr.photoVerdicts, context.request);

    const edition = {
      date,
      generatedAt: new Date().toISOString(),
      source: { url: "https://www.wsj.com/", viewport: "390px mobile" },
      itemCount: items.length,
      items,
      checks: {
        collectedCount,
        liveCountOnRecheck: recheck.liveCount,
        droppedCards: dropped,
        translatedUnits: tr.translated,
        reusedUnits: tr.reused,
        lintFixes: lintFixes.map(({ id, field, problem }) => ({ id, field, problem })),
        reviewIssues: reviewIssues.map(({ id, field, problem }) => ({ id, field, problem })),
        top10Recheck: { checked: recheck.checked, changed: recheck.changed, missingFromLive: recheck.missing },
        photosAttached: photos,
        linkless: units(items).filter((u) => !u.item.url).map((u) => u.id),
      },
    };
    const errs = validateEdition(edition, collectedEnglish);
    if (errs.length) throw new BriefError("INVALID", `edition failed validation:\n- ${errs.join("\n- ")}`);

    // 6. Render into a temp folder and inspect at 390px before anything is saved.
    await visualCheck(browser, edition);

    if (args.dryRun) {
      writeJsonAtomic(path.join(DEBUG_DIR, `${date}.dry-run.json`), edition);
      log("dry run: edition written to debug/, not published");
      setOutput("result", "dry-run");
      return;
    }

    // Save exactly once. A concurrent run that got here first wins; we stop.
    const file = editionPath(date);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, JSON.stringify(edition, null, 2) + "\n", { flag: "wx" });
    } catch (err) {
      if (err.code === "EEXIST") { log(`edition ${date} appeared during the run; leaving it as is`); setOutput("result", "exists"); return; }
      throw err;
    }
    const newLabels = Object.fromEntries(Object.entries(tr.newLabels).filter(([k]) => !(k in labels)));
    if (Object.keys(newLabels).length) writeJsonAtomic(LABELS_FILE, { ...labels, ...newLabels });
    writeJsonAtomic(path.join(RUNS_DIR, "last-run.json"), { date, status: "ok", at: new Date().toISOString(), items: items.length });
    renderSite();
    log(`published ${date}: ${items.length} items, ${photos} photos, ${edition.checks.linkless.length} without link`);
    setOutput("result", "published");
    if (args.publish) gitPublish(`WSJ brief: ${date} edition`, PUBLISH_PATHS);
  } finally {
    await browser.close();
  }
}

async function recordFailure(err, args) {
  const date = args.date || nyNow().date;
  if (fs.existsSync(editionPath(date))) return; // a good edition exists; nothing to flag
  writeJsonAtomic(path.join(RUNS_DIR, "last-run.json"), {
    date, status: "failed", at: new Date().toISOString(),
    code: err.code || "ERROR", reason: String(err.message).slice(0, 2000),
  });
  renderSite();
  if (args.publish) gitPublish(`WSJ brief: ${date} run failed (${err.code || "ERROR"})`, PUBLISH_PATHS);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, "src", "run.mjs")) {
  const args = parseArgs(process.argv.slice(2));
  runDaily().catch(async (err) => {
    console.error(`\nRUN FAILED [${err.code || "ERROR"}]: ${err.message}`);
    setOutput("result", "failed");
    if (!args.dryRun) {
      try { await recordFailure(err, args); } catch (e) { console.error(`could not record failure: ${e.message}`); }
    }
    process.exit(1);
  });
}

