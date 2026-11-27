import {
  type EmailImportFileManifest,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
  type PreparedImportFile,
} from "./customerServiceEmailAttachments.ts";
import { assertEmailSourceWithoutBinary } from "./customerServiceEmailSourcePolicy.ts";

export type StoredAnalysisAttachment = PreparedImportFile & {
  fileId: number;
  bucketId: string;
};
export type ImageAnalysisAttachment = EmailImportFileManifest & {
  retention: "GRAPH_ONLY";
  fileId: null;
};
export type AnalysisManifestFile = EmailImportFileManifest & {
  objectPath?: string;
  retention?: "GRAPH_ONLY" | "STORED";
};

export function acceptedAnalysisAttachments(receipt: {
  sourceContractVersion?: 1 | 2;
  sourceManifest: AnalysisManifestFile[];
  attachmentRefs: StoredAnalysisAttachment[];
}): Array<StoredAnalysisAttachment | ImageAnalysisAttachment> {
  const { sourceManifest: manifest, attachmentRefs: refs } = receipt;
  const v2 = receipt.sourceContractVersion === 2;
  if (
    !Array.isArray(manifest) || !Array.isArray(refs) ||
    manifest.length > MAX_IMPORT_ATTACHMENTS ||
    (!v2 && manifest.length !== refs.length) ||
    (v2 &&
      refs.length !==
        manifest.filter((file) => file.mimeType === "application/pdf").length)
  ) {
    throw new Error("The original attachment set is incomplete.");
  }
  assertEmailSourceWithoutBinary(manifest);
  assertEmailSourceWithoutBinary(refs);
  const ids = new Set<string>();
  let total = 0;
  const result = manifest.map(
    (expected): StoredAnalysisAttachment | ImageAnalysisAttachment => {
      if (
        !expected || typeof expected.attachmentId !== "string" ||
        !expected.attachmentId.trim() || ids.has(expected.attachmentId) ||
        !["application/pdf", "image/png", "image/jpeg"].includes(
          expected.mimeType,
        ) ||
        !Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 1 ||
        expected.sizeBytes > MAX_IMPORT_ATTACHMENT_BYTES ||
        typeof expected.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(expected.sha256)
      ) {
        throw new Error("The original attachment manifest is invalid.");
      }
      if (
        typeof expected.originalFilename !== "string" ||
        !expected.originalFilename.trim() ||
        typeof expected.isInline !== "boolean" ||
        (expected.contentId !== null && typeof expected.contentId !== "string")
      ) {
        throw new Error("The original attachment metadata is invalid.");
      }
      ids.add(expected.attachmentId);
      total += expected.sizeBytes;
      if (v2 && expected.mimeType !== "application/pdf") {
        if (
          expected.retention !== "GRAPH_ONLY" || "objectPath" in expected ||
          "fileId" in expected || "bucketId" in expected
        ) {
          throw new Error(
            "An unretained image cannot impersonate a stored file.",
          );
        }
        return { ...expected, retention: "GRAPH_ONLY", fileId: null };
      }
      const file = refs.find((file) =>
        file.attachmentId === expected.attachmentId
      );
      if (
        !file || (v2 && expected.retention !== "STORED") ||
        file.bucketId !== "customer-service-imports" ||
        !Number.isSafeInteger(file.fileId) || file.fileId < 1 ||
        typeof file.objectPath !== "string" ||
        !expected.objectPath ||
        Object.entries(expected).some(([key, value]) =>
          file[key as keyof typeof file] !== value
        )
      ) {
        throw new Error(
          "The original attachment references do not match their pinned manifest.",
        );
      }
      return file;
    },
  );
  if (
    total > MAX_IMPORT_TOTAL_BYTES ||
    new Set(refs.map((file) => file.attachmentId)).size !== refs.length
  ) {
    throw new Error(
      "The original attachment set exceeds its validated limits or contains duplicate references.",
    );
  }
  return result;
}
