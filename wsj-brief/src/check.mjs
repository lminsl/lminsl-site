// Pre-publish visual check: render the site (with the new edition) into a temp folder
// and open it at phone width. Checks the current view, the dated view and past tabs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderSite } from "./render.mjs";
import { BriefError, DEBUG_DIR, IMG_DIR, log } from "./util.mjs";

export async function visualCheck(browser, pending) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsj-check-"));
  if (fs.existsSync(IMG_DIR)) fs.symlinkSync(IMG_DIR, path.join(dir, "img"));
  const { dates } = renderSite({ siteDir: dir, pending });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const problems = [];
  const pages = [
    ["index.html", pending],
    [`${pending.date}.html`, pending],
    ...dates.filter((d) => d !== pending.date).slice(0, 3).map((d) => [`${d}.html`, null]),
  ];
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  try {
    for (const [file, ed] of pages) {
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(path.join(dir, file)).href);
      const m = await page.evaluate(() => ({
        items: document.querySelectorAll(".article-list > li > .story-item").length,
        emptyHeadlines: [...document.querySelectorAll(".story-item h2")].filter((h) => !h.textContent.trim()).length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        tabs: document.querySelectorAll(".archive-nav a").length,
        active: document.querySelector(".archive-nav a.active")?.textContent,
        brokenImgs: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length,
      }));
      if (ed && m.items !== ed.items.length) problems.push(`${file}: shows ${m.items} items, edition has ${ed.items.length}`);
      if (!ed && m.items === 0) problems.push(`${file}: past edition renders no items`);
      if (m.emptyHeadlines) problems.push(`${file}: ${m.emptyHeadlines} empty headlines`);
      if (m.overflow > 1) problems.push(`${file}: horizontal overflow of ${m.overflow}px at 390px`);
      if (m.tabs !== dates.length + 1) problems.push(`${file}: ${m.tabs} tabs for ${dates.length} editions`);
      if (!m.active) problems.push(`${file}: no active tab`);
      if (m.brokenImgs) problems.push(`${file}: ${m.brokenImgs} broken images`);
      await page.screenshot({ path: path.join(DEBUG_DIR, `check-${file.replace(".html", "")}.png`) });
      await page.close();
    }
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (problems.length) throw new BriefError("RENDER", `render check failed:\n- ${problems.join("\n- ")}`);
  log(`visual check passed on ${pages.length} page(s) at 390px`);
}
