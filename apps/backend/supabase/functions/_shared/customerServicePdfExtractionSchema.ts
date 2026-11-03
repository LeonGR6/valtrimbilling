import customerServicePdfExtractionJsonSchema from "./customerServicePdfExtraction.schema.json" with {
  type: "json",
};

export const CUSTOMER_SERVICE_PDF_EXTRACTION_SCHEMA_VERSION = "1.0" as const;

export const customerServicePdfDocumentTypes = [
  "HOMEOWNER_WARRANTY_REQUEST",
  "WORK_ORDER",
  "EMAIL_EXPORT",
  "OTHER",
  "UNKNOWN",
] as const;

export const customerServicePdfContactRoles = [
  "HOMEOWNER",
  "PRIMARY_CONTACT",
  "BUILDER_CONTACT",
  "WARRANTY_REP",
  "OTHER",
  "UNKNOWN",
] as const;

export const customerServicePdfPhoneTypes = [
  "HOME",
  "MOBILE",
  "WORK",
  "OTHER",
  "UNKNOWN",
] as const;

export const customerServicePdfServiceKinds = [
  "Adjustment",
  "Replacement",
  "Paid Extra",
] as const;

export const customerServicePdfWorkTypes = [
  "Exterior Frames",
  "Doors",
  "Moldings",
  "Hardware",
  "Weatherstripping",
  "Shelving",
] as const;

export const customerServicePdfServiceTasks = [
  "GENERAL_FIX",
  "EXTERIOR_DOOR_REPLACEMENT",
  "EXTERIOR_FRAME_REPLACEMENT",
  "SHUTTER_REPLACEMENT",
  "SHELVING_REPLACEMENT",
] as const;

export type CustomerServicePdfDocumentType =
  typeof customerServicePdfDocumentTypes[number];
export type CustomerServicePdfContactRole =
  typeof customerServicePdfContactRoles[number];
export type CustomerServicePdfPhoneType =
  typeof customerServicePdfPhoneTypes[number];
export type CustomerServicePdfServiceKind =
  typeof customerServicePdfServiceKinds[number];
export type CustomerServicePdfWorkType =
  typeof customerServicePdfWorkTypes[number];
export type CustomerServicePdfServiceTask =
  typeof customerServicePdfServiceTasks[number];

export interface CustomerServicePdfDocument {
  documentType: CustomerServicePdfDocumentType;
  issuerName: string | null;
  documentTitle: string | null;
  workOrderNumbers: string[];
  orderDate: string | null;
  scheduledDate: string | null;
  sourceEmailSentDate: string | null;
  sourceEmailFrom: string | null;
  sourceEmailSubject: string | null;
}

export interface CustomerServicePdfAddress {
  street: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  formatted: string | null;
}

export interface CustomerServicePdfCoordinates {
  raw: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CustomerServicePdfProperty {
  builderName: string | null;
  communityName: string | null;
  lotNumber: string | null;
  model: string | null;
  address: CustomerServicePdfAddress;
  coordinates: CustomerServicePdfCoordinates;
}

export interface CustomerServicePdfPhone {
  type: CustomerServicePdfPhoneType;
  number: string;
}

export interface CustomerServicePdfContact {
  role: CustomerServicePdfContactRole;
  name: string | null;
  phones: CustomerServicePdfPhone[];
  email: string | null;
  sourceLabel: string | null;
  sourcePage: number | null;
}

export interface CustomerServicePdfServiceItem {
  sourceItemNumber: string | null;
  description: string | null;
  requestedAction: string | null;
  location: string | null;
  assignedVendor: string | null;
  assignedToValtrim: boolean | null;
  sourceCategory: string | null;
  suggestedServiceKind: CustomerServicePdfServiceKind | null;
  suggestedWorkType: CustomerServicePdfWorkType | null;
  suggestedServiceTask: CustomerServicePdfServiceTask | null;
  sourcePage: number | null;
  reviewReasons: string[];
}

export interface CustomerServicePdfExtraction {
  schemaVersion: typeof CUSTOMER_SERVICE_PDF_EXTRACTION_SCHEMA_VERSION;
  document: CustomerServicePdfDocument;
  property: CustomerServicePdfProperty;
  contacts: CustomerServicePdfContact[];
  serviceItems: CustomerServicePdfServiceItem[];
  warnings: string[];
}

export { customerServicePdfExtractionJsonSchema };

export class CustomerServicePdfExtractionValidationError extends Error {
  constructor(readonly path: string, detail = "has an invalid value") {
    super(`Customer Service PDF extraction ${path} ${detail}.`);
    this.name = "CustomerServicePdfExtractionValidationError";
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be an object",
    );
  }
  return value as UnknownRecord;
}

