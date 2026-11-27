type RetryResult = {
  importId: string;
  requestId: number | null;
  status: string;
  nextAttemptAt?: string | null;
};
type RetryCaller = {
  queue: (importId: string, expectedUpdatedAt: string) => Promise<RetryResult>;
  hold: (importId: string) => Promise<RetryResult>;
};

export function createCustomerServiceEmailRetryHandler(options: {
  authorize: (request: Request) => Promise<RetryCaller | Response>;
  enabled: boolean;
  hasProviderKey: boolean;
  run: (importId: string) => Promise<RetryResult>;
  now?: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, error: string) => Response.json({ error }, { status });
    if (request.method !== "POST") return reply(405, "Use POST.");
    try {
      const actor = await options.authorize(request);
      if (actor instanceof Response) return actor;
      if (!options.enabled) return reply(409, "WORKER_DISABLED: automatic processing is disabled.");
      if (!options.hasProviderKey) return reply(503, "The extraction provider is not configured.");
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 2048) {
              await reader.cancel();
              return reply(413, "The retry request is too large.");
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return reply(400, "Send a valid import identity and version."); }
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => !["importId", "expectedUpdatedAt"].includes(key))
        || typeof body.importId !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.importId)
        || typeof body.expectedUpdatedAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(body.expectedUpdatedAt)
        || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
        return reply(400, "Send a valid import identity and version.");
      }
      const queued = await actor.queue(body.importId, body.expectedUpdatedAt);
      if (queued.requestId != null || queued.status !== "PENDING") {
        return Response.json(queued);
      }
      if (queued.nextAttemptAt && Date.parse(queued.nextAttemptAt) > (options.now?.() ?? Date.now())) {
        return Response.json(await actor.hold(body.importId));
      }
      let result;
      try { result = await options.run(body.importId); }
      catch (error) {
        // Reconcile an unclaimed/yielded result when possible; never steal a lease.
        await actor.hold(body.importId).catch(() => undefined);
        throw error;
      }
      // An occupied/not-yet-due lease is not a failed save or a successful import.
      return Response.json(["PENDING", "IDLE", "LEASE_LOST"].includes(result.status)
        ? await actor.hold(body.importId) : result);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "42501") return reply(403, "You do not have permission to retry this import.");
      if (code === "P0002") return reply(404, "The import is unavailable.");
      if (code === "40001" || code === "55000") {
        return reply(409, "The import changed or cannot be retried. Refresh the view; use the form if the source was rejected.");
      }
      return reply(503, "The retry result was not confirmed. Refresh the view before trying again.");
    }
  };
}
