// Reduced WebP copies of the photos of processed Customer Service emails (decided 25 Nov
// 2026). pg_cron calls it every minute. Each call adds the photos of the emails processed
// in the last 30 days to the queue (once each), then converts at most ONE photo: it
// downloads the original from Outlook, checks it is the file the email import analyzed,
// reduces it to a 1600 px WebP and stores it in the private customer-service-photos
// bucket. One photo per call keeps it well inside the 2 s CPU limit (about 0.75 s each).
//
// No caller credential is required, like the visit reminders: the work comes from the
// queue and each photo is converted once, so any caller can at most do work that is due.
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { createCustomerServiceMicrosoftGraph } from "../_shared/customerServiceMicrosoftGraph.ts";
import {
  PHOTO_LOOKBACK_DAYS,
  PHOTO_MAX_ATTEMPTS,
  photoCandidates,
  type PhotoImport,
  photoRetryMinutes,
  type PhotoRow,
  sha256Hex,
} from "../_shared/customerServiceEmailPhotos.ts";
import { photoToWebp } from "../_shared/customerServicePhotoCodec.ts";

const BUCKET = "customer-service-photos";
// A claimed photo is due again after this long if its call never finishes (for example,
// when the platform stops it), so it is retried until its attempts run out.
const CLAIM_MINUTES = 10;
const COLUMNS = "id, import_id, attachment_id, request_id, original_filename, original_mime_type, " +
  "original_size_bytes, original_sha256, original_is_inline, original_content_id, attempts";

type Admin = ReturnType<typeof serviceClient>;
type PhotoRecord = PhotoRow & { id: number; attempts: number };

async function enqueue(admin: Admin, now: Date) {
  const since = new Date(now.getTime() - PHOTO_LOOKBACK_DAYS * 86_400_000).toISOString();
  const imports = await admin.from("service_request_imports")
    .select("id, request_id, source_manifest")
    .eq("status", "PROCESSED")
    .eq("source_contract_version", 2)
    .not("request_id", "is", null)
    .gte("processed_at", since);
  if (imports.error) throw imports.error;
  const rows = photoCandidates((imports.data ?? []) as PhotoImport[]);
  if (!rows.length) return;
  const { error } = await admin.from("service_request_photos")
    .upsert(rows, { onConflict: "import_id,attachment_id", ignoreDuplicates: true });
  if (error) throw error;
}

async function update(admin: Admin, id: number, values: Record<string, unknown>) {
  const { error } = await admin.from("service_request_photos").update(values).eq("id", id);
  if (error) throw error;
}

// Retried later until its attempts run out; then FAILED (its text was already extracted).
async function fail(admin: Admin, photo: PhotoRecord, message: string, now: Date, retry = true) {
  const final = !retry || photo.attempts >= PHOTO_MAX_ATTEMPTS;
  await update(admin, photo.id, {
    status: final ? "FAILED" : "PENDING",
    last_error: message.slice(0, 500),
    next_attempt_at: new Date(now.getTime() + photoRetryMinutes(photo.attempts) * 60_000).toISOString(),
  });
  return { status: final ? "FAILED" : "RETRY", photoId: photo.id };
}

// The oldest due photo, taken only if no other call took it meanwhile.
async function claimNext(admin: Admin, now: Date): Promise<PhotoRecord | null> {
  const due = await admin.from("service_request_photos")
    .select(COLUMNS)
    .eq("status", "PENDING")
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at")
    .limit(1);
  if (due.error) throw due.error;
  const photo = due.data?.[0] as unknown as PhotoRecord | undefined;
  if (!photo) return null;
  if (photo.attempts >= PHOTO_MAX_ATTEMPTS) {
    // Its last calls never finished: stop trying.
    await update(admin, photo.id, { status: "FAILED", last_error: "The conversion did not finish." });
    return null;
  }
  const claimed = await admin.from("service_request_photos")
    .update({
      attempts: photo.attempts + 1,
      next_attempt_at: new Date(now.getTime() + CLAIM_MINUTES * 60_000).toISOString(),
    })
    .eq("id", photo.id)
    .eq("status", "PENDING")
    .eq("attempts", photo.attempts)
    .select("id");
  if (claimed.error) throw claimed.error;
  return claimed.data?.length ? { ...photo, attempts: photo.attempts + 1 } : null;
}

async function convert(admin: Admin, photo: PhotoRecord, now: Date) {
  const source = await admin.rpc("read_customer_service_photo_source", { p_import_id: photo.import_id });
  if (source.error) throw source.error;
  const origin = source.data as Record<string, string | boolean | null> | null;
  if (!origin?.connectionAvailable) return fail(admin, photo, "The email is not available in Outlook.", now);
  // Microsoft asked to wait: the photo goes back to the queue without using an attempt.
  const resumeAt = origin.retryNotBefore ? Date.parse(String(origin.retryNotBefore)) : NaN;
  if (Number.isFinite(resumeAt) && resumeAt > now.getTime()) {
    await update(admin, photo.id, { attempts: photo.attempts - 1, next_attempt_at: new Date(resumeAt).toISOString() });
    return { status: "WAITING_FOR_MICROSOFT", photoId: photo.id };
  }
  const tenantId = Deno.env.get("MS365_TENANT_ID") ?? "";
  if (tenantId.toLowerCase() !== String(origin.tenantId).toLowerCase()) {
    return fail(admin, photo, "The Microsoft connection is not configured for this mailbox.", now);
  }
  const graph = createCustomerServiceMicrosoftGraph({
    tenantId,
    clientId: Deno.env.get("MS365_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("MS365_CLIENT_SECRET") ?? "",
    deadline: Date.now() + 40_000,
  });
  const [file] = await graph.files(
    { tenantId: String(origin.tenantId), mailboxId: String(origin.mailboxId), folderId: String(origin.folderId) },
    String(origin.messageId),
    [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      id: photo.attachment_id,
      name: photo.original_filename,
      contentType: photo.original_mime_type,
      size: photo.original_size_bytes,
      isInline: photo.original_is_inline,
      contentId: photo.original_content_id,
    }],
  );
  const bytes = new Uint8Array(await file.file.arrayBuffer());
  if (await sha256Hex(bytes) !== photo.original_sha256) {
    return fail(admin, photo, "The file in Outlook is not the one the email import analyzed.", now, false);
  }
  const { webp, width, height } = await photoToWebp(bytes, photo.original_mime_type);
  const objectPath = `${photo.request_id}/${photo.id}.webp`;
  const upload = await admin.storage.from(BUCKET).upload(objectPath, webp, { contentType: "image/webp", upsert: true });
  if (upload.error) throw upload.error;
  await update(admin, photo.id, {
    status: "STORED",
    object_path: objectPath,
    width,
    height,
    size_bytes: webp.byteLength,
    stored_at: now.toISOString(),
    last_error: null,
  });
  return { status: "STORED", photoId: photo.id, requestId: photo.request_id, kilobytes: Math.round(webp.byteLength / 1024) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const admin = serviceClient();
  const now = new Date();
  try {
    await enqueue(admin, now);
    const photo = await claimNext(admin, now);
    if (!photo) return json({ status: "NONE_DUE" });
    try {
      return json(await convert(admin, photo, now));
    } catch (error) {
      console.error("An email photo could not be converted.", photo.id, error);
      return json(await fail(admin, photo, "The photo could not be downloaded or converted.", now));
    }
  } catch (error) {
    console.error("Customer Service email photos failed.", error);
    return json({ error: "The email photos could not be processed." }, 500);
  }
});
