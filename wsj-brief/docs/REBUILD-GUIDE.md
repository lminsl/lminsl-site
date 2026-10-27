# WSJ Korean Morning Brief: Rebuild Guide

Portable requirements for recreating my daily Korean-language Wall Street Journal morning brief. This is a rebuild guide, not a source-code export and not an archive export. The existing editions (the date archive to date) are not included; no automatic migration is performed, and the current daily publishing continues unchanged in the meantime.

Sections 3 to 8 state the imported brief requirements, combined with later requested changes. Section 10 lists places where the current running implementation has drifted from those requirements, so a rebuild can fix them rather than inherit them.

Live page (public): https://files.instinct.com/1llyi5jl6z9q-wsj

Design reference: my own previous version of this brief at https://lminsl.github.io/wsj-daily-brief/ . The current page's look follows it.

---

## 1. What the product is

Every morning, a new dated edition of the page:

- A Korean translation of every visible editorial card on the WSJ mobile homepage (wsj.com rendered at a 390px-wide phone viewport), captured top-to-bottom in display order.
- Each item: Korean headline, Korean summary when the card shows one, a link to the original WSJ article, and a collapsible "영어 원문 보기" (view English original) dropdown holding the exact English headline and summary.
- A photo for items where one can be confidently matched to the story.
- Editions accumulate by date: the page keeps every past edition, with date tabs at the top (newest first). Past editions are never edited or removed.

## 2. Source and collection semantics

- Source: the live wsj.com homepage only, rendered in a mobile viewport (390px wide, iPhone-class emulation). Not RSS, not a section page, not a previous edition, not the desktop layout. The live page is the only source of truth.
- Order: items appear in the order displayed on the page, top to bottom. No reordering by importance and no special emphasis for particular items or Opinion pieces.
- Lazy loading: the homepage loads more cards on scroll, so the collector must scroll all the way to the bottom before extracting. A top-of-page snapshot misses most items. Past incident: a scroll limit once dropped the entire Opinion block.
- No fixed item count: the number of items is whatever the homepage shows that day (recent editions have ranged from the mid-40s to high 50s).
- Per card, capture: headline text, the visible summary/dek when present (empty if none; never invent one), the article URL, the section/module label, media type (video/podcast) and duration, comment count, byline, the card's image if present, and parent story plus related-link grouping where the page shows it.
- Opinion-section quirk: Opinion editorial headline cards wrap the headline inside the link element, so naive "find the link inside the card" extraction misses them. The URL then has to be recovered from the anchor text and verified against the actual article page title, never guessed. Any item whose URL cannot be recovered or verified ships without a link rather than with an unverified one.
- Related links: where a parent card shows related sub-items, keep them grouped under the parent as the page presents them. Do not flatten related items into standalone cards, and do not invent groupings by topic similarity.
- Exclusions: sponsored/paid-program content, "Most Popular" / "Popular Stories", "WSJ Buy Side", the "Journal Reports" family (including C-Suite Strategies and its CMO/CIO/CFO/Logistics/Risk & Compliance report verticals), Barron's, MarketWatch, Mansion Global, Investor's Business Daily, and the market ticker (UI furniture, not an article). Headers, navigation, ads and footers are not articles.
- Everything else visible is kept, including live coverage, Free Expression, Heard on the Street, video and audio cards.

## 3. Translation rules (requested)

