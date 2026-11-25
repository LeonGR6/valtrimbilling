// Turns one email photo (JPEG or PNG) into its reduced WebP copy (decided 25 Nov 2026):
// decode with the jSquash WebAssembly codecs, reduce and turn it in JavaScript, then
// encode. The full-size pixels are dropped before encoding so one 12 MP photo fits the
// Edge Function memory (measured: about 0.75 s of CPU per photo).
import { decode as decodeJpeg } from "npm:@jsquash/jpeg@1.6.0";
import { decode as decodePng } from "npm:@jsquash/png@3.1.1";
import { encode as encodeWebp } from "npm:@jsquash/webp@1.5.0";
import {
  applyOrientation,
  downscale,
  jpegOrientation,
  PHOTO_MAX_SIDE,
  PHOTO_WEBP_QUALITY,
  type Pixels,
} from "./customerServiceEmailPhotos.ts";

export async function photoToWebp(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png") {
  const input = bytes.slice().buffer;
  let pixels: Pixels | null = (mimeType === "image/png"
    ? await decodePng(input)
    : await decodeJpeg(input)) as unknown as Pixels;
  const orientation = mimeType === "image/jpeg" ? jpegOrientation(bytes) : 1;
  const small = applyOrientation(downscale(pixels, PHOTO_MAX_SIDE), orientation);
  pixels = null;
  const webp = new Uint8Array(await encodeWebp(small as unknown as ImageData, { quality: PHOTO_WEBP_QUALITY }));
  return { webp, width: small.width, height: small.height };
}
