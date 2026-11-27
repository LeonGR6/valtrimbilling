// The customer's link to a proposal (block B, step B5). Like the Builder follow-up
// links, it signs the proposal's public_id with a server secret (HMAC SHA-256); no token
// is stored, and the link only works while the proposal waits for the customer. A
// different label keeps a Builder link from ever working here, and the other way round.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const PROPOSAL_LINK_SECRET_ENV = "CUSTOMER_SERVICE_PROPOSAL_LINK_SECRET";
export const PUBLIC_APP_URL_ENV = "CUSTOMER_SERVICE_PUBLIC_APP_URL";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function signature(publicId: string, secret: string) {
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error(`${PROPOSAL_LINK_SECRET_ENV} must contain at least 32 bytes.`);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`valtrim-customer-service-proposal:${publicId.toLowerCase()}`),
  );
  return base64Url(new Uint8Array(signed));
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function createProposalToken(publicId: string, secret: string) {
  const normalized = publicId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error("The proposal id is invalid.");
  return `${normalized}.${await signature(normalized, secret)}`;
}

// The proposal's public_id, or null when the token was not signed by us.
export async function verifyProposalToken(token: string, secret: string) {
  const [publicId, supplied, ...rest] = String(token ?? "").trim().split(".");
  if (rest.length || !UUID_PATTERN.test(publicId ?? "") || !SIGNATURE_PATTERN.test(supplied ?? "")) return null;
  const normalized = publicId.toLowerCase();
  return constantTimeEqual(supplied, await signature(normalized, secret)) ? normalized : null;
}

// The configured link settings, or null when the links are off (no secret or no
// address): the emails then keep asking the customer to reply.
export function proposalLinkSettings(env: { secret?: string; publicAppUrl?: string }) {
  const secret = env.secret?.trim() ?? "";
  const base = env.publicAppUrl?.trim().replace(/\/+$/u, "") ?? "";
  if (new TextEncoder().encode(secret).length < 32 || !/^https?:\/\/[^\s/]+/iu.test(base)) return null;
  return { secret, base };
}

// The buttons of a proposal's emails from the server settings, or null when the links
// are off. optionNumbers: the offered days the email lists.
export async function proposalLinksFromEnv(publicId: string, optionNumbers: number[]) {
  const settings = proposalLinkSettings({
    secret: Deno.env.get(PROPOSAL_LINK_SECRET_ENV),
    publicAppUrl: Deno.env.get(PUBLIC_APP_URL_ENV),
  });
  if (!settings || !publicId) return null;
  return proposalResponseLinks(settings.base, await createProposalToken(publicId, settings.secret), optionNumbers);
}

// One link per offered day and one for "None of these days work". Each opens the
// customer page, where the customer confirms: opening a link never records anything,
// because mail scanners open links on their own.
export function proposalResponseLinks(base: string, token: string, optionNumbers: number[]) {
  const link = (choice: string) => {
    const url = new URL(`${base}/customer-service/respond`);
    url.searchParams.set("token", token);
    url.searchParams.set("choice", choice);
    return url.toString();
  };
  return {
    options: optionNumbers.map((number) => ({ number, url: link(`option-${number}`) })),
    none: link("none"),
  };
}
