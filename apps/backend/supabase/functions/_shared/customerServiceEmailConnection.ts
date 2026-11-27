// Server-side persistence adapter only. No env/credentials, Graph HTTP or timers.
import type { serviceClient } from "./supabase.ts";

export type InitialEmailSyncMode = "IMPORT_EXISTING" | "BASELINE_ONLY";
export type EmailSyncCursor = { kind: "NEXT" | "DELTA"; url: string };
export type EmailConnectionErrorCode =
  | "AUTH_FAILED"
  | "FORBIDDEN"
  | "FOLDER_NOT_FOUND"
  | "GRAPH_THROTTLED"
  | "GRAPH_UNAVAILABLE"
  | "CURSOR_EXPIRED"
  | "SYNC_INTERRUPTED"
  | "SYNC_ERROR";
export type EmailConnectionIdentity = {
  tenantId: string;
  mailboxId: string;
  folderId: string;
};
export type EmailConnectionState = {
  id: string;
  tenant_id: string;
  mailbox_id: string;
  folder_id: string;
  enabled: boolean;
  initial_sync_mode: InitialEmailSyncMode | null;
  initialized_at: string | null;
  cursor_kind: EmailSyncCursor["kind"] | null;
  cursor_url: string | null;
  revision: number;
  sync_token: string | null;
  sync_lease_expires_at: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_error_code: EmailConnectionErrorCode | null;
  last_error_message: string | null;
  last_error_at: string | null;
  retry_not_before?: string | null;
  created_at: string;
  updated_at: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function hasControlCharacters(value: string) {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error("Invalid email connection identity.");
  }
}
function mode(value: unknown): asserts value is InitialEmailSyncMode | null {
  if (
    value !== null && value !== "IMPORT_EXISTING" && value !== "BASELINE_ONLY"
  ) {
    throw new Error("Invalid initial email sync mode.");
  }
}
function identity(value: EmailConnectionIdentity) {
  uuid(value.tenantId);
  uuid(value.mailboxId);
  if (
    typeof value.folderId !== "string" ||
    value.folderId !== value.folderId.trim() ||
    !value.folderId.length || value.folderId.length > 2048 ||
    hasControlCharacters(value.folderId)
  ) {
    throw new Error("Invalid email folder identity.");
  }
}

// Compare resource identities without rewriting the opaque URL. Graph may use
// either /mailFolders/ID or the equivalent OData /mailFolders('ID') key segment.
// Split before decoding so an encoded slash remains inside its one opaque ID.
export function graphMailFolderPathSegments(pathname: string): string[] {
  const parts = pathname.split("/").map(decodeURIComponent);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid Graph resource path.");
  }
  const key = /^mailFolders\('((?:[^']|'')+)'\)$/.exec(parts[4] ?? "");
  if (key) parts.splice(4, 1, "mailFolders", key[1].replace(/''/g, "'"));
  return parts;
}

