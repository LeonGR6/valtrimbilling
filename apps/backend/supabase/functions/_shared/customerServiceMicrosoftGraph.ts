import {
  EmailAttachmentValidationError,
  type EmailImportAttachment,
  MAX_IMPORT_ATTACHMENT_BYTES,
  MAX_IMPORT_ATTACHMENTS,
  MAX_IMPORT_TOTAL_BYTES,
} from "./customerServiceEmailAttachments.ts";
import {
  type EmailConnectionErrorCode,
  type EmailConnectionIdentity,
  type EmailSyncCursor,
  graphMailFolderPathSegments,
  validateEmailSyncCursor,
} from "./customerServiceEmailConnection.ts";
import { containsEmailBinary, assertEmailSourceWithoutBinary } from "./customerServiceEmailSourcePolicy.ts";

export class MicrosoftGraphSyncError extends Error {
  constructor(
    readonly code: EmailConnectionErrorCode,
    readonly retryAfterSeconds = 0,
  ) {
    // Never retain the provider's raw error, URL, token or response body.
    super(code);
  }
}

export type GraphMessage = Record<string, unknown> & { id: string };
export type GraphDeltaPage = {
  messages: GraphMessage[];
  cursor: EmailSyncCursor;
};
export type GraphAttachmentMetadata = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId?: string | null;
  "@odata.type": string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const graphOrigin = "https://graph.microsoft.com";
