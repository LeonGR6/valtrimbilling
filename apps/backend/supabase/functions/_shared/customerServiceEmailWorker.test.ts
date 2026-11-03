import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  createCustomerServiceEmailWorkerHandler,
  processCustomerServiceEmailImport,
} from "./customerServiceEmailWorker.ts";
import {
  analyzeCustomerServiceEmail,
  type AnalyzedImportSource,
} from "./customerServiceEmailAnalysis.ts";
import {
  analysisFixture,
  graphAnalysisFixture,
  importFacts,
  importPdf,
  importPng,
  TEST_IMPORT_ID,
} from "./customerServiceEmailTestFixtures.ts";
import { EmailImportContinuation } from "./customerServiceEmailRuntime.ts";
import { MistralOcrError } from "./mistralOcr.ts";
import { containsEmailBinary } from "./customerServiceEmailSourcePolicy.ts";
import workerConfig from "../customer-service-email-worker/deno.json" with {
  type: "json",
};
import sharedConfig from "../deno.json" with { type: "json" };

Deno.test("worker deployment resolves the same pinned imports as local checks", () => {
  assertEquals(workerConfig.imports, sharedConfig.imports);
});

async function workerFixture(graphImages = false) {
  const fixture = graphImages
    ? await graphAnalysisFixture([importPng(), importPng()])
    : await analysisFixture();
  const state = {
    claimed: false,
    requestId: null as number | null,
    report: null as unknown,
    checkpoint: [] as AnalyzedImportSource[],
    idle: false,
    leaseLost: false,
    finishFailure: false,
    invalidSave: false,
    writes: 0,
    retryDelay: 0,
  };
  const actions: string[] = [];
  const routes: string[] = [];
  const client = createClient("https://supabase.test", "system-test-key", {
    db: { schema: "valtrim" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const route = new URL(String(input)).pathname.split("/").at(-1)!;
        routes.push(route);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (graphImages) assertEquals(containsEmailBinary(body), false);
        const reply = (data: unknown) => Promise.resolve(Response.json(data));
        if (route === "claim_customer_service_email_import_v2") {
          if (
            state.idle || state.claimed && state.requestId === null
          ) return reply(null);
          if (state.requestId !== null) {
            return reply({
              importId: TEST_IMPORT_ID,
              requestId: state.requestId,
              status: "PROCESSED",
              idempotentReplay: true,
            });
          }
          state.claimed = true;
          return reply({
            importId: TEST_IMPORT_ID,
            requestId: null,
            workerToken: "test-lease",
            checkpoint: { sources: state.checkpoint },
          });
        }
        if (route === "service_request_imports") {
          return reply([{
            id: TEST_IMPORT_ID,
            request_id: state.requestId,
            source_status: "AVAILABLE",
            source_payload: fixture.receipt.sourcePayload,
            source_manifest: fixture.receipt.sourceManifest,
            attachment_refs: fixture.receipt.attachmentRefs,
            source_contract_version: fixture.receipt.sourceContractVersion ?? 1,
            source_connection_id: fixture.receipt.sourceConnectionId,
            analysis_payload: state.report,
          }]);
        }
        if (["builders", "jobs"].includes(route)) return reply([]);
        if (route === "read_customer_service_graph_image_source") {
          return reply({
            importId: TEST_IMPORT_ID,
            connectionId: fixture.receipt.sourceConnectionId,
            connectionAvailable: true,
            tenantId: "00000000-0000-4000-8000-000000000011",
            mailboxId: "00000000-0000-4000-8000-000000000013",
            folderId: "original-folder",
            messageId: "immutable-message",
            retryNotBefore: null,
            images: fixture.receipt.sourceManifest,
          });
        }
        if (route === "renew_customer_service_email_worker") {
          if (state.leaseLost) {
            return Promise.resolve(
              Response.json({ code: "55000", message: "lease expired" }, {
                status: 400,
              }),
            );
          }
          return reply(null);
        }
        if (route === "checkpoint_customer_service_email_worker") {
          state.checkpoint = state.checkpoint.filter((source) =>
            source.sourceId !== body.p_source.sourceId
          );
          state.checkpoint.push(body.p_source);
          return reply(null);
        }
        if (route === "record_customer_service_worker_analysis") {
          assertEquals(body.p_worker_token, "test-lease");
          state.report = body.p_report;
          return reply({
            requestId: null,
            analysisPayload: state.report,
            idempotentReplay: false,
          });
        }
        if (route === "finish_customer_service_email_worker_v2") {
          state.retryDelay = body.p_retry_after_seconds;
          assertEquals(body.p_worker_token, "test-lease");
          actions.push(body.p_action);
          if (state.finishFailure) {
            return Promise.resolve(
              Response.json({
                code: "08006",
                message: "lost response signed-url=secret",
              }, { status: 503 }),
            );
          }
          state.claimed = false;
          if (body.p_action === "COMMIT" && !state.invalidSave) {
            state.requestId = 77;
            state.writes++;
          }
          return reply({
            importId: TEST_IMPORT_ID,
            requestId: state.requestId,
            status: state.requestId
              ? "PROCESSED"
              : body.p_action === "ATTENTION" || state.invalidSave
              ? "NEEDS_ATTENTION"
              : "PENDING",
          });
        }
        throw new Error(`Unexpected worker route: ${route}`);
      },
    },
  });
  return { ...fixture, state, actions, routes, client };
}