function onlyKeys(value: UnknownRecord, keys: readonly string[], path: string) {
  const allowed = new Set(keys);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) {
    throw new CustomerServicePdfExtractionValidationError(
      `${path}.${extra}`,
      "is not allowed",
    );
  }
}

function field(value: UnknownRecord, key: string, path: string): unknown {
  if (!Object.hasOwn(value, key)) {
    throw new CustomerServicePdfExtractionValidationError(
      `${path}.${key}`,
      "is required",
    );
  }
  return value[key];
}

function nullableText(
  value: unknown,
  path: string,
  maximumLength: number,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be text or null",
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new CustomerServicePdfExtractionValidationError(path);
  }
  return normalized;
}

function requiredText(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  const normalized = nullableText(value, path, maximumLength);
  if (normalized === null) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be text",
    );
  }
  return normalized;
}

function textArray(
  value: unknown,
  path: string,
  maximumItems: number,
  maximumItemLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      `must be an array with at most ${maximumItems} items`,
    );
  }
  return value.map((item, index) =>
    requiredText(item, `${path}[${index}]`, maximumItemLength)
  );
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  options: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !options.includes(value)) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      `must be one of: ${options.join(", ")}`,
    );
  }
  return value as T[number];
}

function nullableEnumValue<const T extends readonly string[]>(
  value: unknown,
  options: T,
  path: string,
): T[number] | null {
  return value === null ? null : enumValue(value, options, path);
}

function nullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be a positive integer or null",
    );
  }
  return value as number;
}

function nullableCoordinate(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" || !Number.isFinite(value) ||
    value < minimum || value > maximum
  ) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      `must be between ${minimum} and ${maximum}, or null`,
    );
  }
  return value;
}

function nullableBoolean(value: unknown, path: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new CustomerServicePdfExtractionValidationError(
    path,
    "must be true, false or null",
  );
}

function isoDate(value: unknown, path: string): string | null {
  const normalized = nullableText(value, path, 10);
  if (normalized === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must use YYYY-MM-DD or null",
    );
  }
  return normalized;
}

function parseDocument(value: unknown): CustomerServicePdfDocument {
  const path = "document";
  const source = record(value, path);
  onlyKeys(source, [
    "documentType",
    "issuerName",
    "documentTitle",
    "workOrderNumbers",
    "orderDate",
    "scheduledDate",
    "sourceEmailSentDate",
    "sourceEmailFrom",
    "sourceEmailSubject",
  ], path);
  return {
    documentType: enumValue(
      field(source, "documentType", path),
      customerServicePdfDocumentTypes,
      `${path}.documentType`,
    ),
    issuerName: nullableText(
      field(source, "issuerName", path),
      `${path}.issuerName`,
      200,
    ),
    documentTitle: nullableText(
      field(source, "documentTitle", path),
      `${path}.documentTitle`,
      250,
    ),
    workOrderNumbers: textArray(
      field(source, "workOrderNumbers", path),
      `${path}.workOrderNumbers`,
      20,
      100,
    ),
    orderDate: isoDate(
      field(source, "orderDate", path),
      `${path}.orderDate`,
    ),
    scheduledDate: isoDate(
      field(source, "scheduledDate", path),
      `${path}.scheduledDate`,
    ),
    sourceEmailSentDate: isoDate(
      field(source, "sourceEmailSentDate", path),
      `${path}.sourceEmailSentDate`,
    ),
    sourceEmailFrom: nullableText(
      field(source, "sourceEmailFrom", path),
      `${path}.sourceEmailFrom`,
      200,
    ),
    sourceEmailSubject: nullableText(
      field(source, "sourceEmailSubject", path),
      `${path}.sourceEmailSubject`,
      250,
    ),
  };
}

