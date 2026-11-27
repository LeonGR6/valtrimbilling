import { assert, assertEquals } from "@std/assert";
import { encode as encodeJpeg } from "npm:@jsquash/jpeg@1.6.0";
import {
  applyOrientation,
  downscale,
  jpegOrientation,
  PHOTO_MIN_BYTES,
  photoCandidates,
  photoRetryMinutes,
  type Pixels,
  sha256Hex,
} from "./customerServiceEmailPhotos.ts";
import { photoToWebp } from "./customerServicePhotoCodec.ts";

const sha = "a".repeat(64);
const file = (overrides: Record<string, unknown> = {}) => ({
  attachmentId: "AAMk-photo-1", originalFilename: "IMG_0001.jpg", mimeType: "image/jpeg",
  sizeBytes: 2_400_000, sha256: sha, isInline: false, contentId: null, retention: "GRAPH_ONLY", ...overrides,
});

Deno.test("photos are the JPEG and PNG images of 100 KB or more of a processed email", () => {
  const rows = photoCandidates([
    {
      id: "import-1", request_id: 2023, source_manifest: [
        file(),
        file({ attachmentId: "AAMk-logo", originalFilename: "image001.jpg", sizeBytes: 37_000, isInline: true }),
        file({ attachmentId: "AAMk-footer", originalFilename: "emailfooterlogo.jpg", sizeBytes: 70_000, isInline: true }),
        file({ attachmentId: "AAMk-inline-photo", originalFilename: "image002.jpg", sizeBytes: 3_400_000, isInline: true, contentId: "cid-2" }),
        file({ attachmentId: "AAMk-png", originalFilename: "screen.png", mimeType: "image/png", sizeBytes: PHOTO_MIN_BYTES }),
        file({ attachmentId: "AAMk-pdf", originalFilename: "work-order.pdf", mimeType: "application/pdf" }),
        file({ attachmentId: "AAMk-bad-hash", sha256: "not-a-hash" }),
      ],
    },
    { id: "import-2", request_id: null, source_manifest: [file()] },
    { id: "import-3", request_id: 2031, source_manifest: null },
  ]);
  assertEquals(rows.map((row) => row.attachment_id), ["AAMk-photo-1", "AAMk-inline-photo", "AAMk-png"]);
  assertEquals(rows[1], {
    import_id: "import-1", attachment_id: "AAMk-inline-photo", request_id: 2023, original_filename: "image002.jpg",
    original_mime_type: "image/jpeg", original_size_bytes: 3_400_000, original_sha256: sha,
    original_is_inline: true, original_content_id: "cid-2",
  });
});

Deno.test("a failed photo is tried again after 5 and then 30 minutes", () => {
  assertEquals([photoRetryMinutes(1), photoRetryMinutes(2), photoRetryMinutes(3)], [5, 30, 30]);
});

Deno.test("the SHA-256 is lowercase hex", async () => {
  assertEquals(
    await sha256Hex(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

// A JPEG start with one EXIF orientation entry, in either byte order.
function exifJpeg(orientation: number, little: boolean) {
  const u16 = (value: number) => little ? [value & 255, value >> 8] : [value >> 8, value & 255];
  const u32 = (value: number) => little
    ? [value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24]
    : [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8),
    ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0),
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...app1, 0xff, 0xda, 0, 2]);
}

Deno.test("the EXIF orientation is read in both byte orders, and is 1 without it", () => {
  assertEquals(jpegOrientation(exifJpeg(6, true)), 6);
  assertEquals(jpegOrientation(exifJpeg(8, false)), 8);
  assertEquals(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), 1);
  assertEquals(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), 1);
});

const pixels = (width: number, height: number, values: number[][]): Pixels => ({
  width, height, data: new Uint8ClampedArray(values.flatMap(([r, g, b]) => [r, g, b, 255])),
});

Deno.test("the reduction averages the pixels each output pixel covers", () => {
  const source = pixels(4, 2, [[0, 0, 0], [100, 100, 100], [200, 0, 0], [0, 200, 0], [0, 0, 0], [100, 100, 100], [200, 0, 0], [0, 200, 0]]);
  const small = downscale(source, 2);
  assertEquals([small.width, small.height], [2, 1]);
  assertEquals([...small.data], [50, 50, 50, 255, 100, 100, 0, 255]);
  assert(downscale(source, 10) === source, "a small image is kept as it is");
});

Deno.test("orientation 6 turns the photo 90° clockwise and 3 turns it upside down", () => {
  // Two pixels side by side: red then blue.
  const source = pixels(2, 1, [[255, 0, 0], [0, 0, 255]]);
  const turned = applyOrientation(source, 6);
  assertEquals([turned.width, turned.height], [1, 2]);
  assertEquals([...turned.data], [255, 0, 0, 255, 0, 0, 255, 255]);
  assertEquals([...applyOrientation(source, 3).data], [0, 0, 255, 255, 255, 0, 0, 255]);
  assert(applyOrientation(source, 1) === source);
});

Deno.test("a large photo becomes a WebP of 1600 px on its long side", async () => {
  const width = 2400, height = 1200;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = (index / 4) % 256;
    data[index + 1] = 120;
    data[index + 2] = 60;
    data[index + 3] = 255;
  }
  const jpeg = new Uint8Array(await encodeJpeg({ data, width, height } as unknown as ImageData, { quality: 90 }));
  const { webp, width: outWidth, height: outHeight } = await photoToWebp(jpeg, "image/jpeg");
  assertEquals([outWidth, outHeight], [1600, 800]);
  assertEquals(new TextDecoder().decode(webp.subarray(0, 4)), "RIFF");
  assertEquals(new TextDecoder().decode(webp.subarray(8, 12)), "WEBP");
});
