import type { serviceClient } from "./supabase.ts";
import type { EmailSourceRecoveryPort } from "./customerServiceEmailSourceRecovery.ts";
import { EmailAttachmentValidationError } from "./customerServiceEmailAttachments.ts";

export function customerServiceEmailSourceRecoveryStorage(
  admin: ReturnType<typeof serviceClient>,
): EmailSourceRecoveryPort {
  return {
    async read(importId) {
      const { data: row, error } = await admin.from("service_request_imports")
        .select(
          "id,tenant_id,mailbox_id,provider_message_id,source_status,status,request_id,error_code,source_payload,source_manifest,source_contract_version,source_connection_id",
        ).eq("id", importId).maybeSingle();
      if (error) throw error;
      if (!row || row.id !== importId) throw { code: "P0002" };
      if (![1, 2].includes(row.source_contract_version) ||
        (row.source_contract_version === 2 && typeof row.source_connection_id !== "string")) throw new Error("Unconfirmed source contract.");
      return {
        importId: row.id,
        tenantId: row.tenant_id,
        mailboxId: row.mailbox_id,
        messageId: row.provider_message_id,
        sourceStatus: row.source_status,
        status: row.status,
        requestId: row.request_id,
        errorCode: row.error_code,
        source: row.source_payload,
        manifest: row.source_manifest,
        sourceContractVersion: row.source_contract_version,
        sourceConnectionId: row.source_connection_id,
      };
    },
    async prepare(row, input, source, files, version) {
      const { data, error } = await admin.rpc(
        version === 1 ? "prepare_customer_service_graph_source_recovery" : "prepare_customer_service_graph_source_recovery_v2",
        {
          p_connection_id: row.id,
          p_sync_token: row.sync_token,
          p_expected_revision: row.revision,
          p_import_id: input.importId,
          p_expected_updated_at: input.expectedUpdatedAt,
          p_source_payload: source,
          p_attachments: files,
        },
      );
      if (error) {
        if (error.code === "55000" && error.message === "The pinned original email source cannot be replaced") {
          throw new EmailAttachmentValidationError("SOURCE_METADATA", "The recovered attachment does not match the original manifest; manual review is required.");
        }
        throw error;
      }
      if (!data) throw new Error("Source recovery was not confirmed");
      return data;
    },
  };
}
