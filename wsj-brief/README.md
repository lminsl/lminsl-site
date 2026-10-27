# WSJ Korean Morning Brief

Every morning, a Korean translation of every editorial card on the WSJ mobile homepage, in display order, published at **https://lminsl.github.io/wsj/**. Built from the requirements in [docs/REBUILD-GUIDE.md](docs/REBUILD-GUIDE.md).

## How a run works

`node src/run.mjs` does the whole day:

| Step | File | What it does |
|---|---|---|
| Collect | `src/collect.mjs`, `src/extract.mjs` | Opens wsj.com in Chromium at 390px (iPhone emulation), scrolls until the page stops growing, extracts every card: headline, summary, link, section, media type and duration, byline, comment count, image, related links grouped under their parent. Applies the exclusion list (`src/exclude.mjs`). |
| Verify links | `src/collect.mjs` | Links taken straight from the card are kept. Any other link (e.g. recovered from anchor text) must open to a page whose title matches the headline, or the item ships without a link. |
| Translate | `src/translate.mjs`, `src/rules.mjs` | Claude (`claude-opus-5-5`) translates with the standing rules. English is never round-tripped through the model: the edition stores the collector's exact text. Cards identical to an earlier day's reuse that day's Korean. |
| Review | `src/translate.mjs`, `src/run.mjs` | Mechanical checks (no 존댓말, no missing or invented summary), a second-reader pass over every item, and a re-read of the live homepage to catch re-headlined stories in the top 10. Zero problems is a valid result. |
| Photos | `src/photos.mjs` | Only when the model is confident the image description refers to the story; never headshots. Files are named by the picture's WSJ id, so recurring photos are reused and a new picture can never overwrite an old one. |
| Render + check | `src/render.mjs`, `src/check.mjs` | Static HTML, one page per date plus `index.html`. Before saving, the site is rendered to a temp folder and opened at 390px (today, the dated page and past tabs). |
| Save | `src/run.mjs` | `data/editions/YYYY-MM-DD.json` is written once, only after every check passes. |

Safety rules:
- **One edition per date.** If the file exists the run does nothing, so retries are safe.
- **No stale fallback.** A failed run writes no edition. It records `data/runs/last-run.json`, and the front page shows a notice that today's edition is missing above the last good one.
- **Archive only grows.** Past edition files and images are never rewritten.

## Setup

1. **API key:** add `ANTHROPIC_API_KEY` under repo Settings → Secrets and variables → Actions.
2. **Schedule:** `.github/workflows/wsj-brief.yml` runs at 06:30 New York time (with retries at 07:30, 08:30 and 09:30), then deploys with the existing Pages workflow. Run it by hand from the Actions tab with "Run workflow".

### WSJ blocks datacenter IPs

wsj.com answers cloud servers with an "Access is temporarily restricted" page. That probably includes GitHub's runners. When that happens the run fails cleanly with `BLOCKED`. Two ways around it:

- **Run from a home machine (recommended).** `scripts/run-local.sh` plus `scripts/com.lminsl.wsj-brief.plist` (macOS launchd, hourly; the script checks New York time itself). Put `ANTHROPIC_API_KEY=...` in `wsj-brief/.env`. Pushing from your machine triggers the normal Pages deploy. Use one runner only: if the Mac runs the brief, disable the scheduled workflow (Actions tab → WSJ Korean morning brief → Disable).
- **Proxy.** Set a `WSJ_PROXY` secret (e.g. `http://user:pass@host:port`, a residential proxy) and the Actions run sends browser traffic through it.

## Local commands

```bash
cd wsj-brief
npm ci && npx playwright install chromium
npm test                       # unit tests + a full offline run against a fixture homepage
node src/run.mjs --dry-run     # real run, saves nothing (result in debug/)
node src/run.mjs --publish     # real run, commit + push
npm run render                 # re-render HTML from stored editions
```

Settings via environment: `WSJ_MODEL`, `WSJ_PROXY`, `WSJ_STORAGE_STATE` (Playwright cookie file, if a logged-in session is ever needed), `WSJ_MIN_ITEMS` (default 15; fewer items means the markup changed and the run fails).

## When WSJ changes its markup

The collector is tied to WSJ's page structure. It has been tested against a fixture in `test/fixtures/home.html`, not yet against the live page (it was blocked from where it was built). Every selector it uses is in `SELECTORS` at the top of `src/extract.mjs`. Each run saves the page HTML and a full screenshot to `debug/` (uploaded as a workflow artifact for 7 days). To adjust: compare a debug snapshot against the selectors, fix them, add the case to the fixture, run `npm test`.

## Gaps from the old implementation, fixed here

- Bylines are captured and shown (Opinion included), with names as 한국어(English).
- Related links stay grouped under their parent card.
- US place names in English is a standing translation rule and a review criterion.
- Comment counts are read from each card's comment link or label.