Deno.test("new homeowner policy resumes an incomplete V2 report from valid checkpoints without Graph, Storage or inference", async () => {
  const cached = await graphAnalysisFixture([importPng(), importPng()]);
  const facts = importFacts("Zoe Rivera");
  facts.contacts.push(
    importFacts("Ana Rivera").contacts[0],
    importFacts("Luis Rivera").contacts[0],
  );
  cached.extractor.text = () =>
    Promise.resolve({
      model: "cached-text",
      structuredData: facts,
      usageInfo: null,
    });
  cached.extractor.image = () =>
    Promise.resolve({
      model: "cached-image",
      structuredData: importFacts(null, null),
      text: null,
      usageInfo: null,
    });
  const previous = await analyzeCustomerServiceEmail(cached);
  const f = await workerFixture(true);
  f.state.checkpoint = structuredClone(previous.sources);
  // PostgreSQL jsonb returns offset keys in a different order from JS creation.
  for (const source of f.state.checkpoint) {
    delete source.contactNameVersion;
    if (source.part) {
      source.part = { end: source.part.end, start: source.part.start };
    }
  }
  f.state.report = {
    ...previous,
    outcome: "NEEDS_ATTENTION",
    issues: ["MISSING_OR_AMBIGUOUS_HOMEOWNER"],
    intakePayload: null,
  };
  const checkpointBefore = JSON.stringify(f.state.checkpoint);
  let unexpectedInference = 0;
  const forbidden = () => {
    unexpectedInference++;
    return Promise.reject(new Error("Cached analysis must be reused"));
  };
  const result = await processCustomerServiceEmailImport(f.client, {
    importId: TEST_IMPORT_ID,
    extractor: { text: forbidden, image: forbidden, pdf: forbidden },
    graphFetcher: () => Promise.reject(new Error("Graph must not be called")),
  });
  const report = f.state.report as typeof previous;
  assertEquals(result.requestId, 77);
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(report.intakePayload?.contacts[0].name, "Zoe Rivera");
  assertEquals(report.intakePayload?.request.workCategory, "DOORS");
  assertEquals(report.intakePayload?.request.estimatedDurationMinutes, 30);
  assertEquals(report.intakePayload?.request.crewSize, 1);
  assertEquals(report.structuredData.contacts.map((contact) => contact.name), [
    "Zoe Rivera",
    "Ana Rivera",
    "Luis Rivera",
  ]);
  assertEquals(unexpectedInference, 0);
  assertEquals(JSON.stringify(f.state.checkpoint), checkpointBefore);
  assertEquals(
    f.routes.includes("read_customer_service_graph_image_source"),
    false,
  );
  assertEquals(
    f.routes.some((route) =>
      /storage|upload|object|service_request_import_files/.test(route)
    ),
    false,
  );
  assertEquals(f.state.writes, 1);
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, {
      importId: TEST_IMPORT_ID,
    })).idempotentReplay,
    true,
  );
  assertEquals(f.state.writes, 1);
});