// Preserve the FULL opaque link, but never follow it across hosts or folders.
// The HTTP client validates again before every request and forbids redirects.
export function validateEmailSyncCursor(
  target: EmailConnectionIdentity,
  cursor: EmailSyncCursor,
): EmailSyncCursor {
  identity(target);
  if (
    !cursor || !["NEXT", "DELTA"].includes(cursor.kind) ||
    typeof cursor.url !== "string" ||
    cursor.url.length > 16384 ||
    /[\s#\\]/.test(cursor.url) || hasControlCharacters(cursor.url) ||
    !cursor.url.startsWith("https://graph.microsoft.com/v1.0/users/")
  ) {
    throw new Error("Invalid Graph cursor.");
  }
  let url: URL;
  let segments: string[];
  try {
    url = new URL(cursor.url);
    segments = graphMailFolderPathSegments(
      cursor.url.slice("https://graph.microsoft.com".length).split("?")[0],
    );
  } catch {
    throw new Error("Invalid Graph cursor.");
  }
  if (
    url.origin !== "https://graph.microsoft.com" || url.username ||
    url.password || url.hash ||
    segments.length !== 8 || segments[1] !== "v1.0" ||
    segments[2] !== "users" ||
    segments[3] !== target.mailboxId.toLowerCase() ||
    segments[4] !== "mailFolders" ||
    segments[5] !== target.folderId || segments[6] !== "messages" ||
    segments[7] !== "delta"
  ) {
    throw new Error(
      "Graph cursor must belong to the configured mailbox and folder.",
    );
  }
  const expected = cursor.kind === "NEXT" ? "$skiptoken" : "$deltatoken";
  const other = cursor.kind === "NEXT" ? "$deltatoken" : "$skiptoken";
  if (
    url.searchParams.getAll(expected).length !== 1 ||
    !url.searchParams.get(expected) ||
    url.searchParams.has(other)
  ) throw new Error("Graph cursor kind and continuation token must agree.");
  return { kind: cursor.kind, url: cursor.url };
}

function state(value: unknown): EmailConnectionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Email connection state was not confirmed.");
  }
  const row = value as EmailConnectionState;
  uuid(row.id);
  identity({
    tenantId: row.tenant_id,
    mailboxId: row.mailbox_id,
    folderId: row.folder_id,
  });
  mode(row.initial_sync_mode);
  if (
    typeof row.enabled !== "boolean" ||
    row.enabled && row.initial_sync_mode === null ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 ||
    (row.cursor_kind === null) !== (row.cursor_url === null) ||
    (row.sync_token === null) !== (row.sync_lease_expires_at === null)
  ) {
    throw new Error("Email connection state was not confirmed.");
  }
  if (row.sync_token !== null) uuid(row.sync_token);
  if (row.cursor_kind !== null) {
    validateEmailSyncCursor(
      {
        tenantId: row.tenant_id,
        mailboxId: row.mailbox_id,
        folderId: row.folder_id,
      },
      { kind: row.cursor_kind, url: row.cursor_url! },
    );
  }
  for (
    const field of [
      "created_at",
      "updated_at",
      "initialized_at",
      "sync_lease_expires_at",
      "last_attempt_at",
      "last_finished_at",
      "last_success_at",
      "last_error_at",
      ...(row.retry_not_before !== undefined
        ? ["retry_not_before" as const]
        : []),
    ] as const
  ) {
    if (
      (field === "created_at" || field === "updated_at" ||
        row[field] !== null) &&
      (typeof row[field] !== "string" ||
        !Number.isFinite(Date.parse(row[field]!)))
    ) {
      throw new Error("Email connection timestamps were not confirmed.");
    }
  }
  return row;
}

