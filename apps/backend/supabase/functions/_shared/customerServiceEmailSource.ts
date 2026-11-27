import { Parser } from "htmlparser2";
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

export interface EmailTextPart {
  id: string;
  kind: "EMAIL" | "PDF_FIELDS";
  text: string;
  start: number;
  end: number;
}

// Parsing is local and inert. Neither remote images/styles nor script code are
// evaluated or downloaded. Keep line/table boundaries and decoded entities.
export function emailHtmlToText(html: string): string {
  const output: string[] = [];
  const ignored = new Set([
    "script",
    "style",
    "head",
    "iframe",
    "object",
    "template",
  ]);
  const blocks = new Set([
    "p",
    "div",
    "br",
    "tr",
    "li",
    "blockquote",
    "hr",
    "section",
    "h1",
    "h2",
    "h3",
    "h4",
    "pre",
  ]);
  const stack: boolean[] = [];
  let hiddenDepth = 0;
  const parser = new Parser({
    onopentag(name, attributes) {
      const hidden = hiddenDepth > 0 || ignored.has(name);
      stack.push(hidden);
      if (hidden) hiddenDepth++;
      if (!hidden && blocks.has(name)) output.push("\n");
      if (!hidden && (name === "td" || name === "th")) output.push("\t");
      if (!hidden && name === "img" && attributes.alt) {
        output.push(` ${attributes.alt} `);
      }
      if (
        !hidden && name === "a" &&
        /^(mailto:|tel:)/i.test(attributes.href ?? "")
      ) {
        const value =
          attributes.href.replace(/^(mailto:|tel:)/i, "").split("?")[0];
        try {
          output.push(` ${decodeURIComponent(value)} `);
        } catch {
          output.push(` ${value} `);
        }
      }
    },
    onclosetag(name) {
      const hidden = stack.pop() ?? false;
      if (hidden) hiddenDepth--;
      if (!hidden && blocks.has(name)) output.push("\n");
    },
    ontext(text) {
      if (!hiddenDepth) output.push(text);
    },
  }, { decodeEntities: true });
  parser.end(html);
  return output.join("").replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mailbox(value: unknown): string {
  if (typeof value === "string") return value;
  const person = record(record(value)?.emailAddress);
  return [person?.name, person?.address].filter((part) =>
    typeof part === "string"
  ).join(" ");
}

// 32k is a transport chunk, NOT an email-size rule. No suffix is discarded and
// exact offsets are retained, including when a single paragraph is very long.
export function splitEmailSourceText(
  text: string,
  prefix: string,
  kind: EmailTextPart["kind"] = "EMAIL",
  chunkSize = 32_000,
): EmailTextPart[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 2 || chunkSize > 40_000) {
    throw new Error("Invalid extraction chunk size.");
  }
  const parts: EmailTextPart[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const line = text.lastIndexOf("\n", end);
      if (line > start + chunkSize / 2) end = line + 1;
      // Never split a Unicode surrogate pair.
      if (
        text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
      ) end--;
    }
    parts.push({
      id: `${prefix}:${parts.length + 1}`,
      kind,
      text: text.slice(start, end),
      start,
      end,
    });
    start = end;
  }
  return parts;
}

export function emailSourceTextParts(
  source: Record<string, unknown>,
): EmailTextPart[] {
  const variants = new Map<string, string>();
  function add(key: string, value: unknown, html = false) {
    if (value == null) return;
    if (typeof value !== "string") throw new Error("Email body must be text.");
    const text = (html ? emailHtmlToText(value) : value).replace(/\r\n?/g, "\n")
      .trim();
    if (text && ![...variants.values()].includes(text)) variants.set(key, text);
  }
  add("text", source.bodyText);
  add("html", source.bodyHtml, true);
  if (source.body != null) {
    const body = record(source.body);
    if (
      !body ||
      !["html", "text"].includes(String(body.contentType).toLowerCase())
    ) throw new Error("Unknown email body format.");
    add(
      "body",
      body.content,
      String(body.contentType).toLowerCase() === "html",
    );
  }
  const header = [
    mailbox(source.from) ? `From: ${mailbox(source.from)}` : "",
    Array.isArray(source.toRecipients)
      ? `To: ${source.toRecipients.map(mailbox).join("; ")}`
      : "",
    typeof source.subject === "string" ? `Subject: ${source.subject}` : "",
    typeof source.sentDateTime === "string"
      ? `Sent: ${source.sentDateTime}`
      : "",
  ].filter(Boolean).join("\n");
  // Headers are also analyzed if the body is empty. Distinct HTML/plain versions
  // are retained, rather than assuming they contain the same information.
  if (!variants.size && header) variants.set("headers", "");
  return [...variants].flatMap(([key, body]) =>
    splitEmailSourceText(
      [header, body].filter(Boolean).join("\n\n"),
      `email:${key}`,
    )
  );
}

export interface PdfFormValue {
  name: string;
  type: string;
  value: string | string[] | boolean | null;
}

export async function readPdfFormValues(
  bytes: ArrayBuffer,
): Promise<{ fields: PdfFormValue[]; pageCount: number }> {
  const pdf = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  if (pdf.getPageCount() < 1) throw new Error("PDF has no pages.");
  // getForm() removes XFA internally. Detect it before calling that method so
  // unsupported source values are never silently discarded, even in memory.
  const acroForm = pdf.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (acroForm?.has(PDFName.of("XFA"))) {
    throw new Error("XFA forms require manual review.");
  }
  const form = pdf.getForm();
  if (form.hasXFA()) throw new Error("XFA forms require manual review.");
  const fields = form.getFields().map((field): PdfFormValue => {
    let value: PdfFormValue["value"] = null;
    if (field instanceof PDFTextField) value = field.getText() ?? "";
    // isChecked() depends on widget appearances and can report false for a
    // checked field without widgets. /V is the authoritative stored value.
    else if (field instanceof PDFCheckBox) {
      value = field.acroField.getValue().decodeText() !== "Off";
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      value = field.getSelected();
    } else if (field instanceof PDFRadioGroup) {
      value = field.getSelected() ?? null;
    }
    return { name: field.getName(), type: field.constructor.name, value };
  });
  return { fields, pageCount: pdf.getPageCount() };
}
