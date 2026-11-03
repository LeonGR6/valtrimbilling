import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { extractCustomerServiceEmailImport } from "./customerServiceEmailExtraction.ts";
import { analyzeCustomerServiceEmail } from "./customerServiceEmailAnalysis.ts";
import {
  analysisFixture,
  importFacts,
  testCatalog,
} from "./customerServiceEmailTestFixtures.ts";

async function adapterFixture() {
  const fixture = await analysisFixture();
  const row = {
    id: fixture.receipt.id,
    request_id: null as number | null,
    source_status: "AVAILABLE",
    source_payload: fixture.receipt.sourcePayload,
    source_manifest: [],
    attachment_refs: [],
    analysis_payload: null as unknown,
  };
  const requests: Array<
    {
      path: string;
      body: Record<string, unknown> | null;
      profile: string | null;
    }
  > = [];
  let recordingFailure = false;
  let race = false;
  const client = createClient("https://supabase.test", "server-test-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const path = new URL(String(input)).pathname;
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : null;
        const headers = new Headers(init?.headers);
        requests.push({
          path,
          body,
          profile: headers.get("content-profile") ??
            headers.get("accept-profile"),
        });
        if (path.endsWith("/service_request_imports")) {
          return Promise.resolve(Response.json([row]));
        }
        if (
          path.endsWith("/builders") || path.endsWith("/jobs")
        ) return Promise.resolve(Response.json([]));
        if (path.endsWith("/record_customer_service_import_analysis")) {
          if (recordingFailure) {
            return Promise.resolve(
              Response.json(
                { code: "XX000", message: "Database unavailable" },
                { status: 400 },
              ),
            );
          }
          return Promise.resolve(
            Response.json({
              importId: row.id,
              requestId: race ? 999 : null,
              idempotentReplay: race ||
                JSON.stringify(row.analysis_payload) ===
                  JSON.stringify(body?.p_report),
              analysisPayload: race ? row.analysis_payload : body?.p_report,
            }),
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    },
  });
  return {
    ...fixture,
    row,
    requests,
    client,
    failRecording: () => {
      recordingFailure = true;
    },
    setRace: () => {
      race = true;
    },
  };
}

for (const issue of [null, "SOURCE_FAILED", "MISSING_OR_AMBIGUOUS_HOMEOWNER"]) {
  Deno.test(`selective text repair is enabled only for a reported missing homeowner: ${issue}`, async () => {
    const f = await adapterFixture();
    const incomplete = importFacts();
    incomplete.contacts[0].name = null;
    incomplete.contacts[0].sourceLabel = "Elena Rivera";
    const previous = await analyzeCustomerServiceEmail({
      ...f,
      extractor: {
        ...f.extractor,
        text: () =>
          Promise.resolve({
            model: "legacy",
            structuredData: incomplete,
            usageInfo: null,
          }),
      },
    });
    delete previous.sources[0].contactNameVersion;
    f.row.analysis_payload = issue === null
      ? null
      : { ...previous, issues: [issue] };
    const result = await extractCustomerServiceEmailImport(
      f.client,
      f.receipt.id,
      {
        extractor: f.extractor,
        checkpoint: previous.sources,
      },
    );
    const repair = issue === "MISSING_OR_AMBIGUOUS_HOMEOWNER";
    assertEquals(f.calls.text.length, repair ? 1 : 0);
    assertEquals(
      result.report?.sources[0].contactNameVersion,
      repair ? 1 : undefined,
    );
    assertEquals(
      result.report?.outcome,
      repair ? "READY_FOR_INTAKE" : "NEEDS_ATTENTION",
    );
  });
}

