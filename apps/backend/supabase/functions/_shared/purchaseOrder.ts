import {
  isOlsonVendorNotice,
  parseOlsonVendorNotices,
} from "./purchaseOrderOlson.ts";
import { PurchaseOrderError } from "./purchaseOrderTypes.ts";
import type { ParsedPurchaseOrder } from "./purchaseOrderTypes.ts";
import type { PageContent } from "./releaseTypes.ts";

// Entry point of Purchase Order (options) analysis. Each builder sends its own
// layout with the same information, so every layout is a parser that returns the
// same ParsedPurchaseOrder. A parser recognizes its layout by what the text says,
// and the first one that does reads the document. A new builder is a new entry
// here and nothing else changes.

interface PurchaseOrderParser {
  recognizes(pages: PageContent[]): boolean;
  parse(pages: PageContent[]): ParsedPurchaseOrder;
}

const PARSERS: PurchaseOrderParser[] = [
  { recognizes: isOlsonVendorNotice, parse: parseOlsonVendorNotices },
];

export function parsePurchaseOrder(pages: PageContent[]): ParsedPurchaseOrder {
  const textLength = pages.reduce(
    (sum, page) =>
      sum + page.runs.reduce((runs, run) => runs + run.text.trim().length, 0),
    0,
  );
  if (textLength < 20) {
    throw new PurchaseOrderError(
      "no_text",
      "This PDF has no readable text. Purchase Orders must be digital PDFs.",
    );
  }

  const parser = PARSERS.find((candidate) => candidate.recognizes(pages));
  if (!parser) {
    throw new PurchaseOrderError(
      "unrecognized_layout",
      "This Purchase Order has a layout that is not supported yet.",
    );
  }

  const parsed = parser.parse(pages);
  if (parsed.workOrders.length === 0) {
    throw new PurchaseOrderError(
      "unrecognized_layout",
      "No work orders were found in this Purchase Order.",
    );
  }
  return parsed;
}
