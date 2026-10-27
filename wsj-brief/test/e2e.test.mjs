// Full daily run against the fixture homepage with a stand-in model.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
import { fakeClient } from "./fake-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wsj-e2e-"));
const dataDir = path.join(tmp, "data");
const siteDir = path.join(tmp, "site");
fs.mkdirSync(path.join(dataDir, "editions"), { recursive: true });
fs.copyFileSync(path.join(here, "..", "data", "labels.json"), path.join(dataDir, "labels.json"));

const { server, url } = await startServer();
Object.assign(process.env, {
  WSJ_HOME_URL: url, WSJ_DATA_DIR: dataDir, WSJ_SITE_DIR: siteDir,
  WSJ_DEBUG_DIR: path.join(tmp, "debug"), WSJ_MIN_ITEMS: "3",
});
const { _setClient } = await import("../src/translate.mjs");
const { runDaily } = await import("../src/run.mjs");
const { nyNow } = await import("../src/util.mjs");
const today = nyNow().date;
const client = fakeClient({ reviewIssues: [{ id: "i02", field: "headline", problem: "translationese", corrected: "고친 제목이다" }] });
_setClient(client);

test.after(() => server.close());

test("daily run publishes one verified edition", { timeout: 240_000 }, async () => {
  await runDaily([]);
  const file = path.join(dataDir, "editions", `${today}.json`);
  const ed = JSON.parse(fs.readFileSync(file, "utf8"));

  // Order, exclusions, grouping.
  assert.deepEqual(ed.items.map((i) => i.en.headline), [
    "Iran’s Fleet of Shadow Tankers Has Run Out of Oil After Monthslong U.S. Blockade",
    "SpaceX and Tesla Already Act Like One Company. A Merger Would Make It Official.",
    "How a Hurricane Forms Over the Warm Waters of the Atlantic",
    "GM Raises Profit Outlook as Truck Sales Stay Strong",
    "The Fed Blinks Again on Inflation",
    "Why Michigan Voters Are Still Undecided",
  ]);
  assert.equal(ed.items[0].related.length, 2);
  assert.equal(ed.items[0].en.byline, "Benoit Faucon and Summer Said");
  assert.equal(ed.items[0].comments, 422);
  assert.deepEqual(ed.items[2].media, { type: "video", duration: "4:12" });
  assert.equal(ed.items[4].en.byline, "The Editorial Board");
  assert.equal(ed.checks.droppedCards.length, 3);

  // Photos: only the confident tanker match; no stock photo, no headshot.
  assert.ok(ed.items[0].photo?.src.startsWith("img/"));
  assert.equal(ed.items.filter((i) => i.photo).length, 1);
  assert.ok(fs.existsSync(path.join(siteDir, ed.items[0].photo.src)));

  // Links: every link verified or absent. The recovered Opinion link could not be
  // verified here (wsj.com is unreachable from tests), so it ships without one.
  assert.equal(ed.items[5].url, null);
  assert.ok(ed.items.slice(0, 5).every((i) => i.urlStatus === "direct"));

  // Review fix applied, labels filled, new label recorded.
  assert.equal(ed.items[1].ko.headline, "고친 제목이다");
  assert.equal(ed.items[4].section.ko, "오피니언");
  const labels = JSON.parse(fs.readFileSync(path.join(dataDir, "labels.json"), "utf8"));
  assert.equal(labels.Video, "라벨 Video");

  // Site output.
  const index = fs.readFileSync(path.join(siteDir, "index.html"), "utf8");
  assert.ok(index.includes("고친 제목이다"));
  assert.ok(index.includes("Iran’s Fleet of Shadow Tankers")); // English original, exact
  assert.ok(fs.existsSync(path.join(siteDir, `${today}.html`)));
  assert.ok(fs.existsSync(path.join(siteDir, "brief.js")));
});

test("rerunning the same date is a no-op", { timeout: 60_000 }, async () => {
  const file = path.join(dataDir, "editions", `${today}.json`);
  const before = fs.readFileSync(file, "utf8");
  const calls = client.calls.length;
  await runDaily([]);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(client.calls.length, calls);
  assert.equal(fs.readdirSync(path.join(dataDir, "editions")).length, 1);
});

test("a blocked run records a notice and publishes nothing stale", { timeout: 120_000 }, async () => {
  const blocked = fs.mkdtempSync(path.join(os.tmpdir(), "wsj-blocked-"));
  fs.mkdirSync(path.join(blocked, "data", "editions"), { recursive: true });
  // Yesterday's edition exists; today's run is blocked.
  const prev = JSON.parse(fs.readFileSync(path.join(dataDir, "editions", `${today}.json`), "utf8"));
  const y = new Date(`${today}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  const yDate = y.toISOString().slice(0, 10);
  fs.writeFileSync(path.join(blocked, "data", "editions", `${yDate}.json`), JSON.stringify({ ...prev, date: yDate }));
  const page = path.join(blocked, "blocked.html");
  fs.writeFileSync(page, "<html><body><h1>Access is temporarily restricted</h1>We detected unusual activity</body></html>");
  const r = spawnSync(process.execPath, [path.join(here, "..", "src", "run.mjs")], {
    env: { ...process.env, WSJ_HOME_URL: `file://${page}`, WSJ_DATA_DIR: path.join(blocked, "data"), WSJ_SITE_DIR: path.join(blocked, "site"), ANTHROPIC_API_KEY: "unused" },
    encoding: "utf8", timeout: 100_000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /BLOCKED/);
  assert.deepEqual(fs.readdirSync(path.join(blocked, "data", "editions")), [`${yDate}.json`]);
  const lastRun = JSON.parse(fs.readFileSync(path.join(blocked, "data", "runs", "last-run.json"), "utf8"));
  assert.equal(lastRun.status, "failed");
  const index = fs.readFileSync(path.join(blocked, "site", "index.html"), "utf8");
  assert.ok(index.includes("아직 발행되지 않았다"));
  assert.ok(index.includes(yDate)); // the last good edition is still there, labelled as such
});
