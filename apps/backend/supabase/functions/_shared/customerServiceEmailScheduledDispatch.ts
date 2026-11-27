// The database never puts permanent keys in pg_net. Bind its short-lived HMAC
// to one endpoint, one target and one expiry, then consume the durable nonce.
export function withCustomerServiceEmailScheduledDispatch(options: {
  kind: "SYNC" | "WORKER" | "RECONCILE";
  secret: string;
  handler: (request: Request) => Promise<Response>;
  consume: (
    identity: {
      p_invocation_id: string;
      p_kind: string;
      p_target_id: string;
      p_expires_ms: number;
    },
  ) => Promise<boolean>;
  now?: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    const keys = [
      "x-valtrim-email-dispatch",
      "x-valtrim-email-dispatch-expires",
      "x-valtrim-email-dispatch-signature",
    ];
    if (!keys.some((key) => request.headers.has(key))) {
      return options.handler(request);
    }
    const deny = () =>
      Response.json({ error: "INVALID_SCHEDULED_DISPATCH" }, { status: 401 });
    const id = request.headers.get(keys[0]) ?? "";
    const expires = request.headers.get(keys[1]) ?? "";
    const signature = request.headers.get(keys[2]) ?? "";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const expiry = Number(expires);
    const now = (options.now ?? Date.now)();
    if (
      request.method !== "POST" || !uuid.test(id) ||
      !/^\d{13}$/.test(expires) ||
      !/^[0-9a-f]{64}$/.test(signature) || expiry <= now ||
      expiry > now + 240_000 || options.secret.trim().length < 32
    ) return deny();
    try {
      const reader = request.body?.getReader();
      if (!reader) return deny();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1024) {
            await reader.cancel();
            return deny();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const targetKey = options.kind === "WORKER" ? "importId" : "connectionId";
      if (
        !body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof body[targetKey] !== "string" || !uuid.test(body[targetKey])
      ) return deny();
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(options.secret.trim()),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signatureBytes = Uint8Array.from(
        signature.match(/../g)!,
        (pair) => parseInt(pair, 16),
      );
      const valid = await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        new TextEncoder().encode(
          `${id}:${options.kind}:${expires}:${body[targetKey]}`,
        ),
      );
      if (!valid) return deny();
      if (
        !await options.consume({
          p_invocation_id: id,
          p_kind: options.kind,
          p_target_id: body[targetKey],
          p_expires_ms: expiry,
        })
      ) return deny();
      // Reuse the exact manual handler and all its validation/feature gates.
      const headers = new Headers(request.headers);
      headers.set(
        options.kind === "WORKER"
          ? "x-valtrim-email-worker-secret"
          : "x-valtrim-email-sync-secret",
        options.secret.trim(),
      );
      return await options.handler(
        new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
    } catch {
      return Response.json({ error: "SCHEDULED_DISPATCH_NOT_CONFIRMED" }, {
        status: 503,
      });
    }
  };
}