function parseAddress(value: unknown): CustomerServicePdfAddress {
  const path = "property.address";
  const source = record(value, path);
  onlyKeys(source, [
    "street",
    "unit",
    "city",
    "state",
    "postalCode",
    "formatted",
  ], path);
  return {
    street: nullableText(field(source, "street", path), `${path}.street`, 250),
    unit: nullableText(field(source, "unit", path), `${path}.unit`, 100),
    city: nullableText(field(source, "city", path), `${path}.city`, 120),
    state: nullableText(field(source, "state", path), `${path}.state`, 80),
    postalCode: nullableText(
      field(source, "postalCode", path),
      `${path}.postalCode`,
      20,
    ),
    formatted: nullableText(
      field(source, "formatted", path),
      `${path}.formatted`,
      500,
    ),
  };
}

function parseCoordinates(value: unknown): CustomerServicePdfCoordinates {
  const path = "property.coordinates";
  const source = record(value, path);
  onlyKeys(source, ["raw", "latitude", "longitude"], path);
  return {
    raw: nullableText(field(source, "raw", path), `${path}.raw`, 100),
    latitude: nullableCoordinate(
      field(source, "latitude", path),
      `${path}.latitude`,
      -90,
      90,
    ),
    longitude: nullableCoordinate(
      field(source, "longitude", path),
      `${path}.longitude`,
      -180,
      180,
    ),
  };
}

function parseProperty(value: unknown): CustomerServicePdfProperty {
  const path = "property";
  const source = record(value, path);
  onlyKeys(source, [
    "builderName",
    "communityName",
    "lotNumber",
    "model",
    "address",
    "coordinates",
  ], path);
  return {
    builderName: nullableText(
      field(source, "builderName", path),
      `${path}.builderName`,
      200,
    ),
    communityName: nullableText(
      field(source, "communityName", path),
      `${path}.communityName`,
      200,
    ),
    lotNumber: nullableText(
      field(source, "lotNumber", path),
      `${path}.lotNumber`,
      80,
    ),
    model: nullableText(field(source, "model", path), `${path}.model`, 100),
    address: parseAddress(field(source, "address", path)),
    coordinates: parseCoordinates(field(source, "coordinates", path)),
  };
}

function parsePhones(
  value: unknown,
  contactPath: string,
): CustomerServicePdfPhone[] {
  const path = `${contactPath}.phones`;
  if (!Array.isArray(value) || value.length > 10) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be an array with at most 10 items",
    );
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const source = record(item, itemPath);
    onlyKeys(source, ["type", "number"], itemPath);
    return {
      type: enumValue(
        field(source, "type", itemPath),
        customerServicePdfPhoneTypes,
        `${itemPath}.type`,
      ),
      number: requiredText(
        field(source, "number", itemPath),
        `${itemPath}.number`,
        50,
      ),
    };
  });
}

function parseContacts(value: unknown): CustomerServicePdfContact[] {
  const path = "contacts";
  if (!Array.isArray(value) || value.length > 20) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be an array with at most 20 items",
    );
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const source = record(item, itemPath);
    onlyKeys(source, [
      "role",
      "name",
      "phones",
      "email",
      "sourceLabel",
      "sourcePage",
    ], itemPath);
    return {
      role: enumValue(
        field(source, "role", itemPath),
        customerServicePdfContactRoles,
        `${itemPath}.role`,
      ),
      name: nullableText(
        field(source, "name", itemPath),
        `${itemPath}.name`,
        200,
      ),
      phones: parsePhones(field(source, "phones", itemPath), itemPath),
      email: nullableText(
        field(source, "email", itemPath),
        `${itemPath}.email`,
        200,
      ),
      sourceLabel: nullableText(
        field(source, "sourceLabel", itemPath),
        `${itemPath}.sourceLabel`,
        100,
      ),
      sourcePage: nullableInteger(
        field(source, "sourcePage", itemPath),
        `${itemPath}.sourcePage`,
      ),
    };
  });
}

