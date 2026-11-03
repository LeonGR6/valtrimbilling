import { handlePreflight, json } from "../_shared/cors.ts";
import {
  CUSTOMER_SERVICE_SOURCE_BUCKET,
  CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
  customerServiceSourceObjectPath,
  CustomerServiceSourcePdfConflictError,
  parseCustomerServiceRequestId,
  retainCustomerServiceSourcePdf,
  storageFailureMessage,
} from "../_shared/customerServiceSourcePdf.ts";
import { validateCustomerServicePdf } from "../_shared/mistralOcr.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

type AdminClient = ReturnType<typeof serviceClient>;

interface SourceRecord {
  source_type: string;
  file_status: string;
  file_id: number | null;
  recovery_pdf_sha256: string | null;
  recovery_pdf_size_bytes: number | null;
  recovery_pdf_filename: string | null;
}

async function authorize(req: Request): Promise<string> {
  const caller = userClient(req);
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser();

  if (authError || !user) throw new RequestError("Sign in first.", 401);

  const { data: profile, error: profileError } = await caller
    .from("app_users")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
    throw new RequestError(
      "You do not have permission to manage Customer Service source PDFs.",
      403,
    );
  }

  return user.id;
}

async function sourceRecord(
  admin: AdminClient,
  requestId: number,
): Promise<SourceRecord> {
  const { data, error } = await admin
    .from("service_request_sources")
    .select("source_type, file_status, file_id, recovery_pdf_sha256, recovery_pdf_size_bytes, recovery_pdf_filename")
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new RequestError(
      "The request does not have a source PDF waiting for upload.",
      404,
    );
  }
  if (data.source_type !== "PDF") {
    throw new RequestError("The request source is not a PDF.", 409);
  }
  if (!["PENDING", "FAILED", "AVAILABLE"].includes(data.file_status)) {
    throw new RequestError(
      "The source PDF cannot be uploaded in its current state.",
      409,
    );
  }

  return data as SourceRecord;
}

async function markUploadFailed(
  admin: AdminClient,
  requestId: number,
  actorId: string,
  error: unknown,
) {
  const { error: rpcError } = await admin.rpc(
    "fail_customer_service_source_pdf_upload",
    {
      p_request_id: requestId,
      p_actor_id: actorId,
      p_error: storageFailureMessage(error),
    },
  );
  if (rpcError) {
    console.error("Could not record the source PDF upload failure.", rpcError);
  }
}

async function finalizeUpload(
  admin: AdminClient,
  requestId: number,
  actorId: string,
  file: File,
  sizeBytes: number,
  sha256: string,
) {
  const { data, error } = await admin.rpc(
    "finalize_customer_service_source_pdf_upload",
    {
      p_request_id: requestId,
      p_actor_id: actorId,
      p_original_filename: file.name.trim(),
      p_size_bytes: sizeBytes,
      p_sha256: sha256,
    },
  );
  if (error) throw error;
  return data;
}

