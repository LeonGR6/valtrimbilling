import { handlePreflight, json } from "../_shared/cors.ts";
import { CUSTOMER_SERVICE_IMPORT_BUCKET } from "../_shared/customerServiceEmailAttachments.ts";
import { CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS } from "../_shared/customerServiceSourcePdf.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

// Read-only boundary for the later original-source viewer. Ingestion is a
// server-only module, not a browser endpoint accepting service-role uploads.
Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const caller = userClient(req);
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: "Sign in first." }, 401);
    const body = await req.json().catch(() => null);
    if (
      !body || typeof body.importId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.importId,
      ) ||
      !Number.isSafeInteger(body.fileId) || body.fileId <= 0
    ) {
      return json({ error: "A valid importId and fileId are required." }, 400);
    }
    // This RPC requires an active ADMIN/SCHEDULING actor and an AVAILABLE source.
    const { data, error } = await caller.rpc(
      "get_customer_service_import_source_files",
      {
        p_import_id: body.importId,
      },
    );
    if (error) {
      return json(
        { error: "The source file is not available to this user." },
        error.code === "42501" ? 403 : 404,
      );
    }
    const file = data?.attachments?.find((attachment: { fileId: number }) =>
      attachment.fileId === body.fileId
    );
    if (!file || file.bucketId !== CUSTOMER_SERVICE_IMPORT_BUCKET) {
      return json({ error: "The file does not belong to this import." }, 404);
    }
    const bucket = serviceClient().storage.from(CUSTOMER_SERVICE_IMPORT_BUCKET);
    const { data: view, error: viewError } = await bucket.createSignedUrl(
      file.objectPath,
      CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
    );
    const { data: download, error: downloadError } = await bucket
      .createSignedUrl(
        file.objectPath,
        CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
        { download: file.originalFilename },
      );
    if (
      viewError || downloadError || !view?.signedUrl || !download?.signedUrl
    ) {
      return json({
        error: "Could not create the temporary source URLs. Try again.",
      }, 502);
    }
    return json({
      importId: body.importId,
      fileId: file.fileId,
      originalFilename: file.originalFilename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      signedUrl: view.signedUrl,
      downloadUrl: download.signedUrl,
      expiresIn: CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
    });
  } catch {
    // No request bodies, credentials or signed URLs in operational error logs.
    return json({ error: "Could not read the email source. Try again." }, 500);
  }
});