const jsonLimit = 16 * 1024 * 1024; // Transport protection; never truncate a source.

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasControls(value: string) {
  return [...value].some((character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
  );
}
export function validGraphId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    new TextEncoder().encode(value).length <= 2048 &&
    value === value.trim() && !hasControls(value) &&
    value !== "." && value !== "..";
}
function sourceError(message: string): never {
  throw new EmailAttachmentValidationError("SOURCE_METADATA", message);
}
function sameResource(url: string, expectedPath: string) {
  try {
    if (/[\s\\#]/.test(url) || hasControls(url)) throw new Error();
    const parsed = new URL(url);
    const actual = graphMailFolderPathSegments(
      url.slice(graphOrigin.length).split("?")[0],
    );
    const expected = graphMailFolderPathSegments(expectedPath);
    if (
      !url.startsWith(`${graphOrigin}/`) || parsed.origin !== graphOrigin ||
      parsed.username || parsed.password ||
      actual.length !== expected.length ||
      actual.some((part, index) => part !== expected[index])
    ) throw new Error();
  } catch {
    throw new MicrosoftGraphSyncError("SYNC_ERROR");
  }
}
function retryAfter(response: Response, now: number): number {
  const value = response.headers.get("retry-after");
  const seconds = value && /^\d+$/.test(value)
    ? Number(value)
    : value
    ? Math.ceil((Date.parse(value) - now) / 1000)
    : 60;
  return Number.isFinite(seconds)
    ? Math.min(2_147_483_647, Math.max(1, Math.ceil(seconds)))
    : 60;
}
async function readBytes(
  response: Response,
  maximum: number,
  overflow: () => never,
) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        overflow();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Keep only the fields accepted by the existing immutable-source RPC. The delta
// receipt is metadata only; body and files are pinned together after validation.
export function graphEmailSource(message: GraphMessage, includeBody = true) {
  const source: Record<string, unknown> = {};
  function metadata(key: string, value: unknown) {
    if (value === undefined) return;
    if ((value !== null && typeof value !== "string") || containsEmailBinary(value)) {
      if (includeBody) sourceError("Microsoft devolvió cabeceras no válidas para conservar como texto.");
      return; // The initial receipt keeps only safe, typed technical metadata.
    }
    source[key] = value;
  }
  function recipient(value: unknown): unknown {
    if (typeof value === "string" || value === null) {
      if (containsEmailBinary(value)) throw new Error("Invalid address.");
      return value;
    }
    if (!object(value) || !object(value.emailAddress)) throw new Error("Invalid address.");
    const address: Record<string, unknown> = {};
    for (const key of ["name", "address"]) {
      const part = value.emailAddress[key];
      if (part === undefined) continue;
      if ((part !== null && typeof part !== "string") || containsEmailBinary(part)) throw new Error("Invalid address.");
      address[key] = part;
    }
    return { emailAddress: address };
  }
  for (
    const key of [
      "subject",
      "sentDateTime",
      "receivedDateTime",
      "internetMessageId",
      "conversationId",
      "webLink",
    ]
  ) {
    metadata(key, message[key]);
  }
  if (message.from !== undefined) {
    try { source.from = recipient(message.from); } catch {
      if (includeBody) sourceError("Microsoft devolvió un remitente no válido para conservar como texto.");
    }
  }
  if (includeBody) {
    for (const key of ["toRecipients", "ccRecipients", "bccRecipients"]) {
      if (message[key] === undefined) continue;
      if (!Array.isArray(message[key])) sourceError("Microsoft devolvió una lista de destinatarios no válida.");
      try { source[key] = message[key].map(recipient); } catch { sourceError("Microsoft devolvió destinatarios no válidos para conservar como texto."); }
    }
    if (
      !object(message.body) || typeof message.body.content !== "string" ||
      !["text", "html"].includes(String(message.body.contentType).toLowerCase())
    ) sourceError("Microsoft no devolvió el cuerpo completo del correo.");
    source.body = {
      contentType: String(message.body.contentType).toLowerCase(),
      content: message.body.content,
    };
    assertEmailSourceWithoutBinary(source);
  }
  return source;
}

export function validateGraphAttachmentMetadata(
  value: unknown[],
): GraphAttachmentMetadata[] {
  if (value.length > MAX_IMPORT_ATTACHMENTS) {
    throw new EmailAttachmentValidationError(
      "ATTACHMENT_COUNT",
      "El correo supera 10 archivos, incluyendo imágenes inline.",
    );
  }
  const seen = new Set<string>();
  for (const raw of value) {
    if (
      !object(raw) || !validGraphId(raw.id) || seen.has(raw.id) ||
      typeof raw.name !== "string" || !raw.name.trim() ||
      [...raw.name].length > 255 ||
      hasControls(raw.name) ||
      typeof raw.contentType !== "string" ||
      typeof raw.isInline !== "boolean" ||
      !Number.isSafeInteger(raw.size) || (raw.size as number) < 0 ||
      (raw.contentId != null && typeof raw.contentId !== "string")
    ) {
      throw new EmailAttachmentValidationError(
        "ATTACHMENT_METADATA",
        "Microsoft devolvió metadatos de adjuntos incompletos o contradictorios.",
      );
    }
    seen.add(raw.id);
    const extension = raw.name.toLowerCase().match(/\.(pdf|jpe?g|png)$/)?.[1];
    const expected = extension === "pdf"
      ? "application/pdf"
      : extension === "png"
      ? "image/png"
      : extension
      ? "image/jpeg"
      : null;
    if (
      raw["@odata.type"] !== "#microsoft.graph.fileAttachment" || !expected ||
      (raw.contentType &&
        raw.contentType.toLowerCase() !== "application/octet-stream" &&
        raw.contentType.toLowerCase() !== expected)
    ) {
      throw new EmailAttachmentValidationError(
        "ATTACHMENT_FORMAT",
        "El correo contiene un archivo no admitido, un elemento de Outlook o un vínculo externo.",
      );
    }
  }
  // Graph's metadata size can differ from the raw /$value download. Enforce the
  // business limits on streamed file bytes, never on this reported size.
  return value as GraphAttachmentMetadata[];
}

export function createCustomerServiceMicrosoftGraph(options: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
  now?: () => number;
  deadline?: number;
  requestTimeoutMs?: number;
}) {
  if (
    !uuid.test(options.tenantId) || !uuid.test(options.clientId) ||
    !options.clientSecret.trim()
  ) {
    throw new MicrosoftGraphSyncError("AUTH_FAILED");
  }
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let accessToken = "";
  let expiresAt = 0;
  // Timers cover the response body as well as headers. No auto redirect, sleeps,
  // remote image access, mailbox write or retry storm occurs in this client.
  async function bounded<T>(
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const remaining = Math.min(
      options.requestTimeoutMs ?? 20_000,
      (options.deadline ?? Infinity) - now(),
    );
    if (remaining <= 0) throw new MicrosoftGraphSyncError("SYNC_INTERRUPTED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      return await run(controller.signal);
    } catch (error) {
      if (
        error instanceof MicrosoftGraphSyncError ||
        error instanceof EmailAttachmentValidationError
      ) throw error;
      const interrupted = now() >= (options.deadline ?? Infinity);
      throw new MicrosoftGraphSyncError(
        interrupted ? "SYNC_INTERRUPTED" : "GRAPH_UNAVAILABLE",
        interrupted ? 0 : 60,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async function token(refresh = false) {
    if (!refresh && accessToken && expiresAt > now() + 30_000) {
      return accessToken;
    }
    await bounded(async (signal) => {
      const response = await fetcher(
        `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`,
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            scope: `${graphOrigin}/.default`,
            grant_type: "client_credentials",
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new MicrosoftGraphSyncError(
          response.status === 429
            ? "GRAPH_THROTTLED"
            : response.status >= 500
            ? "GRAPH_UNAVAILABLE"
            : "AUTH_FAILED",
          response.status === 429 || response.status >= 500
            ? retryAfter(response, now())
            : 0,
        );
      }
      const bytes = await readBytes(response, 64_000, () => {
        throw new MicrosoftGraphSyncError("AUTH_FAILED");
      });
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new MicrosoftGraphSyncError("AUTH_FAILED");
      }
      if (
        !object(value) || typeof value.access_token !== "string" ||
        !value.access_token ||
        String(value.token_type).toLowerCase() !== "bearer" ||
        typeof value.expires_in !== "number" ||
        !Number.isFinite(value.expires_in) || value.expires_in <= 0
      ) {
        throw new MicrosoftGraphSyncError("AUTH_FAILED");
      }
      accessToken = value.access_token;
      expiresAt = now() + value.expires_in * 1000;
    });
    return accessToken;
  }
  async function request(
    url: string,
    path: string,
    kind: "delta" | "source",
    remainingAttachmentBytes?: number,
  ) {
    const attachmentDownload = remainingAttachmentBytes !== undefined;
    const maximum = attachmentDownload
      ? Math.min(MAX_IMPORT_ATTACHMENT_BYTES, remainingAttachmentBytes)
      : jsonLimit;
    const overflow = (): never => {
      if (attachmentDownload) {
        throw new EmailAttachmentValidationError(
          remainingAttachmentBytes < MAX_IMPORT_ATTACHMENT_BYTES
            ? "ATTACHMENT_TOTAL_SIZE"
            : "ATTACHMENT_SIZE",
          remainingAttachmentBytes < MAX_IMPORT_ATTACHMENT_BYTES
            ? "Los adjuntos descargados superan 50 MB en total."
            : "Un adjunto descargado supera 10 MB.",
        );
      }
      if (kind === "source") {
        sourceError(
          "No se pudo leer el correo completo dentro de la capacidad de transporte. No se recortó su contenido; requiere recuperación manual.",
        );
      }
      throw new MicrosoftGraphSyncError("SYNC_ERROR");
    };
    sameResource(url, path); // Before acquiring/sending any credential.
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await token(attempt === 1);
      const result = await bounded(async (signal) => {
        const response = await fetcher(url, {
          method: "GET",
          redirect: "error",
          signal,
          headers: {
            Authorization: `Bearer ${bearer}`,
            Prefer: 'IdType="ImmutableId"',
            Accept: attachmentDownload
              ? "application/octet-stream"
              : "application/json",
          },
        });
        if (response.status === 401 && attempt === 0) {
          await response.body?.cancel();
          return null;
        }
        if (!response.ok) {
          let providerCode = "";
          if ([400, 404, 410].includes(response.status)) {
            try {
              const errorBytes = await readBytes(response, 64_000, () => {
                throw new MicrosoftGraphSyncError("SYNC_ERROR");
              });
              providerCode = String(
                JSON.parse(new TextDecoder().decode(errorBytes))?.error?.code ??
                  "",
              ).toLowerCase();
            } catch {
              /* Only the status is needed; never expose raw diagnostics. */
            }
          } else await response.body?.cancel();
          if (
            kind === "delta" &&
            (response.status === 410 ||
              ["syncstatenotfound", "invaliddeltatoken", "resyncrequired"]
                .includes(providerCode))
          ) throw new MicrosoftGraphSyncError("CURSOR_EXPIRED");
          if (response.status === 401) {
            throw new MicrosoftGraphSyncError("AUTH_FAILED");
          }
          if (response.status === 403) {
            throw new MicrosoftGraphSyncError("FORBIDDEN");
          }
          if (response.status === 429) {
            throw new MicrosoftGraphSyncError(
              "GRAPH_THROTTLED",
              retryAfter(response, now()),
            );
          }
          if (response.status >= 500 || response.status === 408) {
            throw new MicrosoftGraphSyncError(
              "GRAPH_UNAVAILABLE",
              retryAfter(response, now()),
            );
          }
          if (kind === "delta" && response.status === 404) {
            throw new MicrosoftGraphSyncError("FOLDER_NOT_FOUND");
          }
          if (
            kind === "source" &&
            [400, 404, 410, 413, 415].includes(response.status)
          ) {
            sourceError(
              "El correo o uno de sus adjuntos no está disponible para su lectura completa en Microsoft.",
            );
          }
          throw new MicrosoftGraphSyncError("SYNC_ERROR");
        }
        let contentLength: number | null = null;
        if (attachmentDownload) {
          if (
            response.status !== 200 || response.headers.has("content-range")
          ) {
            await response.body?.cancel();
            throw new EmailAttachmentValidationError(
              "ATTACHMENT_SIZE",
              "Microsoft no devolvió una descarga completa del adjunto.",
            );
          }
          // Content-Length describes transport bytes. Compare it to the body
          // only without content encoding; fetch may decompress encoded bodies.
          const encoding = response.headers.get("content-encoding")?.trim()
            .toLowerCase();
          const header = response.headers.get("content-length");
          if ((!encoding || encoding === "identity") && header !== null) {
            contentLength = Number(header);
            if (!/^\d+$/.test(header) || !Number.isSafeInteger(contentLength)) {
              await response.body?.cancel();
              throw new EmailAttachmentValidationError(
                "ATTACHMENT_SIZE",
                "Microsoft devolvió una longitud de descarga no válida.",
              );
            }
            if (contentLength > maximum) {
              await response.body?.cancel();
              overflow();
            }
          }
        }
        const bytes = await readBytes(response, maximum, overflow);
        if (contentLength !== null && bytes.byteLength !== contentLength) {
          throw new EmailAttachmentValidationError(
            "ATTACHMENT_SIZE",
            "El tamaño descargado no coincide con Content-Length de la respuesta de Microsoft.",
          );
        }
        return bytes;
      });
      if (result !== null) return result;
    }
    throw new MicrosoftGraphSyncError("AUTH_FAILED");
  }
  async function json(url: string, path: string, kind: "delta" | "source") {
    const bytes = await request(url, path, kind);
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!object(value)) throw new Error();
      return value;
    } catch {
      if (kind === "source") {
        sourceError(
          "Microsoft no devolvió una fuente completa que pueda interpretarse. Requiere recuperación manual.",
        );
      }
      throw new MicrosoftGraphSyncError("SYNC_ERROR");
    }
  }
  function folderPath(target: EmailConnectionIdentity) {
    if (
      target.tenantId.toLowerCase() !== options.tenantId.toLowerCase() ||
      !uuid.test(target.mailboxId) || !validGraphId(target.folderId)
    ) throw new MicrosoftGraphSyncError("AUTH_FAILED");
    return `/v1.0/users/${target.mailboxId.toLowerCase()}/mailFolders/${
      encodeURIComponent(target.folderId)
    }/messages`;
  }
  function messagePath(target: EmailConnectionIdentity, id: string) {
    if (!validGraphId(id)) throw new MicrosoftGraphSyncError("SYNC_ERROR");
    return `${folderPath(target)}/${encodeURIComponent(id)}`;
  }
  return {
    tenantId: options.tenantId.toLowerCase(),
    // An independent, metadata-only inventory. Never a substitute delta cursor.
    async folderMessageIds(target: EmailConnectionIdentity, nextUrl: string | null = null) {
      const path = folderPath(target);
      const url = nextUrl ?? `${graphOrigin}${path}?$select=id,webLink,subject,from,receivedDateTime&$top=100`;
      const validate = (candidate: string) => {
        sameResource(candidate, path);
        if (candidate.length > 16384) throw new MicrosoftGraphSyncError("SYNC_ERROR");
        const params = new URL(candidate).searchParams;
        if ([...params.keys()].some((key) => !["$select", "$top", "$skip", "$skiptoken"].includes(key)) ||
          (params.has("$select") && !["id", "id,webLink", "id,webLink,subject,from,receivedDateTime"].includes(params.get("$select")!)) ||
          params.getAll("$skip").length + params.getAll("$skiptoken").length > 1) {
          throw new MicrosoftGraphSyncError("SYNC_ERROR");
        }
      };
      validate(url);
      const value = await json(url, path, "source");
      if (!Array.isArray(value.value) || value.value.length > 1000 ||
        value.value.some((entry) => !object(entry) || !validGraphId(entry.id)) ||
        (value["@odata.nextLink"] !== undefined && typeof value["@odata.nextLink"] !== "string")) {
        throw new MicrosoftGraphSyncError("SYNC_ERROR");
      }
      const next = value["@odata.nextLink"] as string | undefined;
      if (next) {
        validate(next);
        if (next === url) throw new MicrosoftGraphSyncError("SYNC_ERROR");
      }
      const messageMetadata: { messageId: string;subject: string | null;sender: string | null;receivedAt: string | null }[] = [];
      const header = (value: unknown): string | null => typeof value === "string" && value.length <= 1000 &&
          !hasControls(value) && !containsEmailBinary(value) ? value : null;
      for (const entry of value.value as GraphMessage[]) {
        if (!["subject","from","receivedDateTime"].some((key) => Object.hasOwn(entry,key))) continue;
        const source = graphEmailSource(entry,false);
        const from = source.from;
        const address = object(from) && object(from.emailAddress) ? from.emailAddress : null;
        const sender = typeof from === "string" ? from : address
          ? [header(address.name),header(address.address)].filter(Boolean).join(" · ") : null;
        const date = source.receivedDateTime;
        messageMetadata.push({ messageId: entry.id,subject: header(source.subject),sender: header(sender),
          receivedAt: typeof date === "string" && date.length <= 80 && Number.isFinite(Date.parse(date)) ? date : null });
      }
      const webLinks: Record<string,string> = {};
      for (const entry of value.value as GraphMessage[]) {
        const link = entry.webLink;
        if (typeof link !== "string" || link.length > 8192 || /[\s\\]/.test(link) || hasControls(link) || containsEmailBinary(link)) continue;
        try {
          const parsed = new URL(link);
          if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
            ["outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft", "outlook.live.com"].includes(parsed.hostname)) webLinks[entry.id] = parsed.href;
        } catch { /* Missing/invalid original links never become executable UI. */ }
      }
      return { messageIds: value.value.map((entry) => (entry as GraphMessage).id), webLinks, messageMetadata,nextUrl: next ?? null };
    },
    async page(
      target: EmailConnectionIdentity,
      cursor: EmailSyncCursor | null,
    ): Promise<GraphDeltaPage> {
      const path = `${folderPath(target)}/delta`;
      const url = cursor
        ? validateEmailSyncCursor(target, cursor).url
        : `${graphOrigin}${path}?changeType=created&$select=id,webLink,subject,from,sentDateTime,receivedDateTime,internetMessageId,conversationId&$top=1`;
      const value = await json(url, path, "delta");
      if (
        !Array.isArray(value.value) || value.value.length > 1000 ||
        Boolean(value["@odata.nextLink"]) === Boolean(value["@odata.deltaLink"])
      ) throw new MicrosoftGraphSyncError("SYNC_ERROR");
      const next: EmailSyncCursor = {
        kind: value["@odata.nextLink"] ? "NEXT" : "DELTA",
        url: (value["@odata.nextLink"] ?? value["@odata.deltaLink"]) as string,
      };
      validateEmailSyncCursor(target, next);
      if (next.kind === "NEXT" && next.url === url) {
        throw new MicrosoftGraphSyncError("SYNC_ERROR");
      }
      for (const entry of value.value) {
        if (
          !object(entry) || !validGraphId(entry.id) ||
          ("@removed" in entry &&
            (!object(entry["@removed"]) ||
              entry["@removed"].reason !== "deleted"))
        ) throw new MicrosoftGraphSyncError("SYNC_ERROR");
      }
      return { messages: value.value as GraphMessage[], cursor: next };
    },
    async message(
      target: EmailConnectionIdentity,
      id: string,
    ): Promise<GraphMessage> {
      const path = messagePath(target, id);
      const value = await json(
        `${graphOrigin}${path}?$select=id,parentFolderId,subject,from,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,internetMessageId,conversationId,webLink,body`,
        path,
        "source",
      );
      if (value.id !== id || value.parentFolderId !== target.folderId) {
        sourceError(
          "El mensaje recibido no coincide con el correo y la carpeta configurados.",
        );
      }
      return value as GraphMessage;
    },
    async attachments(
      target: EmailConnectionIdentity,
      id: string,
    ): Promise<GraphAttachmentMetadata[]> {
      const path = `${messagePath(target, id)}/attachments`;
      let url: string | null =
        `${graphOrigin}${path}?$select=id,name,contentType,size,isInline`;
      const seen = new Set<string>();
      const files: unknown[] = [];
      // Always enumerate: hasAttachments=false does not rule out inline images.
      while (url) {
        if (seen.has(url)) throw new MicrosoftGraphSyncError("SYNC_ERROR");
        seen.add(url);
        const value = await json(url, path, "source");
        if (!Array.isArray(value.value)) {
          throw new MicrosoftGraphSyncError("SYNC_ERROR");
        }
        if (value.value.length > MAX_IMPORT_ATTACHMENTS - files.length) {
          throw new EmailAttachmentValidationError(
            "ATTACHMENT_COUNT",
            "El correo supera 10 archivos, incluyendo imágenes inline.",
          );
        }
        files.push(...value.value);
        validateGraphAttachmentMetadata(files);
        const next = value["@odata.nextLink"];
        if (next !== undefined && typeof next !== "string") {
          throw new MicrosoftGraphSyncError("SYNC_ERROR");
        }
        url = next as string | undefined ?? null;
        if (url) sameResource(url, path);
      }
      return validateGraphAttachmentMetadata(files);
    },
    async files(
      target: EmailConnectionIdentity,
      id: string,
      metadata: GraphAttachmentMetadata[],
    ): Promise<EmailImportAttachment[]> {
      validateGraphAttachmentMetadata(metadata);
      const files: EmailImportAttachment[] = [];
      let totalBytes = 0;
      for (const attachment of metadata) {
        const path = `${messagePath(target, id)}/attachments/${
          encodeURIComponent(attachment.id)
        }/$value`;
        const bytes = await request(
          `${graphOrigin}${path}`,
          path,
          "source",
          MAX_IMPORT_TOTAL_BYTES - totalBytes,
        );
        if (bytes.byteLength === 0) {
          throw new EmailAttachmentValidationError(
            "ATTACHMENT_SIZE",
            "Un adjunto descargado está vacío.",
          );
        }
        totalBytes += bytes.byteLength;
        files.push({
          id: attachment.id,
          file: new File([bytes], attachment.name, {
            type: attachment.contentType,
          }),
          isInline: attachment.isInline,
          contentId: attachment.contentId ?? null,
          attachmentType: "file",
          // Do not pass Graph's reported size as a raw file-length assertion.
          // The shared validator still checks actual size, signature and hash.
        });
      }
      return files;
    },
  };
}
