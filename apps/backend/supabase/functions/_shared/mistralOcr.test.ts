import { assertEquals, assertRejects } from "@std/assert";
import {
  extractEmailTextWithMistral,
  extractPdfWithMistral,
  MAX_CUSTOMER_SERVICE_EMAIL_TEXT_CHARACTERS,
  MAX_CUSTOMER_SERVICE_PDF_BYTES,
  MistralOcrError,
  validateCustomerServiceEmailText,
  validateCustomerServicePdf,
} from "./mistralOcr.ts";

function pdfFile(
  name = "customer-service.pdf",
  type = "application/pdf",
) {
  return new File(["%PDF-1.7\nTest document"], name, { type });
}

function structuredExtraction() {
  return {
    schemaVersion: "1.0",
    document: {
      documentType: "WORK_ORDER",
      issuerName: "Example Builder",
      documentTitle: "Warranty Work Order",
      workOrderNumbers: ["WO-100"],
      orderDate: "2026-09-10",
      scheduledDate: null,
      sourceEmailSentDate: null,
      sourceEmailFrom: null,
      sourceEmailSubject: null,
    },
    property: {
      builderName: null,
      communityName: "Example Community",
      lotNumber: "000250",
      model: null,
      address: {
        street: "100 Example Lane",
        unit: null,
        city: "Arcadia",
        state: "CA",
        postalCode: "91006",
        formatted: "100 Example Lane, Arcadia, CA 91006",
      },
      coordinates: { raw: null, latitude: null, longitude: null },
    },
    contacts: [],
    serviceItems: [
      {
        sourceItemNumber: "1",
        description: "Door is getting stuck.",
        requestedAction: null,
        location: "Primary bedroom",
        assignedVendor: "Valtrim Inc.",
        assignedToValtrim: true,
        sourceCategory: "Hardware",
        suggestedServiceKind: "Adjustment",
        suggestedWorkType: "Hardware",
        suggestedServiceTask: "GENERAL_FIX",
        sourcePage: 1,
        reviewReasons: [],
      },
    ],
    warnings: ["Coordinates were not present in the document."],
  };
}

Deno.test("accepts a small PDF with a valid file signature", async () => {
  assertEquals(await validateCustomerServicePdf(pdfFile()), null);
});

Deno.test("rejects unsupported, empty, oversized and fake PDF files", async () => {
  assertEquals(
    await validateCustomerServicePdf(
      new File(["plain text"], "request.txt", { type: "text/plain" }),
    ),
    "Select a PDF file.",
  );
  assertEquals(
    await validateCustomerServicePdf(
      new File([], "empty.pdf", { type: "application/pdf" }),
    ),
    "The PDF is empty.",
  );
  assertEquals(
    await validateCustomerServicePdf(
      new File(
        [new Uint8Array(MAX_CUSTOMER_SERVICE_PDF_BYTES + 1)],
        "large.pdf",
        { type: "application/pdf" },
      ),
    ),
    "The PDF must be 10 MB or smaller.",
  );
  assertEquals(
    await validateCustomerServicePdf(
      new File(["not really a pdf"], "fake.pdf", { type: "application/pdf" }),
    ),
    "The selected file is not a valid PDF.",
  );
});

Deno.test("validates pasted Customer Service email text", () => {
  assertEquals(validateCustomerServiceEmailText("Service request"), null);
  assertEquals(
    validateCustomerServiceEmailText("   "),
    "Paste the email text to analyze.",
  );
  assertEquals(
    validateCustomerServiceEmailText(
      "x".repeat(MAX_CUSTOMER_SERVICE_EMAIL_TEXT_CHARACTERS + 1),
    ),
    "The email text must be 50,000 characters or fewer.",
  );
});

