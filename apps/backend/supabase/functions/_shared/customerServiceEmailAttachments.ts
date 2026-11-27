import { sha256Hex } from "./customerServiceSourcePdf.ts";

// Decimal MB for the email contract. Do not change the existing manual PDF limit.
export const CUSTOMER_SERVICE_IMPORT_BUCKET = "customer-service-imports";
export const MAX_IMPORT_ATTACHMENT_BYTES = 10_000_000;
export const MAX_IMPORT_ATTACHMENTS = 10;
export const MAX_IMPORT_TOTAL_BYTES = 50_000_000;

export interface EmailImportAttachment {
  id: string;
  file: File;
  isInline?: boolean;
  contentId?: string | null;
  attachmentType?: "file" | "item" | "reference";
  declaredSize?: number;
}

export interface EmailImportFileManifest {
  attachmentId: string;
  originalFilename: string;
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  sha256: string;
  isInline: boolean;
  contentId: string | null;
}

export interface PreparedImportFile extends EmailImportFileManifest {
  objectPath: string;
}

export interface ImportSourceResult {
  importId: string;
  sourceStatus: string;
  status: string;
  requestId: number | null;
  idempotentReplay?: boolean;
  attachments?: PreparedImportFile[];
  errorCode?: string;
  errorMessage?: string;
}

export class EmailAttachmentValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EmailAttachmentValidationError";
  }
}

class EmailImportObjectConflictError extends Error {
  constructor() {
    super(
      "A stored file does not match the email. It was not replaced; manual review is required.",
    );
    this.name = "EmailImportObjectConflictError";
  }
}

function invalid(code: string, message: string): never {
  throw new EmailAttachmentValidationError(code, message);
}

function mimeType(file: File): EmailImportFileManifest["mimeType"] {
  const extension = file.name.toLowerCase().match(/\.(pdf|jpe?g|png)$/)?.[1];
  const expected = extension === "pdf"
    ? "application/pdf"
    : extension === "png"
    ? "image/png"
    : extension
    ? "image/jpeg"
    : null;
  const declared = file.type.toLowerCase();
  if (
    !expected ||
    (declared && declared !== "application/octet-stream" &&
      declared !== expected)
  ) {
    invalid(
      "ATTACHMENT_FORMAT",
      `The file ${file.name} is not a supported PDF, JPG/JPEG or PNG.`,
    );
  }
  return expected;
}

function validSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === "application/pdf") {
    return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  }
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
}

// All metadata and signatures are checked before the caller may write any file.
// Inline images count too. Sorting opaque attachment IDs gives retries a stable
// manifest even if the provider returns attachments in a different order.
export async function validateEmailImportAttachments(
  attachments: EmailImportAttachment[],
): Promise<EmailImportFileManifest[]> {
  if (!Array.isArray(attachments)) {
    invalid("ATTACHMENT_METADATA", "The attachment list is invalid.");
  }
  if (attachments.length > MAX_IMPORT_ATTACHMENTS) {
    invalid(
      "ATTACHMENT_COUNT",
      "The email exceeds the maximum of 10 files, including inline images.",
    );
  }
  const identities = new Set<string>();
  let totalBytes = 0;
  const typed = Array.from(attachments, (attachment) => {
    if (
      !attachment || typeof attachment.id !== "string" ||
      !attachment.id.trim() || attachment.id !== attachment.id.trim() ||
      !(attachment.file instanceof File) || identities.has(attachment.id) ||
      (attachment.isInline !== undefined &&
        typeof attachment.isInline !== "boolean") ||
      (attachment.contentId !== undefined && attachment.contentId !== null &&
        typeof attachment.contentId !== "string")
    ) {
      invalid(
        "ATTACHMENT_METADATA",
        "Attachments require a unique identity and valid metadata.",
      );
    }
    identities.add(attachment.id);
    if (
      attachment.attachmentType !== undefined &&
      attachment.attachmentType !== "file"
    ) {
      invalid(
        "ATTACHMENT_FORMAT",
        "The email contains an embedded or linked attachment that cannot be imported as a file.",
      );
    }
    const file = attachment.file;
    const filenameCharacters = [...file.name];
    if (
      !file.name.trim() || filenameCharacters.length > 255 ||
      filenameCharacters.some((character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      )
    ) {
      invalid(
        "ATTACHMENT_METADATA",
        "The file name must be 1 to 255 characters with no control characters.",
      );
    }
    const type = mimeType(file);
    if (file.size === 0 || file.size > MAX_IMPORT_ATTACHMENT_BYTES) {
      invalid(
        "ATTACHMENT_SIZE",
        `The file ${file.name} is empty or exceeds 10 MB.`,
      );
    }
    if (
      attachment.declaredSize !== undefined &&
      attachment.declaredSize !== file.size
    ) {
      invalid(
        "ATTACHMENT_SIZE",
        `The downloaded size of ${file.name} does not match the size reported by the email.`,
      );
    }
    totalBytes += file.size;
    return { attachment, type };
  });
  if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
    invalid(
      "ATTACHMENT_TOTAL_SIZE",
      "The email attachments exceed 50 MB in total.",
    );
  }
  typed.sort((a, b) =>
    a.attachment.id < b.attachment.id
      ? -1
      : a.attachment.id > b.attachment.id
      ? 1
      : 0
  );
  const manifest: EmailImportFileManifest[] = [];
  for (const { attachment, type } of typed) {
    const bytes = await attachment.file.arrayBuffer();
    if (
      !validSignature(
        new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength)),
        type,
      )
    ) {
      invalid(
        "ATTACHMENT_SIGNATURE",
        `El contenido de ${attachment.file.name} no coincide con su formato.`,
      );
    }
    manifest.push({
      attachmentId: attachment.id,
      originalFilename: attachment.file.name,
      mimeType: type,
      sizeBytes: attachment.file.size,
      sha256: await sha256Hex(bytes),
      isInline: attachment.isInline ?? false,
      contentId: attachment.contentId ?? null,
    });
  }
  return manifest;
}