- Register: Korean plain news style (평서체): 다/한다/된다/있다/없다. Polite honorific endings (습니다/합니다) are prohibited.
- Translate everything; do not summarize. Preserve the original's subject, object, negation, conditions, numbers, causality, degree and uncertainty.
- Understand field, then actor, then core event, and write natural Korean. Do not polish a literal calque. Words like estate, charge, claim, case, bill, interest, security, trust, option, property, home, resident, domicile take their domain-appropriate meaning.
- Compressed English headlines may have their omitted relations/verbs restored, but add no facts the original lacks.
- People: 한국어(English) on first mention, e.g. 압둘 엘사예드(Abdul El-Sayed); Korean only thereafter.
- Companies, brands, products, services, column names, fund/report titles: English only (Google, SpaceX, OpenAI, Anthropic, Heard on the Street).
- US place names: English only (Michigan, Ohio, New York, Detroit).
- Non-US place names: Korean only, with rare exceptions for very unfamiliar names.
- Fixed Korean-only terms: 하마스, 백악관, 미군, 민주당, 공화당.
- No habitual English glosses on familiar words (앱, 중간선거, 주식시장, 헤지펀드 etc.). Acronyms and technical tokens such as AI, FAA, GLP-1 stay as-is. Add a parenthetical English gloss only where the Korean is genuinely ambiguous; the gloss does not override the naming rules.
- Large dollar amounts: compact notation preferred (13M 달러, 4.2B 달러).
- Titles of works (books, films, albums, shows, podcasts): 「」 brackets with the original title, e.g. 「The Housemaid」.
- The English original dropdown must contain the exact source text, unmodified.

## 4. Section labels

Labels actually used in published editions to date (consistency reference, not a closed list):

| WSJ label | Korean label |
|---|---|
| Top Stories | 주요 기사 |
| Morning Catch-Up | 모닝 캐치업 |
| World | 국제 |
| U.S. | 미국 |
| U.S. & Politics | 미국·정치 |
| Politics | 정치 |
| Elections | 선거 |
| Economy | 경제 |
| Economy & Markets | 경제·시장 |
| Business & Finance | 비즈니스·금융 |
| Tech | 기술 |
| Opinion | 오피니언 |
| Heard on the Street | Heard on the Street |
| Personal Finance / Your Money | 개인 재정 |
| Health and Science | 건강·과학 |
| People to Know | 주목할 인물 |
| Homes | 주택 |
| Real Estate | 부동산 |
| Autos / Cars | 자동차 |
| Electric Vehicles | 전기차 |
| Arts / Culture | 문화 |
| Design | 디자인 |
| Relationships | 관계 |
| Travel | 여행 |
| Sports | 스포츠 |
| At Work | 직장 |
| What to Watch | 볼거리 |
| Your Weekend | 주말 특집 |
| My Monday Morning | 나의 월요일 아침 |
| Halloween | 할로윈 |
| Podcast | 팟캐스트 |
| Videos | 비디오 |

Labels not in this table are new: translate them sensibly at run time, then keep the choice consistent in later editions. This table records past translation choices; it is not a rule that these are the only valid renderings.

## 5. Photos

- Attach a photo only when it can be confidently matched to the specific story (the image's description/metadata on wsj.com references the story's subject). Confident matches only. If there is any doubt, the item ships without a photo, and an item without a photo is still kept. There is no target photo count; an edition can legitimately have few or none.
- Opinion author headshots are byline photos, not story photos; do not attach them as item photos.
- The same wire photo often recurs across days; reuse recurring images rather than re-downloading.

## 6. Presentation

- Single page, mobile-first (desktop also usable), Korean UI chrome.
- Top: title and today's date; date tabs for every archived edition (newest first), switching without a page reload.
- Items listed in homepage order, each showing: section label, rank/number, Korean headline, Korean summary, media badge and duration where relevant, byline and comment count where present, optional photo, a link to the WSJ original (when a verified URL exists), related links grouped under their parent, and the English-original dropdown.
- No added editorial apparatus: no "deep read" picks, no "next 4" rails, no Opinion emphasis rail, no opening synthesis.
- Do not display decorative controls that do not work.

## 7. Schedule and reliability

