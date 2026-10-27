// Stage 5: attach a photo only on a confident match, and store images so that
// a new edition can never overwrite a file an earlier edition uses.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IMG_DIR, log, overlap } from "./util.mjs";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" };

/**
 * Same picture -> same file name (so recurring wire photos are reused, not re-downloaded);
 * different picture -> different name (so nothing is ever overwritten).
 * WSJ image URLs identify the picture by path (e.g. images.wsj.net/im-42140174); size params are ignored.
 */
export function imageKey(src) {
  const u = new URL(src);
  return crypto.createHash("sha256").update(`${u.hostname}${u.pathname}`).digest("hex").slice(0, 20);
}

/** Decide whether an item's card image is a confident match for the story. */
export function isConfidentPhoto(item, verdict) {
  const img = item.image;
  if (!img?.src || img.likelyHeadshot) return false;
  const desc = img.alt || img.title || "";
  if (!desc) return false;
  if (verdict !== "confident") return false;
  // An Opinion card's picture that just names the byline author is a headshot.
  if (item.en.byline && overlap(item.en.byline, desc) >= 0.99 && desc.split(" ").length <= 5) return false;
  return true;
}

/** Download (or reuse) the image; returns the site-relative path or null. */
export async function storeImage(request, src) {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const key = imageKey(src);
  const existing = fs.readdirSync(IMG_DIR).find((f) => f.startsWith(`${key}.`));
  if (existing) return `img/${existing}`;
  const res = await request.get(src, { timeout: 30_000 });
  if (!res.ok()) {
    log(`image ${src}: HTTP ${res.status()}`);
    return null;
  }
  const type = (res.headers()["content-type"] || "").split(";")[0].trim();
  const ext = EXT[type];
  if (!ext) {
    log(`image ${src}: unexpected type ${type}`);
    return null;
  }
  const file = path.join(IMG_DIR, `${key}.${ext}`);
  // wx: fail rather than overwrite if the file appeared meanwhile.
  try {
    fs.writeFileSync(file, await res.body(), { flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  return `img/${key}.${ext}`;
}

/** Attach photos to items in place. Returns how many were attached. */
export async function attachPhotos(items, verdicts, request) {
  let n = 0;
  for (const it of items) {
    const ok = isConfidentPhoto(it, verdicts.get(it.id));
    if (ok) {
      try {
        const rel = await storeImage(request, it.image.src);
        if (rel) {
          it.photo = { src: rel, alt: it.image.alt || it.image.title };
          n++;
        }
      } catch (err) {
        log(`photo for ${it.id} skipped: ${err.message}`);
      }
    }
    delete it.image; // raw capture is not part of the published edition
  }
  return n;
}
