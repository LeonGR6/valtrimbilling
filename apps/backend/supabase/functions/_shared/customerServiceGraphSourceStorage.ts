import type { serviceClient } from "./supabase.ts";
import type { EmailConnectionState } from "./customerServiceEmailConnection.ts";
import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
  type EmailImportFileManifest,
  type ImportSourceResult,
  type PreparedImportFile,
  validateEmailImportAttachments,
} from "./customerServiceEmailAttachments.ts";
import { customerServiceEmailImportStorage } from "./customerServiceEmailImportStorage.ts";
import { assertEmailSourceWithoutBinary } from "./customerServiceEmailSourcePolicy.ts";
import { sha256Hex } from "./customerServiceSourcePdf.ts";

export type GraphSourceFile = EmailImportFileManifest & {
  retention: "GRAPH_ONLY" | "STORED";
  objectPath?: string;
};
export type GraphSourceResult = Omit<ImportSourceResult, "attachments"> & {
  sourceContractVersion?: number;
  attachments?: GraphSourceFile[];
};
export type GraphSourcePort = {
  prepare: (
    source: Record<string, unknown>,
    files: EmailImportFileManifest[],
  ) => Promise<GraphSourceResult>;
  upload: (object: PreparedImportFile, file: File) => Promise<void>;
  download: (object: PreparedImportFile) => Promise<Blob>;
  finalize: () => Promise<GraphSourceResult>;
  fail: (message: string) => Promise<GraphSourceResult>;
};

// Compare the COMPLETE returned manifest before any upload. SQL paths/retention
// are not trusted merely because they were returned with a successful HTTP code.
function storedPdfs(
  importId: string,
  manifest: EmailImportFileManifest[],
  prepared: GraphSourceResult,
): PreparedImportFile[] {
  if (
    prepared.sourceContractVersion !== 2 ||
    !Array.isArray(prepared.attachments) ||
    prepared.attachments.length !== manifest.length
  ) throw new Error("Unconfirmed V2 source manifest.");
  return manifest.flatMap((expected, index) => {
    const actual = prepared.attachments![index];
    const pdf = expected.mimeType === "application/pdf";
    const path = `imports/${importId}/${
      String(index + 1).padStart(2, "0")
    }-${expected.sha256}.pdf`;
    const allowed = [
      ...Object.keys(expected),
      "retention",
      ...(pdf ? ["objectPath"] : []),
    ];
    if (
      !actual || Object.keys(actual).some((key) => !allowed.includes(key)) ||
      Object.entries(expected).some(([key, value]) =>
        actual[key as keyof GraphSourceFile] !== value
      ) ||
      actual.retention !== (pdf ? "STORED" : "GRAPH_ONLY") ||
      (pdf ? actual.objectPath !== path : "objectPath" in actual)
    ) {
      throw new Error("Unconfirmed V2 source identity or retention policy.");
    }
    return pdf ? [{ ...expected, objectPath: path }] : [];
  });
}

export async function retainGraphEmailSource(options: {
  importId: string;
  source: Record<string, unknown>;
  attachments: EmailImportAttachment[];
  port: GraphSourcePort;
}): Promise<GraphSourceResult> {
  const { importId, source, attachments, port } = options;
  // All bytes, formats and hashes are validated, including inline images, before
  // the first SQL pin or PDF upload. Image File/Blob objects never enter a JSON RPC.
  const manifest = await validateEmailImportAttachments(attachments);
  assertEmailSourceWithoutBinary(source);
  assertEmailSourceWithoutBinary(manifest);
  let prepared: GraphSourceResult;
  try {
    prepared = await port.prepare(source, manifest);
  } catch (error) {
    if ((error as { code?: string })?.code === "22023") {
      throw new EmailAttachmentValidationError(
        "SOURCE_METADATA",
        "The complete source does not meet the import contract without stored images.",
      );
    }
    if (
      (error as { code?: string; message?: string })?.code === "55000" &&
      (error as { message?: string }).message ===
        "The pinned original email source cannot be replaced"
    ) {
      throw new EmailAttachmentValidationError(
        "SOURCE_METADATA",
        "The recovered attachment does not match the original manifest; manual review is required.",
      );
    }
    throw error; // Lost responses/leases are reconciled, never downgraded to V1.
  }
  if (prepared.importId !== importId) {
    throw new Error("Source import identity was not confirmed.");
  }
  if (prepared.requestId !== null || prepared.sourceStatus !== "UPLOADING") return prepared;
  try {
    const pdfs = storedPdfs(importId, manifest, prepared);
    const files = new Map(
      attachments.map((attachment) => [attachment.id, attachment.file]),
    );
    for (const pdf of pdfs) {
      const file = files.get(pdf.attachmentId);
      if (!file) throw new Error("Missing validated PDF.");
      try {
        await port.upload(pdf, file);
      } catch (uploadError) {
        let existing: Blob;
        try {
          existing = await port.download(pdf);
        } catch {
          throw uploadError;
        }
        if (
          existing.size !== pdf.sizeBytes ||
          await sha256Hex(await existing.arrayBuffer()) !== pdf.sha256
        ) {
          throw new Error("Stored PDF does not match the pinned original.");
        }
      }
    }
    const result = await port.finalize();
    if (result.importId !== importId) {
      throw new Error("Source finalization identity was not confirmed.");
    }
    return result;
  } catch {
    // Includes a lost finalizer response. SQL keeps an already AVAILABLE source.
    // Never log SDK/provider responses, signed URLs or image transport payloads.
    return await port.fail(
      "The email and its PDFs could not be prepared. The manifest was kept; retry the same import.",
    );
  }
}

export function graphSourceStorage(
  admin: ReturnType<typeof serviceClient>,
  importId: string,
  connection: EmailConnectionState,
): GraphSourcePort {
  const stored = customerServiceEmailImportStorage(admin, importId);
  return {
    prepare: async (source, files) => {
      const { data, error } = await admin.rpc(
        "prepare_customer_service_graph_source_v2",
        {
          p_connection_id: connection.id,
          p_sync_token: connection.sync_token,
          p_expected_revision: connection.revision,
          p_import_id: importId,
          p_source_payload: source,
          p_attachments: files,
        },
      );
      if (error) throw error;
      if (!data) throw new Error("Missing V2 prepare response.");
      return data as GraphSourceResult;
    },
    upload: (object, file) => {
      if (object.mimeType !== "application/pdf") {
        throw new Error("Graph images must never be uploaded.");
      }
      return stored.upload(object, file);
    },
    download: stored.download,
    finalize: stored.finalize as GraphSourcePort["finalize"],
    fail: stored.fail as GraphSourcePort["fail"],
  };
}
