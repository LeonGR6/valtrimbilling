// Email photos as reduced WebP copies (decided 25 Nov 2026): which images of a processed
// email are photos, and the pixel work that keeps a 12 MP photo inside one Edge Function
// call. Measured on 25 Nov 2026: three WebAssembly codecs (decode, resize, encode) ran
// out of memory even for one photo, so the reduction is done here in plain JavaScript and
// the full-size pixels are dropped before encoding. Pure helpers: no Deno, database,
// Graph or codec dependency.

// Smaller images are logos and signatures pasted in the email, not photos of the work
// (a 70 KB email footer logo was the largest seen; phone photos weigh megabytes).
export const PHOTO_MIN_BYTES = 100_000;
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_WEBP_QUALITY = 75;
export const PHOTO_MAX_ATTEMPTS = 3;
// Processed emails looked at for new photos.
export const PHOTO_LOOKBACK_DAYS = 30;

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

export interface PhotoImport {
  id: string;
  request_id: number | null;
  source_manifest: unknown;
}

export interface PhotoRow {
  import_id: string;
  attachment_id: string;
  request_id: number;
  original_filename: string;
  original_mime_type: "image/jpeg" | "image/png";
  original_size_bytes: number;
  original_sha256: string;
  original_is_inline: boolean;
  original_content_id: string | null;
}

// One row per photo of each processed email, from its validated attachment manifest.
export function photoCandidates(imports: PhotoImport[]): PhotoRow[] {
  return imports.flatMap((entry) => {
    if (!entry.request_id || !Array.isArray(entry.source_manifest)) return [];
    return entry.source_manifest.flatMap((file: Record<string, unknown>) => {
      const mime = String(file?.mimeType ?? "").toLowerCase();
      if (
        !file || (mime !== "image/jpeg" && mime !== "image/png") ||
        typeof file.attachmentId !== "string" || !file.attachmentId ||
        typeof file.originalFilename !== "string" || !file.originalFilename ||
        !Number.isSafeInteger(file.sizeBytes) || (file.sizeBytes as number) < PHOTO_MIN_BYTES ||
        typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
      ) return [];
      return [{
        import_id: entry.id,
        attachment_id: file.attachmentId,
        request_id: Number(entry.request_id),
        original_filename: file.originalFilename.slice(0, 255),
        original_mime_type: mime,
        original_size_bytes: file.sizeBytes as number,
        original_sha256: file.sha256,
        original_is_inline: file.isInline === true,
        original_content_id: typeof file.contentId === "string" ? file.contentId : null,
      }];
    });
  });
}

// Minutes before trying a failed photo again: 5, then 30.
export function photoRetryMinutes(attempts: number) {
  return attempts <= 1 ? 5 : 30;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The EXIF orientation of a JPEG (1 to 8; 1 when there is none). Phones save a turned
// photo as it was shot and record the turn here, so the copy has to apply it.
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xda || length < 2) return 1;
    const start = offset + 4;
    if (
      marker === 0xe1 && start + 14 <= bytes.length &&
      String.fromCharCode(...bytes.subarray(start, start + 4)) === "Exif" && bytes[start + 4] === 0
    ) {
      const tiff = start + 6;
      const little = bytes[tiff] === 0x49;
      const u16 = (at: number) => little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
      const u32 = (at: number) => little
        ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
        : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const count = u16(ifd);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset = start + length - 2;
  }
  return 1;
}

// Area average: each output pixel is the mean of the source pixels it covers. The
// result is opaque (photos have no transparency to keep).
export function downscale(source: Pixels, maxSide = PHOTO_MAX_SIDE): Pixels {
  const scale = maxSide / Math.max(source.width, source.height);
  if (scale >= 1) return source;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  const stepX = source.width / width;
  const stepY = source.height / height;
  const data = source.data;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * stepY);
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * stepX);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) * stepX)));
      let red = 0, green = 0, blue = 0, count = 0;
      for (let row = y0; row < y1; row += 1) {
        let index = (row * source.width + x0) * 4;
        for (let column = x0; column < x1; column += 1, index += 4) {
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      out[target] = red / count;
      out[target + 1] = green / count;
      out[target + 2] = blue / count;
      out[target + 3] = 255;
    }
  }
  return { data: out, width, height };
}

// Turns the pixels the way the EXIF orientation says (2 to 8 mirror and/or rotate).
export function applyOrientation(source: Pixels, orientation: number): Pixels {
  if (orientation < 2 || orientation > 8) return source;
  const swap = orientation >= 5;
  const width = swap ? source.height : source.width;
  const height = swap ? source.width : source.height;
  const out = new Uint8ClampedArray(width * height * 4);
  const lastX = source.width - 1;
  const lastY = source.height - 1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let tx = x, ty = y;
      switch (orientation) {
        case 2: tx = lastX - x; break;
        case 3: tx = lastX - x; ty = lastY - y; break;
        case 4: ty = lastY - y; break;
        case 5: tx = y; ty = x; break;
        case 6: tx = lastY - y; ty = x; break;
        case 7: tx = lastY - y; ty = lastX - x; break;
        case 8: tx = y; ty = lastX - x; break;
      }
      const from = (y * source.width + x) * 4;
      const to = (ty * width + tx) * 4;
      out[to] = source.data[from];
      out[to + 1] = source.data[from + 1];
      out[to + 2] = source.data[from + 2];
      out[to + 3] = source.data[from + 3];
    }
  }
  return { data: out, width, height };
}
