// In-page card extraction. `extractCards` runs inside the browser via page.evaluate,
// so it must stay self-contained: no imports, no closures over module scope.
//
// WSJ markup changes over time. Every selector the extractor relies on lives in
// SELECTORS below so a markup change means editing one list, not the algorithm.

export const SELECTORS = {
  // Elements that hold a card's headline text.
  headline: [
    "h1", "h2", "h3", "h4",
    "[data-testid*='headline' i]", "[class*='headline' i]", "[class*='Headline']",
  ].join(","),
  // A card: the nearest of these around a headline.
  card: [
    "article", "[data-testid*='card' i]", "[class*='card' i]",
    "[data-testid*='story' i]", "[class*='story' i]", "li",
  ].join(","),
  // Module / section headers that label the cards below them.
  sectionHeader: [
    "[data-testid*='section-title' i]", "[data-testid*='module-title' i]",
    "[data-testid*='sectiontitle' i]", "[class*='SectionTitle']", "[class*='section-title' i]",
    "[class*='ModuleTitle']", "[class*='module-title' i]", "[class*='module-header' i]",
    "section > header h2", "section > h2", "[role='region'] > h2",
  ].join(","),
  summary: [
    "[data-testid*='summary' i]", "[class*='summary' i]", "[class*='Summary']",
    "[class*='dek' i]", "[class*='Dek']", "p",
  ].join(","),
  byline: ["[data-testid*='byline' i]", "[class*='byline' i]", "[class*='Byline']", "[class*='author' i]"].join(","),
  comments: ["[data-testid*='comment' i]", "[class*='comment' i]", "[class*='Comment']", "[aria-label*='comment' i]"].join(","),
  kicker: ["[class*='flashline' i]", "[class*='kicker' i]", "[class*='Kicker']", "[data-testid*='flashline' i]", "[class*='label' i]"].join(","),
  // Chrome that never contains editorial cards.
  chrome: "header, nav, footer, [role='navigation'], [role='banner'], [role='contentinfo'], [aria-hidden='true'], [class*='ticker' i], [class*='Ticker'], [class*='market-data' i], [id*='ad-' i], [class*='adWrapper' i], [data-testid*='ad-' i]",
};

/**
 * Runs in the browser. Returns cards in display order:
 * { headline, summary, url, urlSource, section, kicker, mediaType, duration,
 *   byline, comments, image, related: [{ headline, summary, url, urlSource }], top }
 */