export interface EmailImportSourcePort {
  prepare: (
    source: Record<string, unknown>,
    files: EmailImportFileManifest[],
  ) => Promise<ImportSourceResult>;
  reject: (code: string, message: string) => Promise<ImportSourceResult>;
  upload: (object: PreparedImportFile, file: File) => Promise<void>;
  download: (object: PreparedImportFile) => Promise<Blob>;
  finalize: () => Promise<ImportSourceResult>;
  fail: (message: string) => Promise<ImportSourceResult>;
}

// No request creation or AI here. A valid set can leave immutable staged objects
// after an infrastructure interruption; the pinned manifest lets the same retry
// recover them. Never delete an object: a concurrent finalizer may have committed.
export async function retainEmailImportSource({
  source,
  attachments,
  port,
}: {
  source: Record<string, unknown>;
  attachments: EmailImportAttachment[];
  port: EmailImportSourcePort;
}): Promise<ImportSourceResult> {
  let manifest: EmailImportFileManifest[];
  try {
    manifest = await validateEmailImportAttachments(attachments);
  } catch (error) {
    if (!(error instanceof EmailAttachmentValidationError)) throw error;
    // Keep only the technical receipt. Do not write source body or valid files.
    return await port.reject(error.code, error.message);
  }
  const prepared = await port.prepare(source, manifest);
  if (prepared.sourceStatus !== "UPLOADING") return prepared;
  const files = new Map(
    attachments.map((attachment) => [attachment.id, attachment.file]),
  );
  try {
    if (
      !prepared.attachments || prepared.attachments.length !== manifest.length
    ) {
      throw new Error(
        "The server did not return the complete pinned attachment manifest.",
      );
    }
    for (const object of prepared.attachments) {
      const file = files.get(object.attachmentId);
      if (!file) {
        throw new Error("An attachment is missing from the prepared source.");
      }
      try {
        await port.upload(object, file);
      } catch (uploadError) {
        let existing: Blob;
        try {
          existing = await port.download(object);
        } catch {
          throw uploadError;
        }
        if (
          existing.size !== object.sizeBytes ||
          await sha256Hex(await existing.arrayBuffer()) !== object.sha256
        ) {
          throw new EmailImportObjectConflictError();
        }
      }
    }
    return await port.finalize();
  } catch (error) {
    // Do not persist SDK errors that may contain signed URLs, credentials or
    // provider payloads. The RPC preserves AVAILABLE after a lost response.
    return await port.fail(
      error instanceof EmailImportObjectConflictError
        ? error.message
        : "Private storage could not be completed. Retry the same email; no request was created.",
    );
  }
}