Deno.test("extracts structured data from pasted email text", async () => {
  const requests: Record<string, unknown>[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    assertEquals(String(input).endsWith("/chat/completions"), true);
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      model: "mistral-small-test",
      choices: [{
        message: { content: JSON.stringify(structuredExtraction()) },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
  }) as typeof fetch;

  const result = await extractEmailTextWithMistral(
    "From: warranty@example.com\nSubject: Door issue\nThe door is stuck.",
    "test-key",
    fetcher,
  );

  assertEquals(result.model, "mistral-small-test");
  assertEquals(result.structuredData.property.lotNumber, "000250");
  assertEquals(result.text.includes("Subject: Door issue"), true);
  const request = requests[0] as {
    response_format: { type: string; json_schema: { strict: boolean } };
    messages: Array<{ role: string; content: string }>;
  };
  assertEquals(request.response_format.type, "json_schema");
  assertEquals(request.response_format.json_schema.strict, true);
  assertEquals(request.messages[0].role, "system");
  assertEquals(request.messages[1].content.includes("<source_email>"), true);
});

Deno.test("rejects malformed structured data from pasted email text", async () => {
  const fetcher = (async () => Response.json({
    choices: [{ message: { content: "{not-valid-json" } }],
  })) as typeof fetch;

  await assertRejects(
    () => extractEmailTextWithMistral("Door service request", "test-key", fetcher),
    MistralOcrError,
    "Mistral email analysis returned malformed structured data.",
  );
});

Deno.test("uploads, extracts and deletes a temporary Mistral PDF", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const ocrRequests: Record<string, unknown>[] = [];
  const fetcher =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/files") && method === "POST") {
        return Response.json({ id: "ocr-file-1" });
      }
      if (url.includes("/files/ocr-file-1/url")) {
        return Response.json({ url: "https://signed.example/request.pdf" });
      }
      if (url.endsWith("/ocr")) {
        ocrRequests.push(JSON.parse(String(init?.body)));
        return Response.json({
          model: "mistral-ocr-test",
          document_annotation: JSON.stringify(structuredExtraction()),
          pages: [
            {
              index: 0,
              markdown: "Customer: Jane Doe",
              confidence_scores: {
                average_page_confidence_score: 0.98,
                minimum_page_confidence_score: 0.91,
              },
            },
            { index: 1, markdown: "Work: Replace exterior frame" },
          ],
          usage_info: { pages_processed: 2 },
        });
      }
      if (url.endsWith("/files/ocr-file-1") && method === "DELETE") {
        return Response.json({ id: "ocr-file-1", deleted: true });
      }
      return Response.json({ detail: "Unexpected test request." }, {
        status: 500,
      });
    }) as typeof fetch;

  const result = await extractPdfWithMistral(pdfFile(), "test-key", fetcher);

  assertEquals(result.model, "mistral-ocr-test");
  assertEquals(result.pages.length, 2);
  assertEquals(result.pages[0].averageConfidence, 0.98);
  assertEquals(result.structuredData.serviceItems.length, 1);
  assertEquals(result.structuredData.property.lotNumber, "000250");
  assertEquals(
    result.text,
    "Customer: Jane Doe\n\nWork: Replace exterior frame",
  );
  const ocrRequest = ocrRequests[0];
  const annotationFormat = ocrRequest.document_annotation_format as {
    type: string;
    json_schema: {
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  assertEquals(annotationFormat.type, "json_schema");
  assertEquals(
    annotationFormat.json_schema.name,
    "customer_service_pdf_extraction",
  );
  assertEquals(annotationFormat.json_schema.strict, true);
  assertEquals(
    JSON.stringify(annotationFormat.json_schema.schema).includes("maxLength"),
    false,
  );
  assertEquals(
    JSON.stringify(annotationFormat.json_schema.schema).includes("const"),
    false,
  );
  assertEquals(
    typeof ocrRequest.document_annotation_prompt,
    "string",
  );
  assertEquals(calls.map(({ method }) => method), [
    "POST",
    "GET",
    "POST",
    "DELETE",
  ]);
});

Deno.test("deletes the temporary file when OCR fails", async () => {
  const methods: string[] = [];
  const fetcher =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      methods.push(method);
      if (url.endsWith("/files") && method === "POST") {
        return Response.json({ id: "ocr-file-2" });
      }
      if (url.includes("/files/ocr-file-2/url")) {
        return Response.json({ url: "https://signed.example/request.pdf" });
      }
      if (url.endsWith("/ocr")) {
        return Response.json({ detail: "Document could not be processed." }, {
          status: 422,
        });
      }
      return Response.json({ id: "ocr-file-2", deleted: true });
    }) as typeof fetch;

  await assertRejects(
    () => extractPdfWithMistral(pdfFile(), "test-key", fetcher),
    MistralOcrError,
    "Mistral OCR failed with status 422.",
  );
  assertEquals(methods, ["POST", "GET", "POST", "DELETE"]);
});

Deno.test("rejects malformed structured data and still deletes the temporary file", async () => {
  const methods: string[] = [];
  const fetcher =
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      methods.push(method);
      if (url.endsWith("/files") && method === "POST") {
        return Response.json({ id: "ocr-file-3" });
      }
      if (url.includes("/files/ocr-file-3/url")) {
        return Response.json({ url: "https://signed.example/request.pdf" });
      }
      if (url.endsWith("/ocr")) {
        return Response.json({
          model: "mistral-ocr-test",
          document_annotation: "{not-valid-json",
          pages: [{ index: 0, markdown: "Readable OCR text" }],
        });
      }
      return Response.json({ id: "ocr-file-3", deleted: true });
    }) as typeof fetch;

  await assertRejects(
    () => extractPdfWithMistral(pdfFile(), "test-key", fetcher),
    MistralOcrError,
    "Mistral OCR returned malformed structured data.",
  );
  assertEquals(methods, ["POST", "GET", "POST", "DELETE"]);
});
