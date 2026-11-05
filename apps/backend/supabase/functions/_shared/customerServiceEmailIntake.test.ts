import { assertEquals } from "@std/assert";
import {
  buildEmailImportIntake,
  type SourceFacts,
} from "./customerServiceEmailIntake.ts";
import {
  emptyCatalog,
  importFacts,
  testCatalog,
} from "./customerServiceEmailTestFixtures.ts";

const wrap = (...facts: ReturnType<typeof importFacts>[]): SourceFacts[] =>
  facts.map((structuredData, index) => ({
    sourceId: `source:${index}`,
    kind: index ? "PDF" : "EMAIL",
    structuredData,
  }));
const merge = (...facts: ReturnType<typeof importFacts>[]) =>
  buildEmailImportIntake(wrap(...facts), emptyCatalog, "2026-10-22");

Deno.test("minimum owner and described item produces an incomplete draft-compatible payload, not approval", () => {
  const result = merge(importFacts());
  assertEquals(result.issues, []);
  assertEquals(result.intakePayload?.contacts[0].name, "Elena Rivera");
  assertEquals(result.intakePayload?.property.jobId, null);
  assertEquals(result.intakePayload?.request.reportedOn, null);
  assertEquals(result.intakePayload?.contacts[0].phone, null);
  assertEquals(
    JSON.stringify(result.intakePayload).includes("READY_TO_PROPOSE"),
    false,
  );
  assertEquals(
    Object.hasOwn(result.intakePayload!.items[0], "materialRequired"),
    false,
  );
  assertEquals(
    result.intakePayload!.request.estimatedDurationMinutes,
    30,
  );
  assertEquals(result.intakePayload!.request.crewSize, 1);
});
Deno.test("body owner and attachment work can form the minimum together", () => {
  const result = merge(
    importFacts("Elena Rivera", null),
    importFacts(null, "Adjust door"),
  );
  assertEquals(result.intakePayload?.items.length, 1);
  assertEquals(result.provenance["contacts.0.name"][0].sourceId, "source:0");
  assertEquals(
    result.provenance["serviceItems.0.description"][0].sourceId,
    "source:1",
  );
});
Deno.test("missing owner does not fall back to issuer, sender or builder representative", () => {
  const facts = importFacts(null);
  facts.document.issuerName = "Builder Representative";
  facts.document.sourceEmailFrom = "builder@example.com";
  facts.contacts = [{
    role: "BUILDER_CONTACT",
    name: "Representative",
    email: "builder@example.com",
    phones: [],
    sourceLabel: null,
    sourcePage: null,
  }];
  assertEquals(merge(facts).intakePayload, null);
});
Deno.test("two named homeowners use the first as primary and keep the second as additional", () => {
  const result = merge(importFacts("Elena Rivera"), importFacts("Other Owner"));
  assertEquals(result.structuredData.contacts.length, 2);
  assertEquals(result.issues, []);
  assertEquals(
    result.intakePayload?.contacts.map((
      contact,
    ) => [contact.role, contact.name]),
    [
      ["PRIMARY", "Elena Rivera"],
      ["ADDITIONAL", "Other Owner"],
    ],
  );
});
Deno.test("three homeowners never block intake and preserve source order instead of sorting names", () => {
  const facts = importFacts("Zoe Rivera");
  facts.contacts.push(
    importFacts("Ana Rivera").contacts[0],
    importFacts("Luis Rivera").contacts[0],
  );
  const result = merge(facts);
  assertEquals(result.issues, []);
  assertEquals(result.intakePayload?.contacts[0].name, "Zoe Rivera");
  assertEquals(result.intakePayload?.contacts.map((contact) => contact.name), [
    "Zoe Rivera",
    "Ana Rivera",
    "Luis Rivera",
  ]);
  assertEquals(result.structuredData.contacts.map((contact) => contact.name), [
    "Zoe Rivera",
    "Ana Rivera",
    "Luis Rivera",
  ]);
  assertEquals(
    result.warnings.some((warning) => warning.includes("first one identified")),
    true,
  );
  assertEquals(result.intakePayload?.contacts.map((contact) => contact.role), [
    "PRIMARY",
    "ADDITIONAL",
    "ADDITIONAL",
  ]);
});
Deno.test("more than three customers remain visible in extraction with an explicit limit warning", () => {
  const facts = importFacts("First Owner");
  facts.contacts.push(
    ...["Second Owner", "Third Owner", "Fourth Owner"].map((name) =>
      importFacts(name).contacts[0]
    ),
  );
  const result = merge(facts);
  assertEquals(result.intakePayload?.contacts.length, 3);
  assertEquals(result.structuredData.contacts.length, 4);
  assertEquals(
    result.warnings.some((warning) =>
      warning.includes("supports three customers")
    ),
    true,
  );
});
Deno.test("all three US homeowners receive their own phone without altering the source numbers", () => {
  const facts = importFacts("First Owner");
  facts.contacts.push(
    importFacts("Second Owner").contacts[0],
    importFacts("Third Owner").contacts[0],
  );
  facts.property.address.state = "CA";
  facts.property.address.postalCode = "92596";
  const numbers = ["(951) 555-0101", "9515550102", "951-555-0103"];
  facts.contacts.forEach((contact, i) =>
    contact.phones = [{ type: "MOBILE", number: numbers[i] }]
  );
  const result = merge(facts);
  assertEquals(result.intakePayload?.contacts.map((contact) => contact.phone), [
    "+19515550101",
    "+19515550102",
    "+19515550103",
  ]);
  assertEquals(
    result.structuredData.contacts.map((contact) => contact.phones[0].number),
    numbers,
  );
  assertEquals(
    result.warnings.some((warning) => warning.includes("+1 was added")),
    true,
  );
});
Deno.test("ten digits do not imply US country without an unambiguous US state and ZIP", () => {
  for (const state of ["CA", "California", " california "]) {
    const facts = importFacts();
    facts.property.address.state = state;
    facts.property.address.postalCode = "92596";
    facts.contacts[0].phones = [{ type: "MOBILE", number: "9515550101" }];
    assertEquals(merge(facts).intakePayload?.contacts[0].phone, "+19515550101");
  }
  for (
    const [state, postalCode] of [[null, null], ["BC", "22000"], ["CA", null], [
      null,
      "92596",
    ], ["CA", "invalid"]]
  ) {
    const facts = importFacts();
    facts.property.address.state = state;
    facts.property.address.postalCode = postalCode;
    facts.contacts[0].phones = [{ type: "MOBILE", number: "9515550101" }];
    assertEquals(merge(facts).intakePayload?.contacts[0].phone, null);
  }
});
Deno.test("US address context does not replace explicit Mexico prefixes or choose between distinct phones", () => {
  const facts = importFacts();
  facts.property.address.state = "CA";
  facts.property.address.postalCode = "92596";
  facts.contacts[0].phones = [{ type: "MOBILE", number: "+52 664 555 0101" }];
  assertEquals(merge(facts).intakePayload?.contacts[0].phone, "+526645550101");
  facts.contacts[0].phones.push({ type: "HOME", number: "9515550101" });
  assertEquals(merge(facts).intakePayload?.contacts[0].phone, null);
});
Deno.test("an earlier representative or primary contact cannot displace the first explicit homeowner", () => {
  const email = importFacts("First Homeowner");
  email.contacts.unshift({
    ...importFacts("Resident Seen Earlier").contacts[0],
    role: "PRIMARY_CONTACT",
  });
  email.contacts.unshift({
    ...importFacts("Builder Representative").contacts[0],
    role: "BUILDER_CONTACT",
  });
  email.contacts.push(importFacts("Second Homeowner").contacts[0]);
  const attachment = importFacts("Resident Seen Earlier");
  const result = merge(email, attachment);
  assertEquals(result.issues, []);
  assertEquals(result.intakePayload?.contacts[0].name, "First Homeowner");
  assertEquals(result.structuredData.contacts.length, 4);
  assertEquals(result.intakePayload?.contacts.map((contact) => contact.name), [
    "First Homeowner",
    "Second Homeowner",
    "Resident Seen Earlier",
  ]);
});
Deno.test("first-homeowner policy does not skip an invalid first name to silently substitute another owner", () => {
  const result = merge(
    importFacts("x".repeat(101)),
    importFacts("Valid Other Owner"),
  );
  assertEquals(result.intakePayload, null);
  assertEquals(result.structuredData.contacts[0].name?.length, 101);
  assertEquals(result.issues.includes("MISSING_OR_AMBIGUOUS_HOMEOWNER"), true);
});
Deno.test("same named resident is not duplicated when email and PDF use HOMEOWNER/PRIMARY_CONTACT roles", () => {
  const homeowner = importFacts(), primary = importFacts();
  primary.contacts[0].role = "PRIMARY_CONTACT";
  const result = merge(homeowner, primary);
  assertEquals(result.structuredData.contacts.length, 1);
  assertEquals(result.structuredData.contacts[0].role, "HOMEOWNER");
  assertEquals(result.intakePayload?.contacts.length, 1);
});
Deno.test("owner length is not silently truncated to fit the database", () => {
  const result = merge(importFacts("x".repeat(101)));
  assertEquals(result.intakePayload, null);
  assertEquals(result.structuredData.contacts[0].name?.length, 101);
});
Deno.test("contradictory lot values preserve leading zeros, alternatives and source IDs", () => {
  const email = importFacts(), pdf = importFacts();
  email.property.lotNumber = "0012";
  pdf.property.lotNumber = "12";
  const result = merge(email, pdf);
  assertEquals(result.intakePayload?.property.lotNumber, null);
  assertEquals(
    result.conflicts.find((conflict) => conflict.path === "property.lotNumber")
      ?.candidates.map((entry) => entry.value),
    ["0012", "12"],
  );
});
Deno.test("exact cross-source work repetitions combine evidence without duplicating the item", () => {
  const result = merge(importFacts(), importFacts());
  assertEquals(result.intakePayload?.items.length, 1);
  assertEquals(result.provenance["serviceItems.0.description"].length, 2);
});
Deno.test("identical items within one original source keep their multiplicity", () => {
  const facts = importFacts();
  facts.serviceItems.push(structuredClone(facts.serviceItems[0]));
  assertEquals(merge(facts).intakePayload?.items.length, 2);
});
Deno.test("different explicit work orders cannot collapse their identically described items", () => {
  const one = importFacts(), two = importFacts();
  one.document.workOrderNumbers = ["WO-1"];
  two.document.workOrderNumbers = ["WO-2"];
  assertEquals(merge(one, two).intakePayload?.items.length, 2);
});
Deno.test("explicit non-Valtrim work is retained in evidence but excluded from intake", () => {
  const facts = importFacts();
  facts.serviceItems[0].assignedToValtrim = false;
  facts.serviceItems[0].assignedVendor = "Other Company";
  const result = merge(facts);
  assertEquals(result.structuredData.serviceItems.length, 1);
  assertEquals(result.excludedItemIndexes, [0]);
  assertEquals(result.intakePayload, null);
});
Deno.test("unknown assignment is reviewable, not an automatic confirmation of Valtrim scope", () => {
  const facts = importFacts();
  facts.serviceItems[0].assignedToValtrim = null;
  facts.serviceItems[0].assignedVendor = null;
  assertEquals(merge(facts).intakePayload?.items.length, 1);
  assertEquals(
    Object.hasOwn(merge(facts).intakePayload!, "valtrimItemsConfirmed"),
    false,
  );
});
Deno.test("descriptionless source items do not create fabricated work", () => {
  const facts = importFacts();
  facts.serviceItems[0].description = null;
  assertEquals(merge(facts).intakePayload, null);
});
Deno.test("explicit action can describe work when the separate description is absent", () => {
  const facts = importFacts();
  facts.serviceItems[0].description = null;
  facts.serviceItems[0].requestedAction = "Adjust door";
  assertEquals(merge(facts).intakePayload?.items[0].description, "Adjust door");
});
Deno.test("too many work items are not silently sliced to the form limit", () => {
  const facts = importFacts();
  facts.serviceItems = Array.from(
    { length: 26 },
    (_, index) => ({
      ...facts.serviceItems[0],
      sourceItemNumber: String(index + 1),
    }),
  );
  const result = merge(facts);
  assertEquals(result.structuredData.serviceItems.length, 26);
  assertEquals(result.issues.includes("WORK_ITEMS_EXCEED_INTAKE_LIMIT"), true);
  assertEquals(result.intakePayload, null);
});
Deno.test("long descriptions are preserved in evidence, not truncated into an automatic request", () => {
  const result = merge(importFacts("Elena Rivera", "x".repeat(1001)));
  assertEquals(result.intakePayload, null);
  assertEquals(result.structuredData.serviceItems[0].description?.length, 1001);
});
Deno.test("invalid contact methods remain in evidence while optional intake fields stay null", () => {
  const facts = importFacts();
  facts.contacts[0].email = "not an email";
  facts.contacts[0].phones = [{ type: "MOBILE", number: "9091234567" }];
  const result = merge(facts);
  assertEquals(result.intakePayload?.contacts[0].email, null);
  assertEquals(result.intakePayload?.contacts[0].phone, null);
  assertEquals(
    result.structuredData.contacts[0].phones[0].number,
    "9091234567",
  );
});
Deno.test("explicit valid +1 and +52 phone prefixes are preserved without assuming country", () => {
  for (const phone of ["+1 (909) 123-4567", "+52 664 123 4567"]) {
    const facts = importFacts();
    facts.contacts[0].phones = [{ type: "MOBILE", number: phone }];
    assertEquals(
      merge(facts).intakePayload?.contacts[0].phone,
      phone.replace(/[\s()-]/g, ""),
    );
  }
});
Deno.test("conflicting contact email values are not resolved by source order", () => {
  const one = importFacts(), two = importFacts();
  one.contacts[0].email = "one@example.com";
  two.contacts[0].email = "two@example.com";
  assertEquals(merge(one, two).intakePayload?.contacts[0].email, null);
  assertEquals(merge(two, one).intakePayload?.contacts[0].email, null);
});
Deno.test("known unique builder alias and Job take verified catalog coordinates", () => {
  const facts = importFacts();
  facts.property.builderName = "KB Homes";
  facts.property.communityName = "Arroyo";
  facts.property.coordinates = { raw: null, latitude: 0, longitude: 0 };
  const result = buildEmailImportIntake(wrap(facts), testCatalog, "2026-10-22");
  assertEquals(result.intakePayload?.property.jobId, 10);
  assertEquals(result.intakePayload?.property.latitude, 34.1);
  assertEquals(result.intakePayload?.property.longitude, -117.2);
});
Deno.test("ambiguous or invalid catalog location is not filled with zero coordinates", () => {
  const facts = importFacts();
  facts.property.communityName = "Arroyo";
  const duplicate = {
    ...testCatalog,
    jobs: [...testCatalog.jobs, { ...testCatalog.jobs[0], id: 11 }],
  };
  assertEquals(
    buildEmailImportIntake(wrap(facts), duplicate).intakePayload?.property
      .jobId,
    null,
  );
  const invalid = {
    ...testCatalog,
    jobs: [{ ...testCatalog.jobs[0], latitude: null }],
  };
  assertEquals(
    buildEmailImportIntake(wrap(facts), invalid).intakePayload?.property
      .latitude,
    null,
  );
});
Deno.test("contradictory explicit Builder facts cannot be bypassed by a globally matching Job", () => {
  const one = importFacts(), two = importFacts();
  one.property.builderName = "KB Home";
  two.property.builderName = "Other Builder";
  one.property.communityName = two.property.communityName = "Arroyo";
  assertEquals(
    buildEmailImportIntake(wrap(one, two), testCatalog).intakePayload?.property
      .jobId,
    null,
  );
});
Deno.test("date precedence uses original external email, order date, then nonfuture scheduled date", () => {
  const facts = importFacts();
  facts.document.sourceEmailSentDate = "2026-10-18";
  facts.document.orderDate = "2026-10-19";
  facts.document.scheduledDate = "2026-10-20";
  assertEquals(merge(facts).intakePayload?.request.reportedOn, "2026-10-18");
  assertEquals(
    merge(facts).intakePayload?.request.reportedOnSource,
    "EMAIL_SENT",
  );
  facts.document.sourceEmailSentDate = null;
  assertEquals(
    merge(facts).intakePayload?.request.reportedOnSource,
    "ORDER_DATE",
  );
  facts.document.orderDate = null;
  assertEquals(
    merge(facts).intakePayload?.request.reportedOnSource,
    "SCHEDULED_DATE",
  );
});
Deno.test("invalid, future or contradictory dates stay pending without Created on fallback", () => {
  for (const date of ["2026-02-30", "2026-10-23"]) {
    const facts = importFacts();
    facts.document.sourceEmailSentDate = date;
    assertEquals(merge(facts).intakePayload?.request.reportedOn, null);
  }
  const one = importFacts(), two = importFacts();
  one.document.sourceEmailSentDate = "2026-10-18";
  two.document.sourceEmailSentDate = "2026-10-19";
  one.document.orderDate = "2026-10-20";
  assertEquals(merge(one, two).intakePayload?.request.reportedOn, null);
});
Deno.test("multiple work categories use the confirmed request-level Multiple work types value", () => {
  const facts = importFacts();
  facts.serviceItems.push({
    ...facts.serviceItems[0],
    description: "Fix shelf",
    suggestedWorkType: "Shelving",
  });
  assertEquals(
    merge(facts).intakePayload?.request.workCategory,
    "MULTIPLE_WORK_TYPES",
  );
});
Deno.test("email intake applies the same Doors and General fix suggestions as the form, preserving source facts", () => {
  const facts = importFacts(
    "Elena Rivera",
    "The top part of bathroom door is rubbing. Hinge is loose",
  );
  facts.serviceItems[0].requestedAction = "adjustment";
  facts.serviceItems[0].suggestedWorkType = null;
  const before = JSON.stringify(facts);
  const result = merge(facts);
  assertEquals(result.intakePayload?.request, {
    reportedOn: null,
    serviceKind: "ADJUSTMENT",
    workCategory: "DOORS",
    serviceTask: "GENERAL_FIX",
    estimatedDurationMinutes: 30,
    crewSize: 1,
  });
  assertEquals(JSON.stringify(facts), before);
  assertEquals(result.structuredData.serviceItems[0].suggestedWorkType, null);
  assertEquals(
    result.warnings.some((warning) =>
      warning.includes("Work type inferred as Doors")
    ),
    true,
  );
});
Deno.test("General fix counts included described work only, across the 6/7 and 9/10 boundaries", () => {
  for (
    const [count, minutes] of [[1, 30], [6, 30], [7, 45], [9, 45], [10, 60]]
  ) {
    const facts = importFacts();
    facts.serviceItems = Array.from(
      { length: count },
      (_, index) => ({
        ...facts.serviceItems[0],
        description: `Adjust door ${index + 1}`,
      }),
    );
    facts.serviceItems.push({
      ...facts.serviceItems[0],
      description: "Replace shutters for another vendor",
      assignedToValtrim: false,
      suggestedServiceTask: "SHUTTER_REPLACEMENT",
    });
    const result = merge(facts);
    assertEquals(result.intakePayload?.items.length, count);
    assertEquals(
      result.intakePayload?.request.estimatedDurationMinutes,
      minutes,
    );
    assertEquals(result.intakePayload?.request.crewSize, 1);
  }
});
Deno.test("an explicit task conflict cannot fall back to General fix or invent duration and crew", () => {
  const one = importFacts(), two = importFacts();
  two.serviceItems[0].suggestedServiceTask = "EXTERIOR_DOOR_REPLACEMENT";
  const result = merge(one, two);
  assertEquals(
    result.conflicts.some((conflict) =>
      conflict.path === "serviceItems.0.suggestedServiceTask"
    ),
    true,
  );
  assertEquals(result.intakePayload?.request.serviceTask, null);
  assertEquals(result.intakePayload?.request.estimatedDurationMinutes, null);
  assertEquals(result.intakePayload?.request.crewSize, null);
});
Deno.test("different tasks in the same request remain pending rather than taking the first item's crew", () => {
  const facts = importFacts();
  facts.serviceItems.push({
    ...facts.serviceItems[0],
    description: "Replace shutters",
    suggestedServiceKind: "Replacement",
    suggestedServiceTask: "SHUTTER_REPLACEMENT",
  });
  const result = merge(facts);
  assertEquals(result.intakePayload?.request.serviceKind, null);
  assertEquals(result.intakePayload?.request.serviceTask, null);
  assertEquals(result.intakePayload?.request.estimatedDurationMinutes, null);
  assertEquals(result.intakePayload?.request.crewSize, null);
});
Deno.test("shutter replacement uses the approved 120 minute and two-person reference", () => {
  const facts = importFacts();
  facts.serviceItems[0].suggestedServiceTask = "SHUTTER_REPLACEMENT";
  facts.serviceItems[0].suggestedServiceKind = "Replacement";
  assertEquals(
    merge(facts).intakePayload?.request.estimatedDurationMinutes,
    120,
  );
  assertEquals(merge(facts).intakePayload?.request.crewSize, 2);
});
Deno.test("conflicting address pieces cannot be recombined into a fictitious address", () => {
  const one = importFacts(), two = importFacts();
  one.property.address.street = "100 Example Lane";
  two.property.address.street = "200 Different Lane";
  assertEquals(merge(one, two).intakePayload?.property.address, null);
});