- Current agreed schedule: the daily run starts around 06:30 America/New_York, aiming for the edition to be ready by ~07:00. Use the named timezone, not a fixed UTC offset, so daylight-saving changes are handled automatically. (An earlier setup once targeted ~06:00; that is historical only.)
- Each run produces that date's edition. Repeat articles from a previous day are normal (homepage carryover) and are translated consistently with earlier wording.
- Failure handling: a failed run must never publish stale or fallback data as today's edition, and must never take down or blank the previously published editions. A slow day means a late edition or an explicit failure notice, never a disguised old one.
- No duplicate dates: a retry or late run for the same date must complete that date's single edition, never create a second tab or file for the same date. Rerunning a date is idempotent.
- Non-destructive archive: new editions only append; past editions' content and images must never be overwritten. Asset filenames must be unique across editions so a new image can never clobber an earlier edition's file.

## 8. Quality checks before publishing

Each edition is verified before it goes live:

- Read every item's English and Korean headline and summary for ambiguity, translationese, and factual drift. If zero problems are found, report zero; do not manufacture fixes.
- Recheck at least the top 10 items against the live homepage for corrections, retractions or re-headlining.
- Item count matches what the live homepage showed.
- Every item either has a verified WSJ URL or ships explicitly without one (unrecoverable Opinion cards, video cards with no matching article). No item carries a guessed link. A card may reuse a prior edition's link only after confirming the linked page is the exact same story; otherwise it stays linkless.
- Korean typography: 평서체 throughout with no 존댓말, 「」 on works, 한국어(English) on first mention of people, English-only company and US place names.
- Every English dropdown matches the source text.
- Rendered at ~390px width and visually inspected; both the current view and the dated view are checked, and past date tabs still render correctly.

## 9. Known limitations

- The current hosted page is a JavaScript-rendered app: fetching the public URL with a plain HTTP client returns an empty shell, not the edition text. A reader without a browser (for example an LLM fetching a URL) cannot read it. The suggested reimplementation below outputs plain HTML partly for this reason.
- WSJ markup changes over time; card-based extraction is tied to the current homepage structure and will need maintenance.
- Some items appear without summaries or photos because the homepage card itself shows none.

## 10. Current implementation gaps (drift from the requested rules)

These are known gaps in the running implementation, to fix in a rebuild rather than treat as approved behavior:

- Bylines: the data model keeps a byline field and the rules ask for bylines to be preserved, but collected editions currently leave bylines empty. Opinion bylines in particular are not shown.
- Related-link grouping: the data model has a related-links structure and the rules ask for parent/related grouping to be preserved, but current editions flatten every card and store no related links.
- US place names: the rule is English only, but current editions are inconsistent (Milwaukee, Palm Beach, Los Angeles in English alongside 텍사스, 캘리포니아, 뉴욕, 보스턴 in Korean).
- Comment counts are captured only intermittently.

## 11. Suggested reimplementation (suggestions, not requirements)

One straightforward architecture:

1. Collect (cron, early morning America/New_York): a headless browser (e.g. Playwright) opens wsj.com at 390px width, scrolls to the bottom to defeat lazy loading, and extracts each visible card: headline, dek, URL, section, media type, duration, byline, comment count, image, and parent/related structure. Apply the exclusion list in section 2.
2. Verify links: for cards whose URL was not directly extractable, fetch the candidate article and confirm the page title matches the headline before accepting the link.
3. Translate: send the day's extracted items to a model with the section 3 rules as a standing glossary/prompt; require it to return the untouched English originals alongside the Korean text.
4. Review: a second pass reads all items for ambiguity, translationese and factual drift, and rechecks the top items against the live homepage.
5. Match photos by comparing each image's description to item headlines; attach only confident matches.
6. Render plain static HTML (no JavaScript framework needed): a page per date plus an index with date tabs, each item with its Korean text, link, photo, and a `<details>` dropdown for the English original. Plain HTML also makes the page readable by any HTTP client.
7. Host on any static host (e.g. GitHub Pages). Store each edition's extracted data as a dated JSON file so editions accumulate without re-translation and retries for the same date are idempotent. Keep asset filenames unique per edition so new images never overwrite old ones.
