import type { serviceClient } from "./supabase.ts";
import {
  CUSTOMER_SERVICE_IMPORT_BUCKET,
  type EmailImportAttachment,
  type EmailImportSourcePort,
  type ImportSourceResult,
  retainEmailImportSource,
} from "./customerServiceEmailAttachments.ts";

type ImportServiceClient = ReturnType<typeof serviceClient>;

// Server-only adapter for the future processor/Graph worker. Pass a client with
// service credentials and no human JWT, never one created by the browser.
export function customerServiceEmailImportStorage(
  admin: ImportServiceClient,
  importId: string,
): EmailImportSourcePort {
  const bucket = admin.storage.from(CUSTOMER_SERVICE_IMPORT_BUCKET);
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await admin.rpc(name, {
      p_import_id: importId,
      ...args,
    });
    if (error) throw error;
    if (!data) throw new Error("Missing email source operation result.");
    return data as ImportSourceResult;
  }
  return {
    prepare: (source, files) =>
      rpc("prepare_customer_service_import_source", {
        p_source_payload: source,
        p_attachments: files,
      }),
    reject: (code, message) =>
      rpc("reject_customer_service_import_source", {
        p_error_code: code,
        p_error_message: message,
      }),
    upload: async (object, file) => {
      // The SDK sends Blob/File bodies as multipart and takes the MIME from the
      // file itself, not contentType. Preserve bytes, using the validated manifest
      // type for Graph files reported as octet-stream or without a MIME.
      const uploadFile = file.type === object.mimeType
        ? file
        : new File([file], file.name, {
          type: object.mimeType,
          lastModified: file.lastModified,
        });
      const { error } = await bucket.upload(object.objectPath, uploadFile, {
        contentType: object.mimeType,
        upsert: false,
      });
      if (error) throw error;
    },
    download: async (object) => {
      const { data, error } = await bucket.download(object.objectPath);
      if (error || !data) throw error ?? new Error("Missing import object.");
      return data;
    },
    finalize: () => rpc("finalize_customer_service_import_source"),
    fail: (message) =>
      rpc("fail_customer_service_import_source", { p_error_message: message }),
  };
}

export function persistCustomerServiceEmailSource(
  admin: ImportServiceClient,
  importId: string,
  source: Record<string, unknown>,
  attachments: EmailImportAttachment[],
) {
  return retainEmailImportSource({
    source,
    attachments,
    port: customerServiceEmailImportStorage(admin, importId),
  });
}
