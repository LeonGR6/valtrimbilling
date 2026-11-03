import type { serviceClient } from "./supabase.ts";
import { persistCustomerServiceEmailSource } from "./customerServiceEmailImportStorage.ts";
import { graphEmailSource } from "./customerServiceMicrosoftGraph.ts";
import type {
  EmailSyncReceipt,
  EmailSyncSourcePort,
} from "./customerServiceEmailSync.ts";
import type { ImportSourceResult } from "./customerServiceEmailAttachments.ts";
import { graphSourceStorage, retainGraphEmailSource } from "./customerServiceGraphSourceStorage.ts";
import { assertEmailSourceWithoutBinary, containsEmailBinary } from "./customerServiceEmailSourcePolicy.ts";

export function customerServiceEmailSyncStorage(
  admin: ReturnType<typeof serviceClient>,
): EmailSyncSourcePort {
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw error;
    if (!data) throw new Error("Email receipt was not confirmed.");
    return data;
  }
  return {
    async register(target, message): Promise<EmailSyncReceipt> {
      const registered = await rpc("register_customer_service_email_import", {
        p_tenant_id: target.tenantId,
        p_mailbox_id: target.mailboxId,
        p_provider_message_id: message.id,
        p_source_payload: graphEmailSource(message, false),
      });
      const { data: row, error } = await admin.from("service_request_imports")
        .select(
          "id,tenant_id,mailbox_id,provider_message_id,source_status,status,request_id,source_payload,source_manifest,source_contract_version,source_connection_id",
        )
        .eq("id", registered.importId).maybeSingle();
      if (error) throw error;
      if (
        !row || row.id !== registered.importId ||
        row.tenant_id !== target.tenantId ||
        row.mailbox_id !== target.mailboxId ||
        row.provider_message_id !== message.id ||
        typeof row.source_status !== "string" || typeof row.status !== "string" ||
        ![1, 2].includes(row.source_contract_version) ||
        (row.source_contract_version === 2 && typeof row.source_connection_id !== "string")
      ) throw new Error("Email receipt identity was not confirmed.");
      return {
        importId: row.id,
        sourceStatus: row.source_status,
        status: row.status,
        requestId: row.request_id,
        source: row.source_payload,
        manifest: row.source_manifest,
        sourceContractVersion: row.source_contract_version,
        sourceConnectionId: row.source_connection_id,
      };
    },
    retain: (importId, source, files, connection, version) => {
      assertEmailSourceWithoutBinary(source);
      if (version === 1) {
        // Only an already pinned PDF-only V1 snapshot may use this branch.
        // Existing SQL verifies its exact immutable manifest; never fall back
        // here when a V2 RPC is missing or fails.
        if (files.some((attachment) => !/\.pdf$/i.test(attachment.file.name))) {
          throw new Error("Historical image sources require manual recovery.");
        }
        return persistCustomerServiceEmailSource(admin, importId, source, files);
      }
      return retainGraphEmailSource({ importId, source, attachments: files,
        port: graphSourceStorage(admin, importId, connection) });
    },
    reject: async (importId, code, message) =>
      await rpc("reject_customer_service_import_source", {
        p_import_id: importId,
        p_error_code: code,
        p_error_message: containsEmailBinary(message)
          ? "El correo o sus adjuntos contienen datos binarios en metadatos; requiere recuperación manual."
          : message,
      }) as ImportSourceResult,
    failPinned: async (importId, reason) =>
      await rpc("fail_customer_service_import_source", {
        p_import_id: importId,
        p_error_message: reason === "LEGACY_IMAGES"
          ? "El correo tiene imágenes fijadas con el contrato histórico. Se conservaron sus archivos y manifiesto; requiere recuperación manual. No se subieron imágenes nuevas."
          : "No se pudo recuperar el conjunto original de archivos ya fijado. Revisa el correo y completa la recuperación manual.",
      }) as ImportSourceResult,
  };
}
