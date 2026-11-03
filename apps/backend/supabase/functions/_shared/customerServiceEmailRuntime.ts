// Cooperative continuation is not an analysis failure. It must escape source
// error handlers so the next invocation can resume the retained source results.
export class EmailImportContinuation extends Error {
  constructor(readonly retryAfterSeconds = 0) {
    super("Email analysis continuation required");
  }
}

export class EmailImportSourceFailure extends Error {
  constructor(
    readonly retryable: boolean,
    readonly code: string,
    readonly retryAfterSeconds = 0,
  ) {
    super("Source analysis failed");
  }
}

export function isTransientEmailImportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  const status = Number(
    value.providerStatus ?? value.status ?? value.statusCode,
  );
  return [408, 425, 429].includes(status) || status >= 500 && status <= 599 ||
    ["AbortError", "TimeoutError"].includes(String(value.name)) ||
    ["40001", "40P01", "08000", "08003", "08006", "57014", "NETWORK_ERROR"]
      .includes(String(value.code)) ||
    ["GRAPH_THROTTLED", "GRAPH_UNAVAILABLE"].includes(String(value.code)) ||
    error instanceof TypeError &&
      /fetch|network|connection/i.test(error.message);
}

// Bound BOTH headers and body. Cleanup requests retain a short independent
// allowance so an elapsed inference budget does not skip provider-file deletion.
export function emailWorkerFetch(
  deadline: number,
  fetcher: typeof fetch = fetch,
  now = () => performance.now(),
  maxRequestMs = 45_000,
): typeof fetch {
  return async (input, init) => {
    const cleanup = init?.method === "DELETE" &&
      String(input).startsWith("https://api.mistral.ai/v1/files/");
    const remaining = cleanup
      ? 8_000
      : Math.min(maxRequestMs, deadline - now());
    if (remaining <= 0) {
      throw new DOMException("Worker deadline reached", "TimeoutError");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    const signals = [controller.signal, ...(init?.signal ? [init.signal] : [])];
    try {
      const response = await fetcher(input, {
        ...init,
        signal: AbortSignal.any(signals),
      });
      const bytes = await response.arrayBuffer();
      return new Response(
        [204, 205, 304].includes(response.status) ? null : bytes,
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
