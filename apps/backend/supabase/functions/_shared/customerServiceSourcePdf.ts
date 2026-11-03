export const CUSTOMER_SERVICE_SOURCE_BUCKET = "customer-service-sources";
export const CUSTOMER_SERVICE_SOURCE_SIGNED_URL_SECONDS = 300;

export function parseCustomerServiceRequestId(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const requestId = Number(normalized);
  return Number.isSafeInteger(requestId) && requestId > 0 ? requestId : null;
}

export function customerServiceSourceObjectPath(requestId: number): string {
  return `requests/${requestId}/source.pdf`;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class CustomerServiceSourcePdfConflictError extends Error {
  constructor() {
    super(
      "A different source PDF already exists for this request and cannot be replaced.",
    );
    this.name = "CustomerServiceSourcePdfConflictError";
  }
}

// An upload error may mean that a previous attempt already wrote the object.
// Recover only the exact same bytes. Never delete or overwrite this shared path:
// a concurrent finalizer may already have committed its stored_files reference.
export async function retainCustomerServiceSourcePdf<T>({
  file,
  alreadyAvailable,
  upload,
  download,
  finalize,
  expectedIdentity,
}: {
  file: File;
  alreadyAvailable: boolean;
  upload: (bytes: Uint8Array) => Promise<void>;
  download: () => Promise<Blob>;
  finalize: (sha256: string) => Promise<T>;
  expectedIdentity?: { sha256: string; sizeBytes: number; originalFilename: string } | null;
}): Promise<T> {
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  if (expectedIdentity && (sha256 !== expectedIdentity.sha256 || file.size !== expectedIdentity.sizeBytes
    || file.name.trim() !== expectedIdentity.originalFilename)) {
    throw new CustomerServiceSourcePdfConflictError();
  }

  if (!alreadyAvailable) {
    try {
      await upload(new Uint8Array(bytes));
    } catch (uploadError) {
      let existing: Blob;
      try {
        existing = await download();
      } catch {
        // Storage could not confirm whether the write succeeded. Keep the
        // original failure and leave any existing object untouched for retry.
        throw uploadError;
      }
      if (
        existing.size !== file.size ||
        await sha256Hex(await existing.arrayBuffer()) !== sha256
      ) {
        throw new CustomerServiceSourcePdfConflictError();
      }
    }
  }

  // This RPC is idempotent. A lost response leaves the immutable object intact;
  // the same file can finalize again on the next attempt, including AVAILABLE.
  return await finalize(sha256);
}

export function storageFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const normalized = detail.trim().replace(/\s+/g, " ");
  return (`Source PDF upload failed${normalized ? `: ${normalized}` : "."}`)
    .slice(0, 1000);
}
