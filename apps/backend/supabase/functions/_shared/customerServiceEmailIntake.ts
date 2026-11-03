import type {
  CustomerServicePdfContact,
  CustomerServicePdfExtraction,
  CustomerServicePdfServiceItem,
} from "./customerServicePdfExtractionSchema.ts";
import { suggestRequestPlanning } from "./customerServicePlanning.mjs";

export interface SourceFacts {
  sourceId: string;
  kind: "EMAIL" | "PDF" | "PDF_FIELDS" | "IMAGE";
  structuredData: CustomerServicePdfExtraction;
}
export interface Evidence {
  sourceId: string;
  value: unknown;
  sourcePage: number | null;
}
export interface FactConflict {
  path: string;
  candidates: Evidence[];
}
export interface IntakeCatalog {
  builders: Array<
    { id: number; code: string; name: string; aliases?: string[] }
  >;
  jobs: Array<
    {
      id: number;
      builderId: number;
      code: string;
      community: string;
      latitude: number | null;
      longitude: number | null;
      aliases?: string[];
    }
  >;
}
export interface ImportedIntakePayload {
  property: {
    jobId: number | null;
    lotNumber: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  request: {
    reportedOn: string | null;
    reportedOnSource?: "EMAIL_SENT" | "ORDER_DATE" | "SCHEDULED_DATE";
    serviceKind: string | null;
    workCategory: string | null;
    serviceTask: string | null;
    estimatedDurationMinutes: number | null;
    crewSize: number | null;
  };
  contacts: Array<
    {
      role: "PRIMARY" | "ADDITIONAL";
      name: string | null;
      email: string | null;
      phone: string | null;
    }
  >;
  items: Array<{ itemNumber: number; description: string }>;
}

// Same configured Builder aliases as the existing intake, not fuzzy matching.
const aliasesByCode: Record<string, string[]> = {
  BR: ["Brookfield", "Brookfield Residential"],
  CV: ["City Ventures"],
  KBH: ["KB", "KB Home", "KB Homes"],
  MH: ["Melia", "Melia Homes"],
  TOC: ["Olson Homes", "The Olson Company"],
  TPIE: [
    "Tri Pointe",
    "Tri Pointe Homes",
    "Tri Pointe Homes Inland Empire",
    "TriPointeHomes",
  ],
};
const normalized = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
const alias = (value: string) =>
  normalized(
    value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(
      /[^a-z0-9]+/gi,
      " ",
    ),
  );
const unique = (values: string[]) => [...new Set(values)];
// State plus ZIP identifies US context; a bare ten-digit number does not.
const usStates = new Set(
  (
    "AL|Alabama|AK|Alaska|AZ|Arizona|AR|Arkansas|CA|California|CO|Colorado|CT|Connecticut|DE|Delaware|FL|Florida|GA|Georgia|HI|Hawaii|ID|Idaho|IL|Illinois|IN|Indiana|IA|Iowa|KS|Kansas|KY|Kentucky|LA|Louisiana|ME|Maine|MD|Maryland|MA|Massachusetts|MI|Michigan|MN|Minnesota|MS|Mississippi|MO|Missouri|MT|Montana|NE|Nebraska|NV|Nevada|NH|New Hampshire|NJ|New Jersey|NM|New Mexico|NY|New York|NC|North Carolina|ND|North Dakota|OH|Ohio|OK|Oklahoma|OR|Oregon|PA|Pennsylvania|RI|Rhode Island|SC|South Carolina|SD|South Dakota|TN|Tennessee|TX|Texas|UT|Utah|VT|Vermont|VA|Virginia|WA|Washington|WV|West Virginia|WI|Wisconsin|WY|Wyoming|DC|District of Columbia"
  ).toUpperCase().split("|"),
);

export function emptyEmailImportFacts(): CustomerServicePdfExtraction {
  return {
    schemaVersion: "1.0",
    document: {
      documentType: "UNKNOWN",
      issuerName: null,
      documentTitle: null,
      workOrderNumbers: [],
      orderDate: null,
      scheduledDate: null,
      sourceEmailSentDate: null,
      sourceEmailFrom: null,
      sourceEmailSubject: null,
    },
    property: {
      builderName: null,
      communityName: null,
      lotNumber: null,
      model: null,
      address: {
        street: null,
        unit: null,
        city: null,
        state: null,
        postalCode: null,
        formatted: null,
      },
      coordinates: { raw: null, latitude: null, longitude: null },
    },
    contacts: [],
    serviceItems: [],
    warnings: [],
  };
}

export function californiaToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDate(value: string | null, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function buildEmailImportIntake(
  sources: SourceFacts[],
  catalog: IntakeCatalog,
  today = californiaToday(),
) {
  const data = emptyEmailImportFacts();
  const provenance: Record<string, Evidence[]> = {};
  const conflicts: FactConflict[] = [];
  const warnings = sources.flatMap((source) =>
    source.structuredData.warnings.map((warning) =>
      `${source.sourceId}: ${warning}`
    )
  );
  const issues: string[] = [];
  function select<T>(
    path: string,
    candidates: Array<
      { sourceId: string; value: T | null; sourcePage?: number | null }
    >,
    opaque = false,
  ): T | null {
    const present = candidates.filter((entry) =>
      entry.value !== null && entry.value !== undefined && entry.value !== ""
    );
    provenance[path] = present.map((entry) => ({
      ...entry,
      sourcePage: entry.sourcePage ?? null,
    }));
    const keys = new Set(
      present.map(({ value }) =>
        typeof value === "string" && !opaque
          ? normalized(value)
          : JSON.stringify(value)
      ),
    );
    if (keys.size > 1) {
      conflicts.push({ path, candidates: provenance[path] });
      warnings.push(
        `Datos contradictorios en ${path}; el campo queda pendiente de revisión.`,
      );
      return null;
    }
    return present[0]?.value ?? null;
  }
  const values = <T>(get: (data: CustomerServicePdfExtraction) => T | null) =>
    sources.map((source) => ({
      sourceId: source.sourceId,
      value: get(source.structuredData),
    }));
  data.document.documentType = sources.some((source) => source.kind === "EMAIL")
    ? "EMAIL_EXPORT"
    : sources[0]?.structuredData.document.documentType ?? "UNKNOWN";
  for (
    const key of [
      "issuerName",
      "documentTitle",
      "orderDate",
      "scheduledDate",
      "sourceEmailSentDate",
      "sourceEmailFrom",
      "sourceEmailSubject",
    ] as const
  ) {
    data.document[key] = select(
      `document.${key}`,
      values((data) => data.document[key]),
    );
  }
  data.document.workOrderNumbers = unique(
    sources.flatMap((source) =>
      source.structuredData.document.workOrderNumbers
    ),
  );
  for (
    const key of ["builderName", "communityName", "lotNumber", "model"] as const
  ) {
    data.property[key] = select(
      `property.${key}`,
      values((data) => data.property[key]),
      key === "lotNumber",
    );
  }
  for (
    const key of [
      "street",
      "unit",
      "city",
      "state",
      "postalCode",
      "formatted",
    ] as const
  ) {
    data.property.address[key] = select(
      `property.address.${key}`,
      values((data) => data.property.address[key]),
      key === "postalCode",
    );
  }
  const coordinates = select(
    "property.coordinates",
    values((data) =>
      data.property.coordinates.latitude !== null &&
        data.property.coordinates.longitude !== null
        ? {
          latitude: data.property.coordinates.latitude,
          longitude: data.property.coordinates.longitude,
        }
        : null
    ),
  );
  if (coordinates) data.property.coordinates = { ...coordinates, raw: null };

  const contactGroups = new Map<
    string,
    Array<{ sourceId: string; contact: CustomerServicePdfContact }>
  >();
  for (const source of sources) {
    for (const [index, contact] of source.structuredData.contacts.entries()) {
      const identityRole =
        ["HOMEOWNER", "PRIMARY_CONTACT"].includes(contact.role)
          ? "RESIDENT"
          : contact.role;
      const key = contact.name
        ? `${identityRole}:${normalized(contact.name)}`
        : `${source.sourceId}:${index}`;
      const group = contactGroups.get(key) ?? [];
      group.push({ sourceId: source.sourceId, contact });
      contactGroups.set(key, group);
    }
  }
  for (const group of contactGroups.values()) {
    const path = `contacts.${data.contacts.length}`;
    const field = (key: "name" | "email" | "sourceLabel") =>
      select(
        `${path}.${key}`,
        group.map(({ sourceId, contact }) => ({
          sourceId,
          value: contact[key],
          sourcePage: contact.sourcePage,
        })),
      );
    const phones = [
      ...new Map(
        group.flatMap(({ contact }) => contact.phones).map((
          phone,
        ) => [`${phone.type}:${phone.number}`, phone]),
      ).values(),
    ];
    provenance[`${path}.phones`] = group.flatMap(({ sourceId, contact }) =>
      contact.phones.map((phone) => ({
        sourceId,
        value: phone,
        sourcePage: contact.sourcePage,
      }))
    );
    data.contacts.push({
      role: group.some(({ contact }) => contact.role === "HOMEOWNER")
        ? "HOMEOWNER"
        : group[0].contact.role,
      name: field("name"),
      email: field("email"),
      sourceLabel: field("sourceLabel"),
      sourcePage: null,
      phones,
    });
  }

  type ItemGroup = Array<
    {
      sourceId: string;
      item: CustomerServicePdfServiceItem;
      workOrders: string[];
    }
  >;
  const itemGroups: Array<{ key: string; entries: ItemGroup }> = [];
  for (const source of sources) {
    for (const item of source.structuredData.serviceItems) {
      const key = JSON.stringify(
        [
          item.sourceItemNumber,
          item.description,
          item.requestedAction,
          item.location,
          item.assignedVendor,
        ].map((value) => typeof value === "string" ? normalized(value) : value),
      );
      const orders = source.structuredData.document.workOrderNumbers;
      const found = itemGroups.find((group) =>
        group.key === key && !group.entries.some((entry) =>
          entry.sourceId === source.sourceId
        ) &&
        !group.entries.some((entry) =>
          orders.length && entry.workOrders.length &&
          !entry.workOrders.some((order) => orders.includes(order))
        )
      );
      const entry = { sourceId: source.sourceId, item, workOrders: orders };
      if (found) found.entries.push(entry);
      else {
        if (itemGroups.some((group) => group.key === key)) {
          warnings.push(
            "Hay ítems idénticos dentro de una fuente; se conservan para no perder trabajos distintos y requieren revisión.",
          );
        }
        itemGroups.push({ key, entries: [entry] });
      }
    }
  }
  const excludedItemIndexes: number[] = [];
  for (const { entries } of itemGroups) {
    const index = data.serviceItems.length;
    const path = `serviceItems.${index}`;
    const value = <K extends keyof CustomerServicePdfServiceItem>(
      key: K,
    ): CustomerServicePdfServiceItem[K] | null =>
      select(
        `${path}.${key}`,
        entries.map(({ sourceId, item }) => ({
          sourceId,
          value: item[key],
          sourcePage: item.sourcePage,
        })),
      );
    data.serviceItems.push({
      sourceItemNumber: value("sourceItemNumber"),
      description: value("description"),
      requestedAction: value("requestedAction"),
      location: value("location"),
      assignedVendor: value("assignedVendor"),
      assignedToValtrim: value("assignedToValtrim"),
      sourceCategory: value("sourceCategory"),
      suggestedServiceKind: value("suggestedServiceKind"),
      suggestedWorkType: value("suggestedWorkType"),
      suggestedServiceTask: value("suggestedServiceTask"),
      sourcePage: null,
      reviewReasons: unique(entries.flatMap(({ item }) => item.reviewReasons)),
    });
    if (entries.some(({ item }) => item.assignedToValtrim === false)) {
      excludedItemIndexes.push(index);
    }
  }
  if (excludedItemIndexes.length) {
    warnings.push(
      "Los ítems asignados explícitamente a otro proveedor se conservan en la extracción, pero no se agregan a la request.",
    );
  }

  const homeowners = data.contacts.filter((contact) =>
    contact.role === "HOMEOWNER" && contact.name
  );
  // Use the first explicitly identified homeowner in source order. A resident
  // first seen only as PRIMARY_CONTACT must not displace an earlier HOMEOWNER
  // when a later source establishes that resident's ownership too.
  const homeownerNames = unique(
    sources.flatMap((source) =>
      source.structuredData.contacts.flatMap((contact) =>
        contact.role === "HOMEOWNER" && contact.name
          ? [normalized(contact.name)]
          : []
      )
    ),
  );
  const orderedHomeowners = homeownerNames.map((name) =>
    homeowners.find((contact) => normalized(contact.name!) === name)
  ).filter((contact): contact is CustomerServicePdfContact =>
    contact !== undefined
  );
  const homeowner = orderedHomeowners[0] ?? null;
  if (homeowners.length > 1) {
    warnings.push(
      "Hay varios propietarios. Se usa el primero identificado en el correo como contacto principal; todos se conservan en la extracción para revisión.",
    );
  }
  if (!homeowner || !homeowner.name || [...homeowner.name].length > 100) {
    issues.push("MISSING_OR_AMBIGUOUS_HOMEOWNER");
  }
  function contactPayload(
    contact: CustomerServicePdfContact,
    role: "PRIMARY" | "ADDITIONAL",
  ) {
    const rawEmail = contact.email?.toLowerCase() ?? null;
    const email = rawEmail && [...rawEmail].length <= 160 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)
      ? rawEmail
      : null;
    const phones = unique(
      contact.phones.map((phone) => phone.number.replace(/[\s().-]/g, "")),
    );
    const usAddress =
      usStates.has(data.property.address.state?.trim().toUpperCase() ?? "") &&
      /^\d{5}(?:-\d{4})?$/.test(data.property.address.postalCode ?? "");
    const candidate = phones.length === 1 ? phones[0] : null;
    const phone = candidate && /^\+(1|52)\d{10}$/.test(candidate)
      ? candidate
      : candidate && /^\d{10}$/.test(candidate) && usAddress
      ? `+1${candidate}`
      : candidate && /^1\d{10}$/.test(candidate)
      ? `+${candidate}`
      : candidate && /^52\d{10}$/.test(candidate)
      ? `+${candidate}`
      : null;
    if (phone && candidate && /^\d{10}$/.test(candidate)) {
      warnings.push(
        "Se añadió +1 al teléfono por la dirección de Estados Unidos; confirmar durante la revisión.",
      );
    }
    if (rawEmail && !email) {
      warnings.push(
        "Un correo de contacto requiere corrección; se conserva el original en la extracción.",
      );
    }
    if (phones.length && !phone) {
      warnings.push(
        "El teléfono es ambiguo o requiere prefijo explícito +1/+52; no se supone un país.",
      );
    }
    return {
      role,
      name: contact.name && [...contact.name].length <= 100
        ? contact.name
        : null,
      email,
      phone,
    };
  }
  const contacts: ImportedIntakePayload["contacts"] = homeowner
    ? [contactPayload(homeowner, "PRIMARY")]
    : [];
  const additional = [
    ...orderedHomeowners.filter((contact) => contact !== homeowner),
    ...data.contacts.filter((contact) => contact.role === "PRIMARY_CONTACT"),
  ];
  for (const candidate of additional.slice(0, 2)) {
    const contact = contactPayload(candidate, "ADDITIONAL");
    if (contact.name || contact.email || contact.phone) contacts.push(contact);
  }
  if (additional.length > 2) {
    warnings.push(
      "La request admite tres customers. Los demás contactos permanecen en la extracción y requieren revisión.",
    );
  }

  const included = data.serviceItems.filter((_item, index) =>
    !excludedItemIndexes.includes(index)
  );
  const described = included.filter((item) =>
    item.description || item.requestedAction
  );
  const descriptions = described.map((item) =>
    unique(
      [item.location, item.description, item.requestedAction].filter((
        value,
      ): value is string => Boolean(value)),
    ).join(" — ")
  );
  if (!descriptions.length) issues.push("MISSING_WORK_ITEM");
  if (
    descriptions.length > 25 ||
    descriptions.some((description) => [...description].length > 1000)
  ) issues.push("WORK_ITEMS_EXCEED_INTAKE_LIMIT");
  if (described.length !== included.length) {
    warnings.push(
      "Un ítem sin descripción ni acción permanece en la extracción, pendiente de completar.",
    );
  }

  const builderValue = data.property.builderName;
  const builderConflict = conflicts.some((conflict) =>
    conflict.path === "property.builderName"
  );
  const matches = catalog.builders.filter((builder) =>
    [
      builder.name,
      builder.code,
      ...(builder.aliases ?? []),
      ...(aliasesByCode[builder.code] ?? []),
    ]
      .some((name) =>
        alias(name) === alias(builderValue ?? data.document.issuerName ?? "")
      )
  );
  const builder = matches.length === 1 ? matches[0] : null;
  const jobs = !builderConflict && data.property.communityName &&
      (!builderValue || builder)
    ? catalog.jobs.filter((job) =>
      (!builder || job.builderId === builder.id) &&
      [job.community, job.code, ...(job.aliases ?? [])].some((name) =>
        alias(name) === alias(data.property.communityName!)
      )
    )
    : [];
  const job = jobs.length === 1 && typeof jobs[0].latitude === "number" &&
      typeof jobs[0].longitude === "number" &&
      Number.isFinite(jobs[0].latitude) && Number.isFinite(jobs[0].longitude) &&
      Math.abs(jobs[0].latitude) <= 90 && Math.abs(jobs[0].longitude) <= 180
    ? jobs[0]
    : null;
  if (!job) {
    warnings.push(
      "Project / Job y coordenadas quedan pendientes: no existe una coincidencia activa única con ubicación válida.",
    );
  }
  if (job && !builderValue && builder) {
    warnings.push(
      "Builder identificado por coincidencia única del emisor con el catálogo; requiere revisión.",
    );
  }
  const bounded = (value: string | null, limit: number, label: string) => {
    if (value && [...value].length > limit) {
      warnings.push(
        `${label} supera el límite del formulario; no se recorta el original.`,
      );
      return null;
    }
    return value;
  };
  const addressConflict = conflicts.some((conflict) =>
    conflict.path.startsWith("property.address.")
  );
  const address = addressConflict ? null : (data.property.address.formatted ??
    ([
      data.property.address.street,
      data.property.address.unit,
      [
        data.property.address.city,
        data.property.address.state,
        data.property.address.postalCode,
      ].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ") || null));
  let reportedOn: string | null = null;
  let reportedOnSource: ImportedIntakePayload["request"]["reportedOnSource"];
  for (
    const [field, source] of [["sourceEmailSentDate", "EMAIL_SENT"], [
      "orderDate",
      "ORDER_DATE",
    ], ["scheduledDate", "SCHEDULED_DATE"]] as const
  ) {
    // A contradictory preferred date must be reviewed, not silently replaced by
    // an unrelated lower-priority date, forwarding time, or Created on.
    if (conflicts.some((conflict) => conflict.path === `document.${field}`)) {
      break;
    }
    const raw = data.document[field];
    if (!raw) continue;
    reportedOn = calendarDate(raw, today);
    if (reportedOn) reportedOnSource = source;
    else {warnings.push(
        "La fecha fuente es inválida o futura; queda pendiente sin sustituirse por Created on.",
      );}
    break;
  }
  const blockedFields: string[] = [];
  for (
    const [sourceField, field] of [
      ["suggestedServiceKind", "serviceKind"],
      ["suggestedWorkType", "workType"],
      ["suggestedServiceTask", "serviceTask"],
    ]
  ) {
    if (
      conflicts.some((conflict) =>
        data.serviceItems.some((item, index) =>
          described.includes(item) &&
          conflict.path === `serviceItems.${index}.${sourceField}`
        )
      )
    ) blockedFields.push(field);
  }
  const planning = suggestRequestPlanning(described, { blockedFields });
  warnings.push(...planning.warnings);
  const payload: ImportedIntakePayload = {
    property: {
      jobId: job?.id ?? null,
      lotNumber: bounded(data.property.lotNumber, 40, "Lot #"),
      address: bounded(address, 240, "Address"),
      latitude: job?.latitude ?? null,
      longitude: job?.longitude ?? null,
    },
    request: {
      reportedOn,
      ...(reportedOnSource ? { reportedOnSource } : {}),
      serviceKind: planning.serviceKind.toUpperCase().replaceAll(" ", "_") ||
        null,
      workCategory: planning.workType.toUpperCase().replaceAll(" ", "_") ||
        null,
      serviceTask: planning.serviceTask || null,
      estimatedDurationMinutes: planning.estimatedDurationMinutes,
      crewSize: planning.crewSize,
    },
    contacts,
    items: descriptions.map((description, index) => ({
      itemNumber: index + 1,
      description,
    })),
  };
  // Duration/crew come from the approved task catalog, not model guesses.
  // Material/chargeable, priority and human approval retain their existing flow.
  data.warnings = unique(warnings);
  return {
    structuredData: data,
    provenance,
    conflicts,
    warnings: data.warnings,
    issues,
    excludedItemIndexes,
    intakePayload: issues.length ? null : payload,
  };
}
