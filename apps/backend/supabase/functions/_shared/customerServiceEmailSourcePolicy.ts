import { EmailAttachmentValidationError } from "./customerServiceEmailAttachments.ts";

// Same transport signatures rejected by the V2 SQL contract. This is a guard
// against copying provider payloads, not a serializer for arbitrary provider data.
export function containsEmailBinary(value: unknown): boolean {
  if (
    value instanceof Blob || value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) return true;
  if (typeof value === "string") {
    return /data:[^,\s]*;base64\s*,/i.test(value) ||
      /(^|[^A-Za-z0-9+/])(iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/]{32,}={0,2}/.test(
        value,
      );
  }
  if (Array.isArray(value)) return value.some(containsEmailBinary);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, part]) =>
      [
        "contentbytes",
        "imageurl",
        "base64",
        "imagebase64",
        "bytes",
        "binary",
        "buffer",
        "arraybuffer",
        "blob",
      ].includes(key.toLowerCase().replaceAll("_", "")) ||
      containsEmailBinary(part)
    );
  }
  return false;
}

export function assertEmailSourceWithoutBinary(value: unknown): void {
  if (containsEmailBinary(value)) {
    throw new EmailAttachmentValidationError(
      "SOURCE_METADATA",
      "El correo contiene contenido binario incrustado que no puede conservarse como texto. Requiere recuperación manual; no se guardó su cuerpo ni sus archivos.",
    );
  }
}

export function emailImportUsageCounters(
  value: unknown,
): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const counters = Object.fromEntries(
    Object.entries(value).filter(([key, count]) =>
      [
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "pages_processed",
        "doc_size_bytes",
      ].includes(key) &&
      Number.isSafeInteger(count) && (count as number) >= 0
    ),
  );
  return Object.keys(counters).length ? counters : null;
}
