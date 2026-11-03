import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import {
  customerServiceSourceObjectPath,
  CustomerServiceSourcePdfConflictError,
  parseCustomerServiceRequestId,
  retainCustomerServiceSourcePdf,
  sha256Hex,
  storageFailureMessage,
} from "./customerServiceSourcePdf.ts";

Deno.test("recovery pin rejects a competing PDF before any upload or finalizer", async () => {
  const file = new File(["%PDF-other"], "recovery.pdf", { type: "application/pdf" });
  for (const expected of [
    { sha256: "a".repeat(64), sizeBytes: file.size, originalFilename: file.name },
    { sha256: await sha256Hex(await file.arrayBuffer()), sizeBytes: file.size + 1, originalFilename: file.name },
    { sha256: await sha256Hex(await file.arrayBuffer()), sizeBytes: file.size, originalFilename: "winner.pdf" },
  ]) {
    let writes = 0;
    await assertRejects(() => retainCustomerServiceSourcePdf({ file, alreadyAvailable: false, expectedIdentity: expected,
      upload: () => { writes++; return Promise.resolve(); }, download: () => Promise.resolve(new Blob()),
      finalize: () => { writes++; return Promise.resolve({}); },
    }), CustomerServiceSourcePdfConflictError);
    assertEquals(writes, 0);
  }
});

Deno.test("matching pinned recovery bytes can finish the same immutable upload", async () => {
  const file = new File(["%PDF-match"], "recovery.pdf", { type: "application/pdf" });
  const sha256 = await sha256Hex(await file.arrayBuffer());
  let writes = 0;
  const result = await retainCustomerServiceSourcePdf({ file, alreadyAvailable: false,
    expectedIdentity: { sha256, sizeBytes: file.size, originalFilename: file.name },
    upload: () => { writes++; return Promise.resolve(); }, download: () => Promise.resolve(file),
    finalize: (actual) => Promise.resolve(actual),
  });
  assertEquals(result, sha256);
  assertEquals(writes, 1);
});

Deno.test("normalizes positive Customer Service request ids", () => {
  assertEquals(parseCustomerServiceRequestId(42), 42);
  assertEquals(parseCustomerServiceRequestId(" 42 "), 42);
  assertEquals(parseCustomerServiceRequestId(0), null);
  assertEquals(parseCustomerServiceRequestId(-1), null);
  assertEquals(parseCustomerServiceRequestId("1.5"), null);
  assertEquals(parseCustomerServiceRequestId("request-1"), null);
  assertEquals(parseCustomerServiceRequestId(null), null);
});

Deno.test("uses one deterministic private object path per request", () => {
  assertEquals(
    customerServiceSourceObjectPath(42),
    "requests/42/source.pdf",
  );
});

Deno.test("calculates lowercase SHA-256", async () => {
  const bytes = new TextEncoder().encode("Valtrim PDF").buffer;
  assertEquals(
    await sha256Hex(bytes),
    "f3bab022e0b3003225cbd4d9e633beb05765f281917d222c158a6e82190cec1c",
  );
});

Deno.test("normalizes and caps stored failure details", () => {
  const message = storageFailureMessage(
    new Error(`  failed\n${"x".repeat(1100)}`),
  );
  assertMatch(message, /^Source PDF upload failed: failed x+$/);
  assertEquals(message.length, 1000);
});

function uploadFixture() {
  const file = new File(["%PDF-1.7\nAAAA"], "source.pdf", {
    type: "application/pdf",
  });
  const state = {
    object: null as Blob | null,
    committedHash: null as string | null,
    uploadCalls: 0,
    downloadCalls: 0,
    commits: 0,
  };
  const operations = {
    file,
    alreadyAvailable: false,
    upload: (bytes: Uint8Array): Promise<void> => {
      state.uploadCalls += 1;
      if (state.object) {
        return Promise.reject(new Error("Object already exists"));
      }
      state.object = new Blob([bytes as Uint8Array<ArrayBuffer>], {
        type: "application/pdf",
      });
      return Promise.resolve();
    },
    download: (): Promise<Blob> => {
      state.downloadCalls += 1;
      return state.object
        ? Promise.resolve(state.object)
        : Promise.reject(new Error("Not found"));
    },
    finalize: (sha256: string) => {
      if (state.committedHash && state.committedHash !== sha256) {
        return Promise.reject(new Error("An available PDF cannot be replaced"));
      }
      const replay = Boolean(state.committedHash);
      if (!replay) state.commits += 1;
      state.committedHash = sha256;
      return Promise.resolve({ fileId: 7, idempotentReplay: replay });
    },
  };
  return { state, operations };
}

Deno.test("retains a new PDF before finalizing, without a recovery download", async () => {
  const { state, operations } = uploadFixture();
  const result = await retainCustomerServiceSourcePdf(operations);
  assertEquals(result, { fileId: 7, idempotentReplay: false });
  assertEquals(await state.object?.text(), await operations.file.text());
  assertEquals(state.uploadCalls, 1);
  assertEquals(state.downloadCalls, 0);
  assertEquals(state.commits, 1);
});