export function extractCards(sel) {
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05;
  };
  const inChrome = (el) => !!el.closest(sel.chrome);
  const absUrl = (href) => {
    try { return new URL(href, location.href).toString(); } catch { return null; }
  };
  const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const textOf = (el) => norm(el.innerText || el.textContent);

  // 1. Section headers in display order.
  const headers = [...document.querySelectorAll(sel.sectionHeader)]
    .filter((h) => visible(h) && !inChrome(h) && textOf(h).length > 1 && textOf(h).length < 60)
    .map((h) => ({ el: h, top: docTop(h), text: textOf(h) }))
    .sort((a, b) => a.top - b.top);
  const headerEls = new Set(headers.map((h) => h.el));
  const sectionFor = (el) => {
    // Prefer the last header above `el` inside its enclosing <section>, else the last header above it on the page.
    const top = docTop(el) + 1;
    const sec = el.closest("section, [role='region']");
    const above = headers.filter((x) => x.top <= top);
    const inSec = sec ? above.filter((x) => sec.contains(x.el)) : [];
    const pick = inSec.length ? inSec : above;
    return pick.length ? pick[pick.length - 1].text : "";
  };

  // 2. Headline candidates.
  const headlineEls = [];
  for (const h of document.querySelectorAll(sel.headline)) {
    if (headerEls.has(h) || !visible(h) || inChrome(h)) continue;
    const text = textOf(h);
    if (text.length < 12 || text.length > 300) continue;
    // Nested matches (an <h3> wrapping a headline <span>): keep the first, outer one.
    if (headlineEls.some((o) => o.contains(h) || h.contains(o))) continue;
    headlineEls.push(h);
  }

  // Link for a headline. The Opinion quirk: the headline sits *inside* the <a>,
  // so look outward (closest) as well as inward. Both count as direct.
  const linkFor = (h) => {
    const outer = h.closest("a[href]");
    if (outer) return { url: absUrl(outer.getAttribute("href")), urlSource: "direct" };
    const inner = h.querySelector("a[href]");
    if (inner) return { url: absUrl(inner.getAttribute("href")), urlSource: "direct" };
    return { url: null, urlSource: "none" };
  };

  const cardFor = (h) => {
    // An <article> is the card when there is one; related links nested inside it stay with it.
    const art = h.closest("article");
    if (art && !inChrome(art)) return art;
    let c = h.closest(sel.card);
    // A tiny wrapper is too small: climb while the parent still holds only this headline.
    let guard = 0;
    while (c && guard++ < 4 && c.parentElement) {
      const p = c.parentElement;
      const heads = [...p.querySelectorAll(sel.headline)].filter((x) => headlineEls.includes(x));
      if (heads.length > 1 || p.matches("section, main, body, [role='region']")) break;
      c = p;
    }
    return c || h.parentElement;
  };

  const fontSize = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;

  // 3. Group headlines by card; the most prominent headline is the parent,
  //    the others in the same card are its related links.
  const groups = new Map();
  for (const h of headlineEls) {
    const c = cardFor(h);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(h);
  }

  const cards = [];
  for (const [card, heads] of groups) {
    heads.sort((a, b) => docTop(a) - docTop(b));
    const maxFont = Math.max(...heads.map(fontSize));
    const parentIdx = heads.findIndex((h) => fontSize(h) === maxFont);
    const parent = heads[parentIdx];
    const others = heads.filter((h) => h !== parent);
    const headline = textOf(parent);

    const pickSummary = (scope, exclude) => {
      for (const el of scope.querySelectorAll(sel.summary)) {
        if (!visible(el) || el.closest(sel.headline) || el.closest(sel.byline)) continue;
        if (exclude.some((x) => x.contains(el) || el.contains(x))) continue;
        const t = textOf(el);
        if (t.length >= 20 && t !== headline && !/^by\s/i.test(t) && !/^\d+\s*min\s*read$/i.test(t)) return t;
      }
      return "";
    };
    const summary = pickSummary(card, others);

    let byline = "";
    for (const el of card.querySelectorAll(sel.byline)) {
      if (!visible(el) || others.some((o) => o.contains(el))) continue;
      const t = textOf(el).replace(/^by\s+/i, "");
      if (t && t.length < 120) { byline = t; break; }
    }

    let comments = null;
    for (const el of card.querySelectorAll(sel.comments)) {
      const label = `${el.getAttribute("aria-label") || ""} ${textOf(el)}`;
      const m = label.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([kK])?/);
      if (m) { comments = Math.round(Number(m[1]) * (m[2] ? 1000 : 1)); break; }
    }

    let kicker = "";
    for (const el of card.querySelectorAll(sel.kicker)) {
      if (!visible(el) || el.closest(sel.headline) || el.closest(sel.byline)) continue;
      const t = textOf(el);
      if (t && t.length < 40) { kicker = t; break; }
    }

    const { url, urlSource } = linkFor(parent);
    const cardText = textOf(card);
    let mediaType = null;
    if (/\/video\//i.test(url || "") || card.querySelector("[class*='video' i] svg, [aria-label*='video' i]")) mediaType = "video";
    if (/\/podcasts?\//i.test(url || "") || card.querySelector("[aria-label*='podcast' i], [class*='podcast' i]")) mediaType = "podcast";
    let duration = null;
    for (const el of card.querySelectorAll("span, time, div")) {
      if (el.children.length) continue;
      const t = textOf(el);
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) { duration = t; break; }
    }
    if (!mediaType && duration) mediaType = /listen|podcast|audio/i.test(cardText) ? "podcast" : "video";

    let image = null;
    for (const img of card.querySelectorAll("img")) {
      if (!visible(img)) continue;
      if (others.some((o) => o.contains(img))) continue;
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) continue;
      const r = img.getBoundingClientRect();
      const nearByline = !!img.closest(sel.byline) || !!img.closest("[class*='headshot' i], [class*='Headshot'], [class*='avatar' i], [class*='author' i]");
      const squareSmall = r.width <= 130 && Math.abs(r.width - r.height) < 12;
      image = {
        src: absUrl(src),
        alt: norm(img.getAttribute("alt")),
        title: norm(img.getAttribute("title")),
        width: Math.round(r.width), height: Math.round(r.height),
        likelyHeadshot: nearByline || squareSmall,
      };
      break;
    }

    const related = others.map((h) => {
      const l = linkFor(h);
      // A related item's own dek, if the page shows one directly after it.
      let rs = "";
      const holder = h.closest("li") || h.parentElement;
      if (holder && holder !== card) {
        const p = [...holder.querySelectorAll("p")].find((p) => !p.closest(sel.headline) && textOf(p).length >= 20);
        if (p) rs = textOf(p);
      }
      return { headline: textOf(h), summary: rs, url: l.url, urlSource: l.urlSource };
    });

    // Plain related anchors (not headline elements) listed inside the card, e.g. <ul><li><a>.
    for (const a of card.querySelectorAll("ul a[href], ol a[href]")) {
      if (!visible(a) || heads.some((h) => h.contains(a) || a.contains(h))) continue;
      const t = textOf(a);
      if (t.length < 12 || related.some((r) => r.headline === t)) continue;
      related.push({ headline: t, summary: "", url: absUrl(a.getAttribute("href")), urlSource: "direct" });
    }

    cards.push({
      headline, summary, url, urlSource,
      section: sectionFor(parent), kicker,
      mediaType, duration, byline, comments, image, related,
      top: docTop(parent),
      cardText: cardText.slice(0, 400),
    });
  }

  cards.sort((a, b) => a.top - b.top);

  // Anchors anywhere on the page, for recovering links of headlines with none.
  const anchors = [...document.querySelectorAll("a[href]")]
    .filter((a) => !inChrome(a))
    .map((a) => ({ text: textOf(a), url: absUrl(a.getAttribute("href")) }))
    .filter((a) => a.text.length >= 12 && a.url);

  return { cards, anchors, title: document.title, height: document.documentElement.scrollHeight };
}