async function legacyNamelessHomeownerFixture(splitText = false) {
  const f = await workerFixture(true);
  if (splitText) {
    f.receipt.sourcePayload = {
      bodyText: "Homeowner Elena Rivera. Adjust entry door.",
      bodyHtml: "<p>Homeowner Elena Rivera. Additional work details.</p>",
    };
  }
  const incomplete = importFacts();
  incomplete.contacts[0].name = null;
  incomplete.contacts[0].sourceLabel = "Elena Rivera";
  const previous = await analyzeCustomerServiceEmail({
    ...f,
    extractor: {
      ...f.extractor,
      text: () =>
        Promise.resolve({
          model: "legacy-text",
          structuredData: incomplete,
          usageInfo: null,
        }),
      image: () =>
        Promise.resolve({
          model: "cached-image",
          structuredData: importFacts(null, null),
          text: null,
          usageInfo: null,
        }),
    },
  });
  for (const source of previous.sources) delete source.contactNameVersion;
  assertEquals(previous.issues, ["MISSING_OR_AMBIGUOUS_HOMEOWNER"]);
  f.state.report = previous;
  f.state.checkpoint = structuredClone(previous.sources);
  return { ...f, previous };
}

Deno.test("name repair refreshes only legacy nameless text, retains both image checkpoints and replays the same request", async () => {
  const f = await legacyNamelessHomeownerFixture();
  const images = f.previous.sources.filter((source) => source.kind === "IMAGE");
  const options = {
    importId: TEST_IMPORT_ID,
    extractor: f.extractor,
    graphFetcher: () => Promise.reject(new Error("Graph must not be called")),
  };
  const result = await processCustomerServiceEmailImport(f.client, options);
  assertEquals(result.importId, TEST_IMPORT_ID);
  assertEquals(result.requestId, 77);
  assertEquals(f.calls.text.length, 1);
  assertEquals(f.calls.image, 0);
  assertEquals(f.calls.download, 0);
  assertEquals(f.state.checkpoint.filter((s) => s.kind === "IMAGE"), images);
  assertEquals(
    f.state.checkpoint.find((s) => s.kind === "EMAIL")?.contactNameVersion,
    1,
  );
  assertEquals(
    f.routes.includes("read_customer_service_graph_image_source"),
    false,
  );
  assertEquals(f.actions, ["COMMIT"]);
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options))
      .idempotentReplay,
    true,
  );
  assertEquals(f.state.writes, 1);
  assertEquals(f.calls.text.length, 1);
});

Deno.test("successful but still nameless text remains visible for review without repeated semantic refresh", async () => {
  const f = await legacyNamelessHomeownerFixture();
  let calls = 0;
  f.extractor.text = () => {
    calls++;
    return Promise.resolve({
      model: "new-text",
      structuredData: f.previous.sources[0].structuredData!,
      usageInfo: null,
    });
  };
  const options = { importId: TEST_IMPORT_ID, extractor: f.extractor };
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).status,
    "NEEDS_ATTENTION",
  );
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).status,
    "NEEDS_ATTENTION",
  );
  assertEquals(calls, 1);
  assertEquals(f.actions, ["ATTENTION", "ATTENTION"]);
  assertEquals(f.state.writes, 0);
  assertEquals(
    f.state.checkpoint.find((s) => s.kind === "EMAIL")?.structuredData
      ?.contacts[0].name,
    null,
  );
  assertEquals(
    f.routes.includes("read_customer_service_graph_image_source"),
    false,
  );
});