Deno.test("recovers an upload whose successful response was lost", async () => {
  const { state, operations } = uploadFixture();
  await retainCustomerServiceSourcePdf({
    ...operations,
    upload: async (bytes) => {
      await operations.upload(bytes);
      throw new Error("Upload response lost");
    },
  });
  assertEquals(state.downloadCalls, 1);
  assertEquals(state.commits, 1);
  assertEquals(await state.object?.text(), await operations.file.text());
});

Deno.test("recovers an object left by an interrupted PENDING or FAILED upload", async () => {
  const { state, operations } = uploadFixture();
  await operations.upload(new Uint8Array(await operations.file.arrayBuffer()));
  const original = state.object;
  const result = await retainCustomerServiceSourcePdf(operations);
  assertEquals(result.fileId, 7);
  assertEquals(state.object, original);
  assertEquals(state.downloadCalls, 1);
  assertEquals(state.commits, 1);
});

Deno.test("a lost finalizer response preserves the committed object and permits AVAILABLE replay", async () => {
  const { state, operations } = uploadFixture();
  await assertRejects(
    () =>
      retainCustomerServiceSourcePdf({
        ...operations,
        finalize: async (sha256) => {
          await operations.finalize(sha256);
          throw new Error("Finalizer response lost after commit");
        },
      }),
    Error,
    "Finalizer response lost after commit",
  );
  const original = state.object;
  assertEquals(state.commits, 1);
  assertEquals(await original?.text(), await operations.file.text());
  const result = await retainCustomerServiceSourcePdf({
    ...operations,
    alreadyAvailable: true,
  });
  assertEquals(result, { fileId: 7, idempotentReplay: true });
  assertEquals(state.object, original);
  assertEquals(state.uploadCalls, 1);
  assertEquals(state.downloadCalls, 0);
  assertEquals(state.commits, 1);
});

Deno.test("a failure before finalization keeps the uploaded object for the next attempt", async () => {
  const { state, operations } = uploadFixture();
  await assertRejects(
    () =>
      retainCustomerServiceSourcePdf({
        ...operations,
        finalize: () => Promise.reject(new Error("Database unavailable")),
      }),
    Error,
    "Database unavailable",
  );
  const original = state.object;
  assertEquals(state.commits, 0);
  await retainCustomerServiceSourcePdf(operations);
  assertEquals(state.object, original);
  assertEquals(state.downloadCalls, 1);
  assertEquals(state.commits, 1);
});

Deno.test("concurrent retries of the same PDF retain one object and commit one file identity", async () => {
  const { state, operations } = uploadFixture();
  const results = await Promise.all([
    retainCustomerServiceSourcePdf(operations),
    retainCustomerServiceSourcePdf(operations),
  ]);
  assertEquals(results.map((result) => result.fileId), [7, 7]);
  assertEquals(results.filter((result) => !result.idempotentReplay).length, 1);
  assertEquals(await state.object?.text(), await operations.file.text());
  assertEquals(state.commits, 1);
  assertEquals(state.downloadCalls, 1);
});

Deno.test("concurrent different PDFs cannot replace the winning object, even at the same size", async () => {
  const { state, operations } = uploadFixture();
  const differentFile = new File(["%PDF-1.7\nBBBB"], "source.pdf", {
    type: "application/pdf",
  });
  assertEquals(differentFile.size, operations.file.size);
  const results = await Promise.allSettled([
    retainCustomerServiceSourcePdf(operations),
    retainCustomerServiceSourcePdf({ ...operations, file: differentFile }),
  ]);
  // Reading/hashing is asynchronous: either upload may reach Storage first,
  // regardless of invocation order. Verify the winning identity, not its index.
  assertEquals(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const winner = results[0].status === "fulfilled" ? operations.file : differentFile;
  const rejected = results.find((result) => result.status === "rejected");
  assertEquals(rejected?.reason instanceof CustomerServiceSourcePdfConflictError, true);
  assertEquals(await state.object?.text(), await winner.text());
  assertEquals(state.committedHash, await sha256Hex(await winner.arrayBuffer()));
  assertEquals(state.uploadCalls, 2);
  assertEquals(state.downloadCalls, 1);
  assertEquals(state.commits, 1);
});

Deno.test("an unverified upload remains an error and never finalizes or modifies an existing object", async () => {
  const { state, operations } = uploadFixture();
  await operations.upload(new Uint8Array(await operations.file.arrayBuffer()));
  const original = state.object;
  await assertRejects(
    () =>
      retainCustomerServiceSourcePdf({
        ...operations,
        download: () => Promise.reject(new Error("Storage unavailable")),
      }),
    Error,
    "Object already exists",
  );
  assertEquals(state.object, original);
  assertEquals(state.commits, 0);
});
