// Stage 1 + 2: open wsj.com at phone width, scroll to the bottom, extract cards,
// apply exclusions, and verify any link that was not taken straight from the card.
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright";
import { SELECTORS, extractCards } from "./extract.mjs";
import { isExcludedLabel, isExcludedUrl, isWsjStoryUrl, cleanUrl } from "./exclude.mjs";
import { BriefError, DEBUG_DIR, log, normText, overlap, squash } from "./util.mjs";

export const HOME_URL = process.env.WSJ_HOME_URL || "https://www.wsj.com/";

export async function openBrowser() {
  const launch = {};
  if (process.env.WSJ_PROXY) launch.proxy = { server: process.env.WSJ_PROXY };
  const browser = await chromium.launch(launch);
  const ctxOpts = {
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    locale: "en-US",
    timezoneId: "America/New_York",
  };
  if (process.env.WSJ_STORAGE_STATE && fs.existsSync(process.env.WSJ_STORAGE_STATE)) {
    ctxOpts.storageState = process.env.WSJ_STORAGE_STATE;
  }
  const context = await browser.newContext(ctxOpts);
  return { browser, context };
}

async function assertNotBlocked(page) {
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || "");
  const frames = page.frames().map((f) => f.url()).join(" ");
  if (/access is temporarily restricted|unusual activity|are you a robot|verify you are human/i.test(body) ||
      /captcha-delivery\.com|geo\.captcha/i.test(frames)) {
    throw new BriefError("BLOCKED", "wsj.com served its bot-check page instead of the homepage");
  }
}

/** Scroll until the page stops growing so lazy-loaded modules (e.g. Opinion) render. */
async function scrollToBottom(page, { maxSteps = 250, maxMs = 150_000 } = {}) {
  const start = Date.now();
  let lastHeight = 0;
  let stable = 0;
  for (let i = 0; i < maxSteps && Date.now() - start < maxMs; i++) {
    const { height, atBottom } = await page.evaluate(() => {
      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      const h = document.documentElement.scrollHeight;
      return { height: h, atBottom: window.scrollY + window.innerHeight >= h - 4 };
    });
    await page.waitForTimeout(450);
    if (atBottom && height === lastHeight) {
      stable++;
      if (stable >= 4) return { steps: i + 1, height, complete: true };
      await page.waitForTimeout(800); // give lazy loaders a beat at the bottom
    } else {
      stable = 0;
    }
    lastHeight = height;
  }
  return { steps: maxSteps, height: lastHeight, complete: false };
}