function parseServiceItems(value: unknown): CustomerServicePdfServiceItem[] {
  const path = "serviceItems";
  if (!Array.isArray(value) || value.length > 100) {
    throw new CustomerServicePdfExtractionValidationError(
      path,
      "must be an array with at most 100 items",
    );
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const source = record(item, itemPath);
    onlyKeys(source, [
      "sourceItemNumber",
      "description",
      "requestedAction",
      "location",
      "assignedVendor",
      "assignedToValtrim",
      "sourceCategory",
      "suggestedServiceKind",
      "suggestedWorkType",
      "suggestedServiceTask",
      "sourcePage",
      "reviewReasons",
    ], itemPath);
    return {
      sourceItemNumber: nullableText(
        field(source, "sourceItemNumber", itemPath),
        `${itemPath}.sourceItemNumber`,
        100,
      ),
      description: nullableText(
        field(source, "description", itemPath),
        `${itemPath}.description`,
        4000,
      ),
      requestedAction: nullableText(
        field(source, "requestedAction", itemPath),
        `${itemPath}.requestedAction`,
        2000,
      ),
      location: nullableText(
        field(source, "location", itemPath),
        `${itemPath}.location`,
        500,
      ),
      assignedVendor: nullableText(
        field(source, "assignedVendor", itemPath),
        `${itemPath}.assignedVendor`,
        200,
      ),
      assignedToValtrim: nullableBoolean(
        field(source, "assignedToValtrim", itemPath),
        `${itemPath}.assignedToValtrim`,
      ),
      sourceCategory: nullableText(
        field(source, "sourceCategory", itemPath),
        `${itemPath}.sourceCategory`,
        200,
      ),
      suggestedServiceKind: nullableEnumValue(
        field(source, "suggestedServiceKind", itemPath),
        customerServicePdfServiceKinds,
        `${itemPath}.suggestedServiceKind`,
      ),
      suggestedWorkType: nullableEnumValue(
        field(source, "suggestedWorkType", itemPath),
        customerServicePdfWorkTypes,
        `${itemPath}.suggestedWorkType`,
      ),
      suggestedServiceTask: nullableEnumValue(
        field(source, "suggestedServiceTask", itemPath),
        customerServicePdfServiceTasks,
        `${itemPath}.suggestedServiceTask`,
      ),
      sourcePage: nullableInteger(
        field(source, "sourcePage", itemPath),
        `${itemPath}.sourcePage`,
      ),
      reviewReasons: textArray(
        field(source, "reviewReasons", itemPath),
        `${itemPath}.reviewReasons`,
        20,
        500,
      ),
    };
  });
}

export function parseCustomerServicePdfExtraction(
  value: unknown,
): CustomerServicePdfExtraction {
  const source = record(value, "root");
  onlyKeys(source, [
    "schemaVersion",
    "document",
    "property",
    "contacts",
    "serviceItems",
    "warnings",
  ], "root");

  const schemaVersion = field(source, "schemaVersion", "root");
  if (schemaVersion !== CUSTOMER_SERVICE_PDF_EXTRACTION_SCHEMA_VERSION) {
    throw new CustomerServicePdfExtractionValidationError(
      "schemaVersion",
      `must be ${CUSTOMER_SERVICE_PDF_EXTRACTION_SCHEMA_VERSION}`,
    );
  }

  return {
    schemaVersion,
    document: parseDocument(field(source, "document", "root")),
    property: parseProperty(field(source, "property", "root")),
    contacts: parseContacts(field(source, "contacts", "root")),
    serviceItems: parseServiceItems(field(source, "serviceItems", "root")),
    warnings: textArray(
      field(source, "warnings", "root"),
      "warnings",
      50,
      500,
    ),
  };
}
