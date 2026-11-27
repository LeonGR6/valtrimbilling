import {
  EmailAttachmentValidationError,
  type EmailImportFileManifest,
  validateEmailImportAttachments,
} from "./customerServiceEmailAttachments.ts";
import type {
  createCustomerServiceEmailConnectionRepository,
  EmailConnectionState,
} from "./customerServiceEmailConnection.ts";
import type {
  EmailSyncResult,
  EmailSyncSourcePort,
} from "./customerServiceEmailSync.ts";
import {
  type createCustomerServiceMicrosoftGraph,
  graphEmailSource,
  MicrosoftGraphSyncError,
} from "./customerServiceMicrosoftGraph.ts";
import type { ImportSourceResult } from "./customerServiceEmailAttachments.ts";
import type { GraphSourceResult } from "./customerServiceGraphSourceStorage.ts";
import { assertEmailSourceWithoutBinary } from "./customerServiceEmailSourcePolicy.ts";

export type EmailSourceRecoveryInput = {
  importId: string;
  expectedUpdatedAt: string;
};
export type EmailSourceRecoveryReceipt = {
  importId: string;
  tenantId: string;
  mailboxId: string;
  messageId: string;
  sourceStatus: string;
  status: string;
  requestId: number | null;
  errorCode: string | null;
  source: Record<string, unknown>;
  manifest: Record<string, unknown>[] | null;
  sourceContractVersion: 1 | 2;
  sourceConnectionId: string | null;
};
export type EmailSourceRecoveryPort = {
  read: (importId: string) => Promise<EmailSourceRecoveryReceipt>;
  prepare: (
    connection: EmailConnectionState,
    input: EmailSourceRecoveryInput,
    source: Record<string, unknown>,
    files: EmailImportFileManifest[],
    contractVersion: 1 | 2,
  ) => Promise<ImportSourceResult | GraphSourceResult>;
};