export function createCustomerServiceEmailConnectionRepository(
  admin: Pick<ReturnType<typeof serviceClient>, "rpc">,
) {
  async function rpc(
    name: string,
    args: Record<string, unknown>,
    expectedId?: string,
  ) {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw error;
    if (data === null && name === "claim_customer_service_email_sync") {
      return null;
    }
    const result = state(data);
    if (expectedId && result.id !== expectedId.toLowerCase()) {
      throw new Error("Email connection identity was not confirmed.");
    }
    return result;
  }
  function version(row: EmailConnectionState) {
    state(row);
    return { p_connection_id: row.id, p_expected_revision: row.revision };
  }
  function reservation(row: EmailConnectionState) {
    const expected = version(row);
    if (!row.sync_token || !row.enabled) {
      throw new Error("An email sync reservation is required.");
    }
    return { ...expected, p_sync_token: row.sync_token };
  }
  return {
    async register(
      target: EmailConnectionIdentity,
      initialMode: InitialEmailSyncMode | null = null,
    ) {
      identity(target);
      mode(initialMode);
      const result = (await rpc("register_customer_service_email_connection", {
        p_tenant_id: target.tenantId,
        p_mailbox_id: target.mailboxId,
        p_folder_id: target.folderId,
        p_initial_sync_mode: initialMode,
      }))!;
      if (
        result.tenant_id !== target.tenantId.toLowerCase() ||
        result.mailbox_id !== target.mailboxId.toLowerCase() ||
        result.folder_id !== target.folderId
      ) throw new Error("Email connection identity was not confirmed.");
      return result;
    },
    async read(connectionId: string) {
      uuid(connectionId);
      return (await rpc("read_customer_service_email_connection", {
        p_connection_id: connectionId,
      }, connectionId))!;
    },
    async configure(
      row: EmailConnectionState,
      enabled: boolean,
      initialMode: InitialEmailSyncMode | null = null,
    ) {
      mode(initialMode);
      if (typeof enabled !== "boolean") {
        throw new Error("Explicit email connection activation is required.");
      }
      return (await rpc("configure_customer_service_email_connection", {
        ...version(row),
        p_enabled: enabled,
        p_initial_sync_mode: initialMode,
      }, row.id))!;
    },
    async claim(connectionId: string) {
      uuid(connectionId);
      const result = await rpc("claim_customer_service_email_sync", {
        p_connection_id: connectionId,
      }, connectionId);
      if (result && (!result.sync_token || !result.enabled)) {
        throw new Error("Email sync reservation was not confirmed.");
      }
      return result;
    },
    async checkpoint(
      row: EmailConnectionState,
      cursor: EmailSyncCursor,
      importIds: string[] = [],
      baselineMessageIds?: string[],
      removedMessageIds: string[] = [],
    ) {
      const reserved = reservation(row);
      const checked = validateEmailSyncCursor(
        {
          tenantId: row.tenant_id,
          mailboxId: row.mailbox_id,
          folderId: row.folder_id,
        },
        cursor,
      );
      if (!Array.isArray(importIds) || importIds.length > 1000) {
        throw new Error("Invalid page import identities.");
      }
      importIds.forEach(uuid);
      for (const values of [baselineMessageIds ?? [], removedMessageIds]) {
        if (
          !Array.isArray(values) || values.length > 1000 ||
          values.some((id) =>
            typeof id !== "string" || !id.trim() || id !== id.trim() ||
            new TextEncoder().encode(id).length > 2048
          )
        ) throw new Error("Invalid page message identities.");
      }
      return (await rpc(
        baselineMessageIds === undefined
          ? "checkpoint_customer_service_email_sync"
          : "checkpoint_customer_service_email_graph_page",
        {
          ...reserved,
          p_cursor_kind: checked.kind,
          p_cursor_url: checked.url,
          p_import_ids: importIds,
          ...(baselineMessageIds === undefined ? {} : {
            p_baseline_message_ids: baselineMessageIds,
            p_removed_message_ids: removedMessageIds,
          }),
        },
        row.id,
      ))!;
    },
    async baselineMatches(row: EmailConnectionState, messageIds: string[]) {
      if (
        !Array.isArray(messageIds) || messageIds.length > 1000 ||
        messageIds.some((id) =>
          typeof id !== "string" || !id.trim() || id !== id.trim()
        )
      ) throw new Error("Invalid page message identities.");
      const { data, error } = await admin.rpc(
        "read_customer_service_email_baseline_matches",
        { ...reservation(row), p_message_ids: messageIds },
      );
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.some((id) => typeof id !== "string" || !messageIds.includes(id))
      ) throw new Error("Baseline membership was not confirmed.");
      return data as string[];
    },
    async resolvedMatches(row: EmailConnectionState, messageIds: string[]) {
      if (
        !Array.isArray(messageIds) || messageIds.length > 1000 ||
        messageIds.some((id) =>
          typeof id !== "string" || !id.trim() || id !== id.trim() ||
          new TextEncoder().encode(id).length > 2048 ||
          hasControlCharacters(id)
        )
      ) throw new Error("Invalid page message identities.");
      const { data, error } = await admin.rpc(
        "read_customer_service_email_resolved_matches",
        { ...reservation(row), p_message_ids: messageIds },
      );
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.some((id) => typeof id !== "string" || !messageIds.includes(id)) ||
        new Set(data).size !== data.length
      ) throw new Error("Resolved message membership was not confirmed.");
      return data as string[];
    },
    async finish(
      row: EmailConnectionState,
      errorCode: EmailConnectionErrorCode | null = null,
    ) {
      // SQL accepts only known codes and creates a fixed message, never raw errors.
      return (await rpc("finish_customer_service_email_sync", {
        ...reservation(row),
        p_error_code: errorCode,
      }, row.id))!;
    },
    async defer(
      row: EmailConnectionState,
      errorCode: EmailConnectionErrorCode,
      retryAfterSeconds: number,
    ) {
      if (
        !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0 ||
        retryAfterSeconds > 2_147_483_647
      ) {
        throw new Error("Invalid Graph retry delay.");
      }
      return (await rpc("defer_customer_service_email_sync", {
        ...reservation(row),
        p_error_code: errorCode,
        p_retry_after_seconds: retryAfterSeconds,
      }, row.id))!;
    },
  };
}