async function uploadSourcePdf(
  req: Request,
  admin: AdminClient,
  actorId: string,
) {
  const formData = await req.formData().catch(() => null);
  const requestId = parseCustomerServiceRequestId(formData?.get("requestId"));
  const file = formData?.get("file");

  if (!requestId) throw new RequestError("A valid requestId is required.", 400);
  if (!(file instanceof File)) {
    throw new RequestError("Attach one PDF in the file field.", 400);
  }

  const validationError = await validateCustomerServicePdf(file);
  if (validationError) throw new RequestError(validationError, 400);
  if (!file.name.trim() || file.name.trim().length > 255) {
    throw new RequestError(
      "The original PDF filename must contain 1 to 255 characters.",
      400,
    );
  }

  const source = await sourceRecord(admin, requestId);
  const objectPath = customerServiceSourceObjectPath(requestId);
  const bucket = admin.storage.from(CUSTOMER_SERVICE_SOURCE_BUCKET);
  try {
    const result = await retainCustomerServiceSourcePdf({
      file,
      alreadyAvailable: source.file_status === "AVAILABLE",
      expectedIdentity: source.recovery_pdf_sha256 ? {
        sha256: source.recovery_pdf_sha256, sizeBytes: Number(source.recovery_pdf_size_bytes),
        originalFilename: source.recovery_pdf_filename!,
      } : null,
      upload: async (bytes) => {
        const { error } = await bucket.upload(objectPath, bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
        if (error) throw error;
      },
      download: async () => {
        const { data, error } = await bucket.download(objectPath);
        if (error || !data) {
          throw error ?? new Error("The source PDF could not be read.");
        }
        return data;
      },
      finalize: (sha256) =>
        finalizeUpload(admin, requestId, actorId, file, file.size, sha256),
    });
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Customer Service source PDF upload failed.", error);
    if (
      error instanceof CustomerServiceSourcePdfConflictError ||
      (source.file_status === "AVAILABLE" &&
        typeof error === "object" && error !== null &&
        "code" in error && error.code === "55000")
    ) {
      throw new RequestError(
        "A different source PDF already exists for this request and cannot be replaced.",
        409,
      );
    }
    // The RPC itself guards against degrading AVAILABLE after a lost response
    // or another finalizer. In all cases leave Storage untouched for recovery.
    if (source.file_status !== "AVAILABLE") {
      await markUploadFailed(admin, requestId, actorId, error);
    }
    throw new RequestError(
      "The request was saved, but its PDF could not be retained. Try the upload again.",
      502,
    );
  }
}

async function createSourcePdfUrls(
  body: Record<string, unknown> | null,
  admin: AdminClient,
  actorId: string,
) {
  const requestId = parseCustomerServiceRequestId(body?.requestId);
  if (!requestId) throw new RequestError("A valid requestId is required.", 400);

  const { data: object, error: lookupError } = await admin.rpc(
    "get_customer_service_source_pdf_object",
    {
      p_request_id: requestId,
      p_actor_id: actorId,
    },
  );
  if (lookupError || !object) {
    console.error(
      "Could not locate the Customer Service source PDF.",
      lookupError,
    );
    throw new RequestError("The source PDF is not available.", 404);
  }

  const { data: viewData, error: viewError } = await admin.storage
    .from(object.bucketId)
    .createSignedUrl(
      object.objectPath,
      CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
    );
  if (viewError || !viewData?.signedUrl) {
    throw viewError ?? new Error("Missing signed URL.");
  }

  const { data: downloadData, error: downloadError } = await admin.storage
    .from(object.bucketId)
    .createSignedUrl(
      object.objectPath,
      CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
      { download: object.originalFilename },
    );
  if (downloadError || !downloadData?.signedUrl) {
    throw downloadError ?? new Error("Missing signed download URL.");
  }

  return json({
    ok: true,
    requestId,
    fileId: object.fileId,
    originalFilename: object.originalFilename,
    mimeType: object.mimeType,
    sizeBytes: object.sizeBytes,
    signedUrl: viewData.signedUrl,
    downloadUrl: downloadData.signedUrl,
    expiresIn: CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS,
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const actorId = await authorize(req);
    const admin = serviceClient();
    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("multipart/form-data")) {
      return await uploadSourcePdf(req, admin, actorId);
    }
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null) as
        | Record<string, unknown>
        | null;
      if (body?.action !== "signed-url") {
        throw new RequestError("Use action signed-url for JSON requests.", 400);
      }
      return await createSourcePdfUrls(body, admin, actorId);
    }

    throw new RequestError(
      "Send multipart/form-data or application/json.",
      415,
    );
  } catch (error) {
    if (error instanceof RequestError) {
      return json({ error: error.message }, error.status);
    }
    console.error("Customer Service source PDF operation failed.", error);
    return json({ error: "The source PDF operation failed. Try again." }, 500);
  }
});
