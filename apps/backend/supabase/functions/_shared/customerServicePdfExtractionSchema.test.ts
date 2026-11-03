import { assertEquals, assertThrows } from "@std/assert";
import {
  customerServicePdfExtractionJsonSchema,
  CustomerServicePdfExtractionValidationError,
  parseCustomerServicePdfExtraction,
} from "./customerServicePdfExtractionSchema.ts";

function warrantyRequestFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    document: {
      documentType: "HOMEOWNER_WARRANTY_REQUEST",
      issuerName: "Example Builder",
      documentTitle: "Homeowner Warranty Request Form",
      workOrderNumbers: [],
      orderDate: null,
      scheduledDate: "2026-10-12",
      sourceEmailSentDate: "2026-10-12",
      sourceEmailFrom: null,
      sourceEmailSubject: null,
    },
    property: {
      builderName: "Example Builder",
      communityName: "Iris",
      lotNumber: "19",
      model: null,
      address: {
        street: "100 Example Lane",
        unit: null,
        city: "Valencia",
        state: "CA",
        postalCode: null,
        formatted: "100 Example Lane, Valencia, CA",
      },
      coordinates: {
        raw: null,
        latitude: null,
        longitude: null,
      },
    },
    contacts: [
      {
        role: "HOMEOWNER",
        name: "Example Homeowner",
        phones: [{ type: "MOBILE", number: "(951) 555-0100" }],
        email: "homeowner@example.com",
        sourceLabel: "Owner(s)",
        sourcePage: 1,
      },
    ],
    serviceItems: [
      {
        sourceItemNumber: "1",
        description: "Bedroom door does not close or lock.",
        requestedAction: null,
        location: "Upstairs bedroom",
        assignedVendor: "Val Trim",
        assignedToValtrim: true,
        sourceCategory: null,
        suggestedServiceKind: "Adjustment",
        suggestedWorkType: "Doors",
        suggestedServiceTask: "GENERAL_FIX",
        sourcePage: 1,
        reviewReasons: [
          "Confirm whether the lock or door alignment is the cause.",
        ],
      },
      {
        sourceItemNumber: "2",
        description: "Bathroom sink stopper is not working.",
        requestedAction: null,
        location: "Bathroom",
        assignedVendor: "Example Plumbing",
        assignedToValtrim: false,
        sourceCategory: "Plumbing",
        suggestedServiceKind: null,
        suggestedWorkType: null,
        suggestedServiceTask: null,
        sourcePage: 1,
        reviewReasons: [],
      },
    ],
    warnings: ["Coordinates were not present in the document."],
  };
}

function workOrderFixture(): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    document: {
      documentType: "WORK_ORDER",
      issuerName: "Example Residential",
      documentTitle: "Example Towns Warranty",
      workOrderNumbers: ["2222050W", "00001020"],
      orderDate: "2026-09-10",
      scheduledDate: null,
      sourceEmailSentDate: null,
      sourceEmailFrom: null,
      sourceEmailSubject: null,
    },
    property: {
      builderName: null,
      communityName: "Example Townhomes",
      lotNumber: "000250",
      model: "05MAG",
      address: {
        street: "200 Sample Avenue",
        unit: null,
        city: "Arcadia",
        state: "CA",
        postalCode: "91006",
        formatted: "200 Sample Avenue, Arcadia, CA 91006",
      },
      coordinates: {
        raw: null,
        latitude: null,
        longitude: null,
      },
    },
    contacts: [
      {
        role: "HOMEOWNER",
        name: "Example Owner",
        phones: [],
        email: null,
        sourceLabel: "Work At",
        sourcePage: 1,
      },
      {
        role: "PRIMARY_CONTACT",
        name: "Example Contact",
        phones: [
          { type: "HOME", number: "8585550100" },
          { type: "WORK", number: "(858) 555-0192" },
        ],
        email: "contact@example.com",
        sourceLabel: "Contact",
        sourcePage: 1,
      },
    ],
    serviceItems: [
      {
        sourceItemNumber: "0001",
        description: "Door gets stuck at the top left side of the frame.",
        requestedAction: null,
        location: "Primary bedroom",
        assignedVendor: "Valtrim Inc.",
        assignedToValtrim: true,
        sourceCategory: "Hardware",
        suggestedServiceKind: "Adjustment",
        suggestedWorkType: "Hardware",
        suggestedServiceTask: "GENERAL_FIX",
        sourcePage: 1,
        reviewReasons: [
          "The document does not explicitly request replacement.",
        ],
      },
    ],
    warnings: [
      "The issuer is visible, but the document's Builder field is blank.",
      "Coordinates were not present in the document.",
    ],
  };
}

Deno.test("parses a warranty request with multiple vendor-assigned service items", () => {
  const parsed = parseCustomerServicePdfExtraction(warrantyRequestFixture());

  assertEquals(parsed.serviceItems.length, 2);
  assertEquals(parsed.serviceItems[0].assignedToValtrim, true);
  assertEquals(parsed.serviceItems[1].assignedToValtrim, false);
  assertEquals(parsed.property.coordinates.latitude, null);
  assertEquals(parsed.document.sourceEmailSentDate, "2026-10-12");
});

Deno.test("preserves partial contacts, leading-zero lots and multiple work-order numbers", () => {
  const parsed = parseCustomerServicePdfExtraction(workOrderFixture());

  assertEquals(parsed.property.builderName, null);
  assertEquals(parsed.property.lotNumber, "000250");
  assertEquals(parsed.document.workOrderNumbers, ["2222050W", "00001020"]);
  assertEquals(parsed.contacts[0].phones, []);
  assertEquals(parsed.contacts[1].role, "PRIMARY_CONTACT");
});

Deno.test("rejects catalog suggestions outside the current New Request options", () => {
  const fixture = warrantyRequestFixture();
  const item = (fixture.serviceItems as Array<Record<string, unknown>>)[0];
  item.suggestedWorkType = "Plumbing";

  assertThrows(
    () => parseCustomerServicePdfExtraction(fixture),
    CustomerServicePdfExtractionValidationError,
    "serviceItems[0].suggestedWorkType",
  );
});

Deno.test("rejects invented or invalid coordinates instead of silently accepting them", () => {
  const fixture = workOrderFixture();
  const property = fixture.property as Record<string, unknown>;
  const coordinates = property.coordinates as Record<string, unknown>;
  coordinates.latitude = 120;

  assertThrows(
    () => parseCustomerServicePdfExtraction(fixture),
    CustomerServicePdfExtractionValidationError,
    "property.coordinates.latitude",
  );
});

Deno.test("rejects unexpected properties so the extraction contract cannot drift", () => {
  const fixture = workOrderFixture();
  fixture.unreviewedModelOutput = "not allowed";

  assertThrows(
    () => parseCustomerServicePdfExtraction(fixture),
    CustomerServicePdfExtractionValidationError,
    "root.unreviewedModelOutput is not allowed",
  );
});

Deno.test("exports a strict JSON schema with arrays for contacts and service items", () => {
  const schema = customerServicePdfExtractionJsonSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, { type?: string }>;
  };

  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, [
    "schemaVersion",
    "document",
    "property",
    "contacts",
    "serviceItems",
    "warnings",
  ]);
  assertEquals(schema.properties.contacts.type, "array");
  assertEquals(schema.properties.serviceItems.type, "array");
});
