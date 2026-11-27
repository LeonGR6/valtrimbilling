import type { serviceClient } from "./supabase.ts";
import { EmailAttachmentValidationError } from "./customerServiceEmailAttachments.ts";
import type { ImportAnalysisReceipt } from "./customerServiceEmailAnalysis.ts";
import {
  acceptedAnalysisAttachments,
  type ImageAnalysisAttachment,
} from "./customerServiceEmailAnalysisSources.ts";
import {
  createCustomerServiceMicrosoftGraph,
  MicrosoftGraphSyncError,
  validGraphId,
} from "./customerServiceMicrosoftGraph.ts";
import { EmailImportContinuation } from "./customerServiceEmailRuntime.ts";
import { assertEmailSourceWithoutBinary } from "./customerServiceEmailSourcePolicy.ts";

export type GraphImageCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};
const invalidOrigin = () =>
  new EmailAttachmentValidationError(
    "SOURCE_METADATA",
    "The image origin is unavailable or does not match the import.",
  );

// Only metadata is retained between calls. File bytes and the access token live
// within this invocation; Graph is contacted only for a missing image analysis.
export function graphImageDownloader(
  admin: ReturnType<typeof serviceClient>,
  receipt: ImportAnalysisReceipt,
  workerToken: string | undefined,
  options: {
    credentials?: GraphImageCredentials;
    fetcher?: typeof fetch;
    now?: () => number;
    deadline?: number;
  } = {},
) {
  const now = options.now ?? Date.now;
  let origin: {
    tenantId: string;
    mailboxId: string;
    folderId: string;
    messageId: string;
  } | undefined;
  let graph: ReturnType<typeof createCustomerServiceMicrosoftGraph> | undefined;
  return async (file: ImageAnalysisAttachment): Promise<Blob> => {
    if (!origin) {
      if (
        receipt.sourceContractVersion !== 2 || !receipt.sourceConnectionId ||
        !workerToken
      ) {
        throw invalidOrigin();
      }
      const { data, error } = await admin.rpc(
        "read_customer_service_graph_image_source",
        {
          p_import_id: receipt.id,
          p_worker_token: workerToken,
        },
      );
      if (error) throw error;
      assertEmailSourceWithoutBinary(data);
      const expected = acceptedAnalysisAttachments(receipt).filter((entry) =>
        entry.fileId === null
      )
        .map(({ fileId: _fileId, ...metadata }) => metadata);
      if (
        !data || data.importId !== receipt.id ||
        data.connectionId !== receipt.sourceConnectionId ||
        data.connectionAvailable !== true || !validGraphId(data.tenantId) ||
        !validGraphId(data.mailboxId) || !validGraphId(data.folderId) ||
        !validGraphId(data.messageId) ||
        !Array.isArray(data.images) || data.images.length !== expected.length ||
        expected.some((entry) =>
          !data.images.some((image: Record<string, unknown>) =>
            image && Object.keys(image).length === Object.keys(entry).length &&
            Object.entries(entry).every(([key, value]) => image[key] === value)
          )
        )
      ) {
        throw invalidOrigin();
      }
      if (data.retryNotBefore !== null) {
        const resumeAt = Date.parse(data.retryNotBefore);
        if (!Number.isFinite(resumeAt)) throw invalidOrigin();
        if (resumeAt > now()) {
          throw new EmailImportContinuation(
            Math.min(2_147_483_647, Math.ceil((resumeAt - now()) / 1000)),
          );
        }
      }
      if (
        !options.credentials || options.credentials.tenantId !== data.tenantId
      ) {
        throw new MicrosoftGraphSyncError("AUTH_FAILED");
      }
      graph = createCustomerServiceMicrosoftGraph({
        ...options.credentials,
        fetcher: options.fetcher,
        now,
        deadline: options.deadline,
      });
      origin = {
        tenantId: data.tenantId,
        mailboxId: data.mailboxId,
        folderId: data.folderId,
        messageId: data.messageId,
      };
    }
    try {
      const files = await graph!.files(origin, origin.messageId, [{
        "@odata.type": "#microsoft.graph.fileAttachment",
        id: file.attachmentId,
        name: file.originalFilename,
        contentType: file.mimeType,
        size: file.sizeBytes,
        isInline: file.isInline,
        contentId: file.contentId,
      }]);
      if (files.length !== 1 || files[0].id !== file.attachmentId) {
        throw invalidOrigin();
      }
      return files[0].file;
    } catch (error) {
      if (
        error instanceof MicrosoftGraphSyncError &&
        error.code === "SYNC_INTERRUPTED"
      ) throw new EmailImportContinuation();
      throw error;
    }
  };
}
