import test from "node:test";
import assert from "node:assert/strict";
import { isExcludedLabel, isExcludedUrl, isWsjStoryUrl, cleanUrl } from "../src/exclude.mjs";
import { lint } from "../src/translate.mjs";
import { imageKey, isConfidentPhoto } from "../src/photos.mjs";
import { inWindow, validateEdition } from "../src/run.mjs";
import { itemHtml, koreanDate } from "../src/render.mjs";
import { nyNow } from "../src/util.mjs";

const item = (over = {}) => ({
  id: "i01", rank: 1, section: { en: "Top Stories", ko: "주요 기사" },
  en: { headline: "A Headline", summary: "", byline: "" },
  ko: { headline: "제목이다", summary: "", byline: "" },
  url: "https://www.wsj.com/world/x-1a2b3c4d", urlStatus: "direct", related: [], ...over,
});

test("exclusions cover the guide's list", () => {
  for (const l of ["Most Popular", "Popular Stories", "WSJ Buy Side", "Journal Reports: C-Suite Strategies", "CFO Journal", "Barron's", "MarketWatch", "Sponsored", "Paid Program"]) {
    assert.ok(isExcludedLabel(l), l);
  }
  for (const l of ["Opinion", "Heard on the Street", "Free Expression", "Top Stories", "Video", "Live Coverage"]) {
    assert.ok(!isExcludedLabel(l), l);
  }
  assert.ok(isExcludedUrl("https://www.barrons.com/articles/x"));
  assert.ok(isExcludedUrl("https://www.marketwatch.com/story/x"));
  assert.ok(isExcludedUrl("https://www.wsj.com/buyside/personal-finance/x"));
  assert.ok(!isExcludedUrl("https://www.wsj.com/opinion/free-expression/x-1234abcd"));
  assert.ok(isWsjStoryUrl("https://www.wsj.com/livecoverage/stock-market-today-10-27-2026"));
  assert.ok(!isWsjStoryUrl("https://www.wsj.com/news/world"));
  assert.equal(cleanUrl("https://www.wsj.com/a/b-1?mod=mhp&x=1"), "https://www.wsj.com/a/b-1?x=1");
});

test("lint catches polite endings and invented/missing summaries", () => {
  const items = [
    item({ ko: { headline: "제목입니다", summary: "", byline: "" } }),
    item({ id: "i02", en: { headline: "H", summary: "Has a dek.", byline: "" }, ko: { headline: "제목", summary: "", byline: "" } }),
    item({ id: "i03", ko: { headline: "제목", summary: "지어낸 요약이다", byline: "" } }),
    item({ id: "i04", ko: { headline: "그는 '괜찮습니다'라고 말했다", summary: "", byline: "" } }),
  ];
  const p = lint(items).map((x) => `${x.id}:${x.problem}`);
  assert.ok(p.includes("i01:polite (존댓말) ending"));
  assert.ok(p.some((x) => x.startsWith("i02:English has text")));
  assert.ok(p.some((x) => x.startsWith("i03:Korean has text")));
  assert.ok(p.includes("i04:polite (존댓말) ending")); // flagged for a human-quality second look
  assert.deepEqual(lint([item()]), []);
});

test("image names: same picture reuses, different picture never collides", () => {
  assert.equal(imageKey("https://images.wsj.net/im-42140174?width=600"), imageKey("https://images.wsj.net/im-42140174?width=1200&height=800"));
  assert.notEqual(imageKey("https://images.wsj.net/im-42140174"), imageKey("https://images.wsj.net/im-42140175"));
});

test("photos: confident matches only, never headshots", () => {
  const withImg = (img, byline = "") => item({ en: { headline: "Iran tankers run dry", summary: "", byline }, image: img });
  const good = { src: "https://images.wsj.net/im-1", alt: "An Iranian tanker at anchor", likelyHeadshot: false };
  assert.ok(isConfidentPhoto(withImg(good), "confident"));
  assert.ok(!isConfidentPhoto(withImg(good), "unsure"));
  assert.ok(!isConfidentPhoto(withImg({ ...good, likelyHeadshot: true }), "confident"));
  assert.ok(!isConfidentPhoto(withImg({ ...good, alt: "" }), "confident"));
  assert.ok(!isConfidentPhoto(withImg({ ...good, alt: "Kimberley A. Strassel" }, "Kimberley A. Strassel"), "confident"));
});

test("schedule window follows New York time across DST", () => {
  // 10:30 UTC is 06:30 EDT in summer, 05:30 EST in winter.
  assert.ok(inWindow(nyNow(new Date("2026-07-15T10:30:00Z"))));
  assert.ok(!inWindow(nyNow(new Date("2026-12-15T10:30:00Z"))));
  assert.ok(inWindow(nyNow(new Date("2026-12-15T11:30:00Z"))));
  assert.equal(nyNow(new Date("2026-10-28T03:30:00Z")).date, "2026-10-27");
});

test("render escapes text and links only verified URLs", () => {
  const html = itemHtml(item({ ko: { headline: "<script>x</script> 제목", summary: "", byline: "" }, url: null, urlStatus: "none" }));
  assert.ok(!html.includes("<script>x"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<a href"));
  assert.ok(html.includes("원문 링크 확인 불가"));
  assert.equal(koreanDate("2026-10-27"), "2026년 10월 27일 (화)");
});

test("validateEdition rejects unverified links and altered English", () => {
  const items = [item()];
  const en = JSON.stringify([items[0].en]);
  assert.deepEqual(validateEdition({ date: "2026-10-27", items }, en), []);
  const bad = [item({ urlStatus: "guessed" })];
  assert.ok(validateEdition({ date: "2026-10-27", items: bad }, en).some((e) => e.includes("unverified link")));
  assert.ok(validateEdition({ date: "2026-10-27", items }, "[]").some((e) => e.includes("English originals")));
});