Deno.test("backend adapter reads source/catalog and retains analysis without creating a request", async () => {
  const fixture = await adapterFixture();
  const result = await extractCustomerServiceEmailImport(
    fixture.client,
    fixture.row.id,
    { extractor: fixture.extractor, today: fixture.today },
  );
  assertEquals(result.report?.outcome, "READY_FOR_INTAKE");
  assertEquals(result.requestId, null);
  assertEquals(
    fixture.requests.filter((call) =>
      call.path.endsWith("record_customer_service_import_analysis")
    ).length,
    1,
  );
  assertEquals(
    fixture.requests.every((call) => call.profile === "valtrim"),
    true,
  );
  assertEquals(
    fixture.requests.some((call) =>
      /save_customer_service|mark_customer_service/.test(call.path)
    ),
    false,
  );
});
Deno.test("linked import skips provider work and does not overwrite analysis or human changes", async () => {
  const fixture = await adapterFixture();
  fixture.row.request_id = 55;
  const result = await extractCustomerServiceEmailImport(
    fixture.client,
    fixture.row.id,
    { extractor: fixture.extractor },
  );
  assertEquals(result.requestId, 55);
  assertEquals(result.idempotentReplay, true);
  assertEquals(fixture.requests.length, 1);
  assertEquals(fixture.calls.text.length, 0);
});
Deno.test("successful stored analysis is reused without repeating paid inference", async () => {
  const fixture = await adapterFixture();
  fixture.row.analysis_payload = await analyzeCustomerServiceEmail(fixture);
  fixture.calls.text.length = 0;
  const result = await extractCustomerServiceEmailImport(
    fixture.client,
    fixture.row.id,
    { extractor: fixture.extractor },
  );
  assertEquals(result.idempotentReplay, true);
  assertEquals(fixture.requests.length, 4);
  assertEquals(fixture.calls.text.length, 0);
});
Deno.test("unavailable original fails before inference or report writes", async () => {
  const fixture = await adapterFixture();
  fixture.row.source_status = "REJECTED";
  await assertRejects(
    () =>
      extractCustomerServiceEmailImport(fixture.client, fixture.row.id, {
        extractor: fixture.extractor,
      }),
    Error,
    "AVAILABLE",
  );
  assertEquals(fixture.requests.length, 1);
});
Deno.test("cached extraction cannot retain a Job that is no longer active in the current catalog", async () => {
  const fixture = await adapterFixture();
  const facts = importFacts();
  facts.property.builderName = "KB Home";
  facts.property.communityName = "Arroyo";
  fixture.extractor.text = () =>
    Promise.resolve({
      model: "text-test",
      structuredData: facts,
      usageInfo: null,
    });
  const cached = await analyzeCustomerServiceEmail({
    ...fixture,
    catalog: testCatalog,
  });
  assertEquals(cached.intakePayload?.property.jobId, 10);
  fixture.row.analysis_payload = cached;
  fixture.extractor.text = () =>
    Promise.reject(new Error("Cached source must not be inferred again"));
  // The adapter's current catalog response is empty: the former Job is inactive.
  const result = await extractCustomerServiceEmailImport(
    fixture.client,
    fixture.row.id,
  );
  assertEquals(result.report?.outcome, "READY_FOR_INTAKE");
  assertEquals(result.report?.intakePayload?.property.jobId, null);
  assertEquals(result.report?.intakePayload?.property.latitude, null);
  assertEquals(
    result.report?.sources[0].structuredData?.property.communityName,
    "Arroyo",
  );
  assertEquals(result.idempotentReplay, false);
});
Deno.test("recording failure is propagated rather than reported as durable extraction success", async () => {
  const fixture = await adapterFixture();
  fixture.failRecording();
  let failed = false;
  try {
    await extractCustomerServiceEmailImport(fixture.client, fixture.row.id, {
      extractor: fixture.extractor,
    });
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
Deno.test("request created by another worker wins over a late local analysis", async () => {
  const fixture = await adapterFixture();
  fixture.setRace();
  const result = await extractCustomerServiceEmailImport(
    fixture.client,
    fixture.row.id,
    { extractor: fixture.extractor },
  );
  assertEquals(result.requestId, 999);
  assertEquals(result.idempotentReplay, true);
  assertEquals(result.report, null);
});