Deno.test("a transient name repair failure keeps completed images and retries only the failed text", async () => {
  const f = await legacyNamelessHomeownerFixture();
  const extractText = f.extractor.text;
  let fail = true;
  f.extractor.text = (text) =>
    fail
      ? Promise.reject(
        new MistralOcrError("provider detail must not persist", 429),
      )
      : extractText(text);
  const options = { importId: TEST_IMPORT_ID, extractor: f.extractor };
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).status,
    "PENDING",
  );
  assertEquals(
    f.state.checkpoint.find((s) => s.kind === "EMAIL")?.contactNameVersion,
    undefined,
  );
  assertEquals(
    f.state.checkpoint.filter((s) =>
      s.kind === "IMAGE" && s.status === "ANALYZED"
    ).length,
    2,
  );
  assertEquals(
    JSON.stringify(f.state.checkpoint).includes("provider detail"),
    false,
  );
  fail = false;
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).requestId,
    77,
  );
  assertEquals(f.actions, ["RETRY", "COMMIT"]);
  assertEquals(f.calls.image, 0);
  assertEquals(f.state.writes, 1);
  assertEquals(
    f.routes.includes("read_customer_service_graph_image_source"),
    false,
  );
});

Deno.test("continuation retains a corrected text version while the old aggregate report is still incomplete", async () => {
  const f = await legacyNamelessHomeownerFixture(true);
  const extractText = f.extractor.text;
  let clock = 0;
  f.extractor.text = (text) => {
    clock += 40_000;
    return extractText(text);
  };
  const options = { importId: TEST_IMPORT_ID, extractor: f.extractor };
  await processCustomerServiceEmailImport(f.client, {
    ...options,
    now: () => clock,
  });
  assertEquals(f.actions, ["CONTINUE"]);
  assertEquals(f.state.report, f.previous);
  assertEquals(
    f.state.checkpoint.filter((s) => s.contactNameVersion === 1).length,
    1,
  );
  await processCustomerServiceEmailImport(f.client, {
    ...options,
    now: () => 0,
  });
  assertEquals(f.actions, ["CONTINUE", "COMMIT"]);
  assertEquals(f.calls.text.length, 2);
  assertEquals(new Set(f.calls.text).size, 2);
  assertEquals(f.calls.image, 0);
  assertEquals(
    f.state.checkpoint.filter((s) => s.contactNameVersion === 1).length,
    2,
  );
  assertEquals(
    f.routes.includes("read_customer_service_graph_image_source"),
    false,
  );
  assertEquals(f.state.writes, 1);
});