// Explicit operation for an existing receipt, never a delta replay/cursor reset.
// Read and validate all bytes before the fenced SQL transaction reopens and pins.
export async function recoverCustomerServiceEmailSource(options: {
  connectionId: string;
  input: EmailSourceRecoveryInput;
  connections: ReturnType<
    typeof createCustomerServiceEmailConnectionRepository
  >;
  graph: Omit<ReturnType<typeof createCustomerServiceMicrosoftGraph>, "folderMessageIds">;
  sources: EmailSyncSourcePort;
  recovery: EmailSourceRecoveryPort;
  now?: () => number;
}): Promise<EmailSyncResult> {
  const { connectionId, input, connections, graph, sources, recovery } =
    options;
  const result: EmailSyncResult = {
    status: "IDLE",
    connectionId,
    retained: 0,
    replayed: 0,
    removed: 0,
    baselineSkipped: 0,
    importIds: [input.importId],
  };
  const configured = await connections.read(connectionId);
  if (configured.tenant_id.toLowerCase() !== graph.tenantId) {
    throw new MicrosoftGraphSyncError("AUTH_FAILED");
  }
  if (!configured.enabled) return result;
  if (
    !configured.initialized_at ||
    configured.last_error_code === "CURSOR_EXPIRED"
  ) {
    return {
      ...result,
      status: "RECOVERY_CONFLICT",
      errorCode: "CONNECTION_NOT_READY",
    };
  }
  const now = options.now ?? Date.now;
  if (
    configured.retry_not_before &&
    Date.parse(configured.retry_not_before) > now()
  ) {
    return {
      ...result,
      retryAfterSeconds: Math.ceil(
        (Date.parse(configured.retry_not_before) - now()) / 1000,
      ),
    };
  }
  const claimed = await connections.claim(connectionId);
  if (!claimed) return result;
  let outcome = result;
  let deferred = false;
  let pinned = false;
  let preparedHere = false;
  try {
    const receipt = await recovery.read(input.importId);
    if (
      receipt.importId !== input.importId ||
      receipt.tenantId !== claimed.tenant_id ||
      receipt.mailboxId !== claimed.mailbox_id
    ) {
      throw { code: "42501" };
    }
    if (
      receipt.requestId !== null ||
      ["AVAILABLE", "LEGACY"].includes(receipt.sourceStatus)
    ) {
      outcome = { ...result, status: "SOURCE_RECOVERED", replayed: 1 };
    } else {
      pinned = receipt.sourceStatus === "UPLOADING" &&
        receipt.manifest !== null;
      if (pinned && receipt.sourceContractVersion === 1 &&
        receipt.manifest!.some((file) => file.mimeType !== "application/pdf")) {
        throw new EmailAttachmentValidationError("HISTORICAL_IMAGES_REQUIRE_MANUAL_RECOVERY", "Pending legacy images require manual recovery.");
      }
      if (pinned && receipt.sourceContractVersion === 2 && receipt.sourceConnectionId !== claimed.id) {
        throw { code: "42501" };
      }
      if (
        !pinned &&
        (receipt.sourceStatus !== "REJECTED" ||
          receipt.status !== "NEEDS_ATTENTION" ||
          !["ATTACHMENT_SIZE", "ATTACHMENT_TOTAL_SIZE"].includes(
            receipt.errorCode ?? "",
          ))
      ) {
        throw { code: "55000" };
      }
      const target = {
        tenantId: claimed.tenant_id,
        mailboxId: claimed.mailbox_id,
        folderId: claimed.folder_id,
      };
      const source = pinned
        ? { ...receipt.source }
        : graphEmailSource(await graph.message(target, receipt.messageId));
      delete source.attachments;
      assertEmailSourceWithoutBinary(source);
      const metadata = pinned
        ? receipt.manifest!.map((file) => ({
          id: file.attachmentId as string,
          name: file.originalFilename as string,
          contentType: file.mimeType as string,
          size: file.sizeBytes as number,
          isInline: file.isInline as boolean,
          contentId: file.contentId as string | null,
          "@odata.type": "#microsoft.graph.fileAttachment",
        }))
        : await graph.attachments(target, receipt.messageId);
      const files = await graph.files(target, receipt.messageId, metadata);
      const manifest = await validateEmailImportAttachments(files);
      const contract = pinned ? receipt.sourceContractVersion : 2;
      const prepared = await recovery.prepare(claimed, input, source, manifest, contract);
      if (prepared.importId !== input.importId) {
        throw new Error("Recovery identity not confirmed");
      }
      if (
        prepared.requestId !== null || prepared.sourceStatus === "AVAILABLE"
      ) {
        outcome = { ...result, status: "SOURCE_RECOVERED", replayed: 1 };
      } else {
        if (prepared.sourceStatus !== "UPLOADING") {
          throw new Error("Recovery pin not confirmed");
        }
        pinned = true;
        preparedHere = true;
        const retained = await sources.retain(input.importId, source, files, claimed, contract);
        if (retained.importId !== input.importId) {
          throw new Error("Retained recovery identity not confirmed");
        }
        outcome = {
          ...result,
          status:
            retained.sourceStatus === "AVAILABLE" || retained.requestId !== null
              ? "SOURCE_RECOVERED"
              : "RECOVERY_REJECTED",
          retained: 1,
          errorCode: retained.errorCode,
        };
      }
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (preparedHere) {
      await sources.failPinned(input.importId).catch(() => undefined);
    }
    if (error instanceof MicrosoftGraphSyncError) {
      try {
        await connections.defer(claimed, error.code, error.retryAfterSeconds);
        deferred = true;
        outcome = {
          ...result,
          status: "FAILED",
          errorCode: error.code,
          retryAfterSeconds: error.retryAfterSeconds,
        };
      } catch {
        outcome = { ...result, status: "UNCONFIRMED" };
      }
    } else if (error instanceof EmailAttachmentValidationError) {
      // Validation happens before the version-fenced SQL prepare. A stale
      // operator command may read Graph, but cannot change a pending snapshot's
      // technical state merely because its new download failed validation.
      outcome = { ...result, status: "RECOVERY_REJECTED", errorCode: error.code };
    } else {
      outcome = {
        ...result,
        status: ["40001", "55000", "42501", "P0002"].includes(code ?? "")
          ? "RECOVERY_CONFLICT"
          : "UNCONFIRMED",
        errorCode: "RECOVERY_NOT_CONFIRMED",
      };
    }
  }
  if (!deferred) {
    try {
      await connections.finish(claimed);
    } catch {
      return { ...outcome, status: "UNCONFIRMED" };
    }
  }
  return outcome;
}
