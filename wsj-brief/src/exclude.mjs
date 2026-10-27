// What is not an article, or is excluded from the brief (guide section 2).

const EXCLUDED_LABELS = [
  /sponsored/i, /paid\s*program/i, /partner\s*content/i, /^ad$|advertisement/i,
  /most\s*popular/i, /popular\s*(stories|now|articles)/i, /most\s*read/i,
  /buy\s*side/i,
  /journal\s*reports?/i, /c-?suite\s*strateg/i,
  /\bcmo\b|\bcio\b|\bcfo\b/i, /logistics\s*report/i, /risk\s*&?\s*compliance/i,
  /barron'?s/i, /marketwatch/i, /mansion\s*global/i, /investor'?s\s*business\s*daily/i,
  /^markets?\s*data$/i, /ticker/i,
];

const EXCLUDED_HOSTS = [
  "barrons.com", "marketwatch.com", "mansionglobal.com", "investors.com",
  "partners.wsj.com", "wsjplus.com", "store.wsj.com", "wsjshop.com",
];

const EXCLUDED_PATHS = [
  /\/buyside\//i, /\/buy-side\//i, /\/paid-program/i, /\/sponsored/i, /\/brandperspectives/i,
  /\/journal-reports?\b/i, /\/c-suite\//i,
  /\/(cmo|cio|cfo|logistics|riskandcompliance|risk-compliance)(-journal|-report)?\//i,
  /\/market-data\b/i, /\/quotes\//i,
];

// Pages that are articles (or live coverage, video, podcasts) on wsj.com.
const ARTICLE_PATH = /\/(articles|livecoverage|video|podcasts|story|opinion|[a-z-]+\/[a-z0-9-]+-[0-9a-f]{6,})/i;

export function isExcludedLabel(label) {
  const l = String(label || "").trim();
  return !!l && EXCLUDED_LABELS.some((re) => re.test(l));
}

export function isExcludedUrl(url) {
  if (!url) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.replace(/^www\./, "");
  if (EXCLUDED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return EXCLUDED_PATHS.some((re) => re.test(u.pathname));
}

/** True if the URL looks like a wsj.com story page (not nav, section fronts or tools). */
export function isWsjStoryUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "wsj.com" && !host.endsWith(".wsj.com")) return false;
  if (isExcludedUrl(url)) return false;
  return ARTICLE_PATH.test(u.pathname) && u.pathname.split("/").filter(Boolean).length >= 2;
}

/** Drop tracking parameters but keep the URL otherwise exactly as the page gave it. */
export function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|mod$|reflink$|st$|cx_)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}