Deno.test("V2 worker checkpoints Graph-only images, honors 429 delay, resumes just the pending image and replays one request", async () => {
  const f = await workerFixture(true);
  let fail = true;
  const graphReads: string[] = [];
  const options = {
    importId: TEST_IMPORT_ID,
    extractor: f.extractor,
    graphCredentials: {
      tenantId: "00000000-0000-4000-8000-000000000011",
      clientId: "00000000-0000-4000-8000-000000000012",
      clientSecret: "test-secret",
    },
    graphFetcher: ((url) => {
      if (String(url).startsWith("https://login.")) {
        return Promise.resolve(
          Response.json({
            access_token: "token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
        );
      }
      graphReads.push(String(url));
      return Promise.resolve(
        fail && String(url).includes("/file-2/")
          ? new Response("raw secret", {
            status: 429,
            headers: { "retry-after": "1200" },
          })
          : new Response(importPng()),
      );
    }) as typeof fetch,
  };
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).status,
    "PENDING",
  );
  assertEquals(f.state.retryDelay, 1200);
  assertEquals(f.state.writes, 0);
  assertEquals(
    f.state.checkpoint.filter((source) => source.status === "ANALYZED").length,
    2,
  );
  assertEquals(
    f.state.checkpoint.at(-1)?.error?.diagnosticCode,
    "GRAPH_THROTTLED",
  );
  assertEquals(
    JSON.stringify(f.state.checkpoint).includes("raw secret"),
    false,
  );
  fail = false;
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, options)).requestId,
    77,
  );
  const replay = await processCustomerServiceEmailImport(f.client, options);
  assertEquals(replay.idempotentReplay, true);
  assertEquals(f.state.writes, 1);
  assertEquals(f.calls.text.length, 1);
  assertEquals(f.calls.image, 2);
  assertEquals(
    graphReads.map((url) => url.includes("/file-1/") ? "file-1" : "file-2"),
    ["file-1", "file-2", "file-2"],
  );
  assertEquals(
    f.routes.some((route) =>
      /upload|stored_files|service_request_import_files|object/.test(route)
    ),
    false,
  );
});
Deno.test("worker connects source analysis to one unapproved request and returns replay on repeat", async () => {
  const f = await workerFixture();
  const first = await processCustomerServiceEmailImport(f.client, {
    importId: TEST_IMPORT_ID,
    extractor: f.extractor,
  });
  const second = await processCustomerServiceEmailImport(f.client, {
    importId: TEST_IMPORT_ID,
    extractor: f.extractor,
  });
  assertEquals(first.requestId, 77);
  assertEquals(second.idempotentReplay, true);
  assertEquals(f.state.writes, 1);
  assertEquals(f.calls.text.length, 1);
  assertEquals(f.actions, ["COMMIT"]);
  assertEquals(
    f.routes.some((route) =>
      /mark_customer_service|update_customer_service/.test(route)
    ),
    false,
  );
});
Deno.test("empty queue does no source work", async () => {
  const f = await workerFixture();
  f.state.idle = true;
  assertEquals(
    (await processCustomerServiceEmailImport(f.client)).status,
    "IDLE",
  );
  assertEquals(f.routes.length, 1);
});
Deno.test("two invocations cannot process the same reservation concurrently", async () => {
  const f = await workerFixture();
  const results = await Promise.all(
    [1, 2].map(() =>
      processCustomerServiceEmailImport(f.client, { extractor: f.extractor })
    ),
  );
  assertEquals(results.map((r) => r.status).sort(), ["IDLE", "PROCESSED"]);
  assertEquals(f.state.writes, 1);
});
Deno.test("missing minimum goes to attention without attempting intake save", async () => {
  const f = await workerFixture();
  f.extractor.text = () =>
    Promise.resolve({
      model: "test",
      structuredData: importFacts(null),
      usageInfo: null,
    });
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, {
      extractor: f.extractor,
    })).status,
    "NEEDS_ATTENTION",
  );
  assertEquals(f.actions, ["ATTENTION"]);
  assertEquals(f.state.writes, 0);
});
for (const status of [429, 503, 400, 401]) {
  Deno.test(`provider ${status} ${status >= 429 ? "schedules a retry" : "requires intervention"} rather than saving partial facts`, async () => {
    const f = await workerFixture();
    f.extractor.text = () =>
      Promise.reject(new MistralOcrError("provider secret detail", status));
    await processCustomerServiceEmailImport(f.client, {
      extractor: f.extractor,
    });
    assertEquals(f.actions, [status >= 429 ? "RETRY" : "ATTENTION"]);
    assertEquals(f.state.writes, 0);
    assertEquals(
      JSON.stringify(f.state.report).includes("provider secret detail"),
      false,
    );
  });
}
Deno.test("cooperative deadline yields without a failure or provider call", async () => {
  const f = await workerFixture();
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, {
      extractor: f.extractor,
      budgetMs: 1,
    })).status,
    "PENDING",
  );
  assertEquals(f.actions, ["CONTINUE"]);
  assertEquals(f.calls.text.length, 0);
  assertEquals(f.state.report, null);
});
Deno.test("slow permanent source failure is retained and stops, rather than yielding indefinitely", async () => {
  const f = await workerFixture();
  f.receipt.sourcePayload = { bodyText: "A".repeat(32000) + "B".repeat(32000) };
  let clock = 0;
  f.extractor.text = () => {
    clock += 40_000;
    return Promise.reject(new MistralOcrError("invalid credentials", 401));
  };
  const result = await processCustomerServiceEmailImport(f.client, {
    extractor: f.extractor,
    now: () => clock,
  });
  assertEquals(result.status, "NEEDS_ATTENTION");
  assertEquals(f.actions, ["ATTENTION"]);
  assertEquals(f.state.checkpoint[0].status, "FAILED");
  assertEquals(f.state.checkpoint[0].structuredData, null);
});
Deno.test("retry reuses earlier successful sources and repeats only the failed source", async () => {
  const f = await workerFixture();
  f.receipt.sourcePayload = {
    bodyText: "Owner and work",
    bodyHtml: "<p>Different source text</p>",
  };
  let failSecond = true;
  const calls: string[] = [];
  f.extractor.text = (text) => {
    calls.push(text);
    if (text.includes("Different") && failSecond) {
      return Promise.reject(new MistralOcrError("busy", 429));
    }
    return Promise.resolve({
      model: "test",
      structuredData: importFacts(),
      usageInfo: null,
    });
  };
  await processCustomerServiceEmailImport(f.client, { extractor: f.extractor });
  failSecond = false;
  await processCustomerServiceEmailImport(f.client, { extractor: f.extractor });
  assertEquals(f.actions, ["RETRY", "COMMIT"]);
  assertEquals(
    calls.filter((text) => text.includes("Owner and work")).length,
    1,
  );
  assertEquals(calls.filter((text) => text.includes("Different")).length, 2);
});
Deno.test("expired reservation cannot record analysis or complete another worker's work", async () => {
  const f = await workerFixture();
  f.state.leaseLost = true;
  assertEquals(
    (await processCustomerServiceEmailImport(f.client, {
      extractor: f.extractor,
    })).status,
    "LEASE_LOST",
  );
  assertEquals(f.actions, []);
  assertEquals(f.state.report, null);
  assertEquals(f.calls.text.length, 0);
});
Deno.test("lost completion response propagates; no fabricated success or second completion write", async () => {
  const f = await workerFixture();
  f.state.finishFailure = true;
  await assertRejects(
    async () => {
      try {
        await processCustomerServiceEmailImport(f.client, {
          extractor: f.extractor,
        });
      } catch {
        throw new Error("unconfirmed");
      }
    },
    Error,
    "unconfirmed",
  );
  assertEquals(f.actions, ["COMMIT"]);
});
Deno.test("invalid intake returned by existing saver is attention, not processing success", async () => {
  const f = await workerFixture();
  f.state.invalidSave = true;
  const result = await processCustomerServiceEmailImport(f.client, {
    extractor: f.extractor,
  });
  assertEquals(result.status, "NEEDS_ATTENTION");
  assertEquals(result.requestId, null);
});
Deno.test("successful checkpoints survive a continuation and avoid repeated paid text analysis", async () => {
  const f = await workerFixture();
  f.receipt.sourcePayload = {
    bodyText: "A".repeat(32000) + "B".repeat(32000) + "C".repeat(5000),
  };
  let clock = 0;
  const original = f.extractor.text;
  f.extractor.text = (text) => {
    clock += 40_000;
    return original(text);
  };
  await processCustomerServiceEmailImport(f.client, {
    extractor: f.extractor,
    now: () => clock,
  });
  assertEquals(f.actions, ["CONTINUE"]);
  assertEquals(f.state.checkpoint.length, 1);
  const paidFirst = f.calls.text[0];
  await processCustomerServiceEmailImport(f.client, {
    extractor: f.extractor,
    now: () => 0,
  });
  assertEquals(f.actions, ["CONTINUE", "COMMIT"]);
  assertEquals(f.calls.text.filter((text) => text === paidFirst).length, 1);
});
Deno.test("PDF OCR checkpoint resumes pending form fields without repeating OCR", async () => {
  const f = await analysisFixture([await importPdf({ form: true })]);
  f.receipt.sourcePayload = {};
  const saved: AnalyzedImportSource[] = [];
  let steps = 0;
  await assertRejects(
    () =>
      analyzeCustomerServiceEmail({
        ...f,
        onSource: (source) => {
          saved.push(structuredClone(source));
          return Promise.resolve();
        },
        beforeSource: () => {
          if (++steps === 2) {
            return Promise.reject(new EmailImportContinuation());
          }
          return Promise.resolve();
        },
      }),
    EmailImportContinuation,
  );
  const report = await analyzeCustomerServiceEmail({ ...f, checkpoint: saved });
  assertEquals(report.outcome, "READY_FOR_INTAKE");
  assertEquals(f.calls.pdf, 1);
  assertEquals(f.calls.text.length, 1);
});
Deno.test("image checkpoints do not repeat vision; mismatched source identities cannot be restored", async () => {
  const f = await analysisFixture([importPng()]);
  const report = await analyzeCustomerServiceEmail(f);
  await analyzeCustomerServiceEmail({ ...f, checkpoint: report.sources });
  assertEquals(f.calls.image, 1);
  report.sources[1].sha256 = "b".repeat(64);
  await analyzeCustomerServiceEmail({ ...f, checkpoint: report.sources });
  assertEquals(f.calls.image, 2);
});
Deno.test("checkpoint persistence failure is not mislabeled as failed PDF or image analysis", async () => {
  const f = await analysisFixture([await importPdf()]);
  await assertRejects(
    () =>
      analyzeCustomerServiceEmail({
        ...f,
        onSource: () => Promise.reject(new Error("checkpoint DB unavailable")),
      }),
    Error,
    "checkpoint DB unavailable",
  );
});

