// Reads the messages that Hyphen's UAT environment sent to the SPConnect webhook. That
// webhook still runs in a teammate's separate Supabase project, which exposes them only
// through its private public.spconnect_messages_uat view: that project's secret key can
// read it, its publishable key cannot. The first view was readable with the publishable
// key, which ships in the browser, and was removed for that on 24 Nov 2026.
//
// The secret key lives only in this project's function secrets (SPCONNECT_UAT_URL and
// SPCONNECT_UAT_SECRET_KEY) and never reaches the browser. This goes away once the
// webhook moves into our own project.

export const SPCONNECT_VIEW = "spconnect_messages_uat";
export const SPCONNECT_MESSAGE_LIMIT = 200;

export class SpconnectReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SpconnectReadError";
  }
}

// The newest messages first. The view decides which columns exist; the teammate's
// project answers only with its own errors, never with the key.
export async function readSpconnectMessages({ url, secretKey, fetcher = fetch }: {
  url?: string;
  secretKey?: string;
  fetcher?: typeof fetch;
}): Promise<unknown[]> {
  if (!url || !secretKey) {
    throw new SpconnectReadError(
      "The Hyphen UAT connection is not configured on the server. Set SPCONNECT_UAT_URL and SPCONNECT_UAT_SECRET_KEY.",
      503,
    );
  }

  const endpoint = new URL(`/rest/v1/${SPCONNECT_VIEW}`, url);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "received_at.desc");
  endpoint.searchParams.set("limit", String(SPCONNECT_MESSAGE_LIMIT));

  let response: Response;
  try {
    response = await fetcher(endpoint, { headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` } });
  } catch {
    throw new SpconnectReadError("Could not reach the Hyphen UAT project. Try again in a moment.", 502);
  }

  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) {
      throw new SpconnectReadError(`The Hyphen UAT project does not have the private ${SPCONNECT_VIEW} view yet.`, 502);
    }
    if (response.status === 401 || response.status === 403) {
      throw new SpconnectReadError("The Hyphen UAT project rejected the server key. Check SPCONNECT_UAT_SECRET_KEY.", 502);
    }
    throw new SpconnectReadError(`The Hyphen UAT project answered with status ${response.status}.`, 502);
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}
