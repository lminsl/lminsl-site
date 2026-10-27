// Stage 6: plain static HTML. One page per date plus index.html (the newest edition).
// Pages read fine without JavaScript; a small script only makes the date tabs switch
// without a full page reload.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RUNS_DIR, SITE_DIR, editionPath, listEditionDates, readJson, writeFileAtomic, log,
} from "./util.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");

export function koreanDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

function englishBlock(en) {
  const lines = [en.headline, en.summary, en.byline ? `By ${en.byline}` : ""].filter(Boolean);
  return `<details class="english-disclosure"><summary>영어 원문 보기</summary><div class="english-block" lang="en">${lines.map((l) => `<small>${esc(l)}</small>`).join("")}</div></details>`;
}

function headlineHtml(text, url, tag = "h2") {
  const inner = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
    : esc(text);
  return `<${tag}>${inner}</${tag}>`;
}

const MEDIA_LABEL = { video: "동영상", podcast: "팟캐스트" };

export function itemHtml(it) {
  const kicker = [
    `<span class="story-number">${pad(it.rank)}</span>`,
    `<span class="section-chip">${esc(it.section.ko)}</span>`,
    it.media ? `<span class="label">${MEDIA_LABEL[it.media.type] || it.media.type}</span>` : "",
    it.media?.duration ? `<span class="duration">${esc(it.media.duration)}</span>` : "",
    Number.isFinite(it.comments) ? `<span class="comments">${it.comments.toLocaleString("en-US")}</span>` : "",
  ].join("");
  const related = it.related?.length
    ? `<ul class="related-links">${it.related.map((r) => `<li>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.ko.headline)}</a>` : `<span class="nolink">${esc(r.ko.headline)}</span>`}${r.ko.summary ? `<small class="related-summary">${esc(r.ko.summary)}</small>` : ""}${englishBlock(r.en)}</li>`).join("")}</ul>`
    : "";
  return `<li><article class="story-item" id="${esc(it.id)}">
<div class="story-kicker">${kicker}</div>
${headlineHtml(it.ko.headline, it.url)}
${it.ko.summary ? `<p>${esc(it.ko.summary)}</p>` : ""}
${it.ko.byline ? `<div class="byline">${esc(it.ko.byline)}</div>` : ""}
${it.url ? "" : `<div class="nolink-note">원문 링크 확인 불가</div>`}
${englishBlock(it.en)}
${related}
${it.photo ? `<figure class="media-frame"><img src="${esc(it.photo.src)}" alt="${esc(it.photo.alt)}" loading="lazy"></figure>` : ""}
</article></li>`;
}

function tabsHtml(dates, active, isIndex) {
  const latest = dates[0];
  const tabs = [`<a href="./" data-date="${esc(latest)}"${isIndex ? ' class="active" aria-current="page"' : ""}>최신판</a>`];
  for (const d of dates) {
    const cur = !isIndex && d === active;
    tabs.push(`<a href="${d}.html" data-date="${d}"${cur ? ' class="active" aria-current="page"' : ""}>${d}</a>`);
  }
  return `<nav class="archive-nav" aria-label="날짜별 판">${tabs.join("")}</nav>`;
}

function failureBanner(lastRun, dates) {
  if (!lastRun || lastRun.status !== "failed" || dates.includes(lastRun.date)) return "";
  return `<div class="run-notice" role="status"><strong>${esc(koreanDate(lastRun.date))} 판은 아직 발행되지 않았다.</strong> 수집 또는 검증 단계에서 실패해 이전 판을 오늘 판으로 대신 내보내지 않았다. 아래는 가장 최근에 발행된 판이다.</div>`;
}

export function pageHtml(edition, dates, { isIndex = false, lastRun = null } = {}) {
  const title = `WSJ 한국어 모닝 브리프 · ${edition.date}`;
  const canonical = isIndex ? "./" : `${edition.date}.html`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="WSJ.com 모바일 첫 화면을 순서 그대로 한국어로 옮긴 ${esc(edition.date)} 판">
<link rel="canonical" href="${esc(canonical)}">
<link rel="stylesheet" href="brief.css">
<script src="brief.js" defer></script>
</head>
<body>
<main class="wsj-page">
<header class="site-header">
<div class="masthead">The Wall Street Journal</div>
<div class="date-row"><span>한국어 모닝 브리프</span><span>WSJ.com 첫 화면 순서를 한국어로 옮김</span></div>
${tabsHtml(dates, edition.date, isIndex)}
</header>
${isIndex ? failureBanner(lastRun, dates) : ""}
<section id="edition" class="article-flow" data-date="${esc(edition.date)}">
<div class="flow-heading"><h1>${esc(koreanDate(edition.date))}</h1><p>WSJ.com 첫 화면 순서 그대로 · ${edition.items.length}건</p></div>
<ol class="article-list">
${edition.items.map(itemHtml).join("\n")}
</ol>
</section>
<footer class="brief-footer">원문 저작권은 The Wall Street Journal에 있다. 이 페이지는 개인 학습용 번역이다.</footer>
</main>
</body>
</html>
`;
}

/**
 * Re-render every page from the stored editions. Edition data itself is never modified.
 * `pending` is an edition not yet saved, rendered as if it were (used for pre-publish checks).
 */
export function renderSite({ siteDir = SITE_DIR, pending = null } = {}) {
  const stored = listEditionDates();
  const dates = pending && !stored.includes(pending.date)
    ? [...stored, pending.date].sort().reverse()
    : stored;
  const load = (d) => (pending && d === pending.date ? pending : readJson(editionPath(d)));
  fs.mkdirSync(siteDir, { recursive: true });
  const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
  for (const f of fs.readdirSync(assets)) {
    writeFileAtomic(path.join(siteDir, f), fs.readFileSync(path.join(assets, f)));
  }
  const lastRun = readJson(path.join(RUNS_DIR, "last-run.json"), null);
  if (!dates.length) {
    writeFileAtomic(path.join(siteDir, "index.html"), emptyPage(lastRun));
    return { dates };
  }
  for (const d of dates) {
    writeFileAtomic(path.join(siteDir, `${d}.html`), pageHtml(load(d), dates));
  }
  writeFileAtomic(path.join(siteDir, "index.html"), pageHtml(load(dates[0]), dates, { isIndex: true, lastRun }));
  log(`rendered ${dates.length} edition page(s) + index into ${siteDir}`);
  return { dates };
}

function emptyPage(lastRun) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WSJ 한국어 모닝 브리프</title><link rel="stylesheet" href="brief.css"></head><body><main class="wsj-page"><header class="site-header"><div class="masthead">The Wall Street Journal</div></header>${failureBanner(lastRun, [])}<p class="empty">아직 발행된 판이 없다.</p></main></body></html>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  renderSite();
}