const secret = "a".repeat(64);
function httpFixture(
  overrides: Partial<
    Parameters<typeof createCustomerServiceEmailWorkerHandler>[0]
  > = {},
) {
  const calls: Array<string | undefined> = [];
  const handler = createCustomerServiceEmailWorkerHandler({
    secret,
    enabled: true,
    hasProviderKey: true,
    run: (id) => {
      calls.push(id);
      return Promise.resolve({ status: "IDLE" });
    },
    ...overrides,
  });
  const request = (
    body = "{}",
    headers: HeadersInit = { "x-valtrim-email-worker-secret": secret },
  ) => new Request("https://worker.test", { method: "POST", headers, body });
  return { handler, request, calls };
}
Deno.test("worker HTTP boundary refuses browser credentials and missing/wrong secrets before service access", async () => {
  const f = httpFixture();
  const credentials: HeadersInit[] = [{}, {
    Authorization: "Bearer signed-in-user",
  }, {
    "x-valtrim-email-worker-secret": "wrong",
  }];
  for (const headers of credentials) {
    assertEquals((await f.handler(f.request("{}", headers))).status, 401);
  }
  assertEquals(f.calls.length, 0);
});
Deno.test("worker HTTP boundary fails closed when disabled, secret is weak or provider key absent", async () => {
  for (
    const [overrides, status] of [[{ enabled: false }, 409], [{
      secret: "short",
    }, 503], [{ hasProviderKey: false }, 503]] as const
  ) {
    const f = httpFixture(overrides);
    assertEquals((await f.handler(f.request())).status, status);
    assertEquals(f.calls.length, 0);
  }
});
Deno.test("worker accepts only a bounded server command, never intake, workflow, filenames or retry policy", async () => {
  const f = httpFixture();
  for (
    const body of [
      "null",
      "[]",
      "{bad",
      '{"workflowStage":"READY_TO_PROPOSE"}',
      '{"importId":"../file"}',
      '{"maxAttempts":99}',
    ]
  ) {
    assertEquals((await f.handler(f.request(body))).status, 400);
  }
  assertEquals((await f.handler(f.request("x".repeat(1025)))).status, 413);
  assertEquals(f.calls.length, 0);
});
Deno.test("worker HTTP executes one next-or-specific import and returns sanitized infrastructure failures", async () => {
  const f = httpFixture();
  assertEquals((await f.handler(f.request())).status, 200);
  assertEquals(
    (await f.handler(f.request(JSON.stringify({ importId: TEST_IMPORT_ID }))))
      .status,
    200,
  );
  assertEquals(f.calls, [undefined, TEST_IMPORT_ID]);
  const failed = httpFixture({
    run: () => Promise.reject(new Error("signed-url=secret")),
  });
  const response = await failed.handler(failed.request());
  assertEquals(response.status, 503);
  assertEquals((await response.text()).includes("secret"), false);
  assertEquals(
    (await f.handler(new Request("https://worker.test"))).status,
    405,
  );
});