/** Load the homepage and return raw extraction output. */
export async function loadHomepage(context, { debugTag } = {}) {
  const page = await context.newPage();
  try {
    const res = await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await assertNotBlocked(page);
    if (res && res.status() >= 400) {
      throw new BriefError("HTTP", `wsj.com returned HTTP ${res.status()}`);
    }
    const scroll = await scrollToBottom(page);
    if (!scroll.complete) {
      throw new BriefError("SCROLL", `page never stopped growing after ${scroll.steps} scroll steps`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const raw = await page.evaluate(extractCards, SELECTORS);
    if (debugTag) await saveDebug(page, debugTag);
    return { ...raw, scroll };
  } catch (err) {
    if (debugTag) await saveDebug(page, `${debugTag}-error`).catch(() => {});
    throw err;
  } finally {
    await page.close();
  }
}

async function saveDebug(page, tag) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.writeFileSync(path.join(DEBUG_DIR, `${tag}.html`), await page.content());
  await page.screenshot({ path: path.join(DEBUG_DIR, `${tag}.png`), fullPage: true }).catch(() => {});
}

/**
 * Turn raw extraction into brief items: exclusions, link recovery, de-duplication.
 * `verify(url, headline)` returns true only if the page at url is that story.
 */
export async function buildItems(raw, { verify, priorLinks = new Map() } = {}) {
  const anchorsByText = new Map();
  for (const a of raw.anchors) {
    const k = normText(a.text).toLowerCase();
    if (!anchorsByText.has(k)) anchorsByText.set(k, []);
    anchorsByText.get(k).push(a.url);
  }

  const resolveLink = async (entry) => {
    let url = entry.url;
    if (url && isWsjStoryUrl(url)) return { url: cleanUrl(url), urlStatus: "direct" };
    // Recover from anchor text elsewhere on the page, then verify against the article title.
    const key = normText(entry.headline).toLowerCase();
    const candidates = [...new Set((anchorsByText.get(key) || []).filter(isWsjStoryUrl))];
    for (const c of candidates) {
      if (verify && (await verify(c, entry.headline))) return { url: cleanUrl(c), urlStatus: "verified" };
    }
    // A prior edition's link for the same headline, only after confirming it is the same story.
    const prior = priorLinks.get(key);
    if (prior && verify && (await verify(prior, entry.headline))) return { url: prior, urlStatus: "reused-verified" };
    return { url: null, urlStatus: "none" };
  };

  const items = [];
  const seen = new Set();
  const dropped = [];
  for (const c of raw.cards) {
    const section = squash(c.section) || "Top Stories";
    const reason =
      isExcludedLabel(section) ? `section "${section}"` :
      isExcludedLabel(c.kicker) ? `label "${c.kicker}"` :
      isExcludedUrl(c.url) ? `url ${c.url}` :
      /^(sponsored|paid program|advertisement)\b/i.test(c.cardText || "") ? "sponsored" :
      c.url && !/wsj\.com/i.test(new URL(c.url, "https://www.wsj.com").hostname) ? `off-site ${c.url}` :
      null;
    if (reason) { dropped.push({ headline: c.headline, reason }); continue; }

    const dupKey = `${normText(c.headline).toLowerCase()}|${c.url || ""}`;
    if (seen.has(dupKey)) { dropped.push({ headline: c.headline, reason: "duplicate card" }); continue; }
    seen.add(dupKey);

    const link = await resolveLink(c);
    const related = [];
    for (const r of c.related || []) {
      if (isExcludedUrl(r.url)) continue;
      const rl = await resolveLink(r);
      related.push({ en: { headline: squash(r.headline), summary: squash(r.summary) }, url: rl.url, urlStatus: rl.urlStatus });
    }
    items.push({
      section: { en: section },
      kicker: squash(c.kicker),
      en: { headline: squash(c.headline), summary: squash(c.summary), byline: squash(c.byline) },
      url: link.url,
      urlStatus: link.urlStatus,
      media: c.mediaType ? { type: c.mediaType, duration: c.duration || null } : null,
      comments: Number.isFinite(c.comments) ? c.comments : null,
      image: c.image,
      related,
    });
  }
  items.forEach((it, i) => {
    it.id = `i${String(i + 1).padStart(2, "0")}`;
    it.rank = i + 1;
    it.related.forEach((r, j) => { r.id = `${it.id}r${j + 1}`; });
  });
  return { items, dropped };
}

/** Open the candidate article and compare its title to the headline. */
export function makeVerifier(context) {
  const cache = new Map();
  return async (url, headline) => {
    const key = `${url}|${headline}`;
    if (cache.has(key)) return cache.get(key);
    const page = await context.newPage();
    let ok = false;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const titles = await page.evaluate(() => [
        document.querySelector("meta[property='og:title']")?.content,
        document.querySelector("h1")?.innerText,
        document.title,
      ].filter(Boolean));
      ok = titles.some((t) => {
        const a = normText(t).toLowerCase().replace(/\s*-\s*wsj$/, "");
        const b = normText(headline).toLowerCase();
        return a === b || overlap(headline, t) >= 0.85;
      });
    } catch (err) {
      log(`verify failed for ${url}: ${err.message}`);
    } finally {
      await page.close();
    }
    cache.set(key, ok);
    return ok;
  };
}

/** Full collection: load, build items, sanity checks. */
export async function collect(context, { priorLinks, debugTag } = {}) {
  const raw = await loadHomepage(context, { debugTag });
  log(`extracted ${raw.cards.length} cards (${raw.scroll.steps} scroll steps, page height ${raw.scroll.height}px)`);
  const { items, dropped } = await buildItems(raw, { verify: makeVerifier(context), priorLinks });
  log(`kept ${items.length} items, dropped ${dropped.length}`);
  const min = Number(process.env.WSJ_MIN_ITEMS || 15);
  if (items.length < min) {
    throw new BriefError("TOO_FEW", `only ${items.length} items extracted (minimum ${min}); the homepage markup may have changed`);
  }
  return { items, dropped, pageHeight: raw.scroll.height };
}
