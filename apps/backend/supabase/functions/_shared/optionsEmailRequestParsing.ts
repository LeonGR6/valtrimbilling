// Checks the shape of what the browser sends to the "options changed in the Sequence
// Sheet" email functions. Pure (no environment, no network), so it is tested apart from
// the request handler in optionsEmailRequest.ts.

import type { RequestedChange } from "./purchaseOrderOptionsEmailLoader.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_CHANGES = 200;
const MAX_RECIPIENTS = 10;

export function requiredPositiveId(value: unknown, label: string) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`Select a valid ${label}.`);
  }
  return normalized;
}

/** The (Lot, option) pairs the browser names, checked in shape only. */
export function requestedChanges(value: unknown): RequestedChange[] {
  if (
    !Array.isArray(value) || value.length === 0 || value.length > MAX_CHANGES
  ) {
    throw new Error(`Choose between 1 and ${MAX_CHANGES} options.`);
  }

  const seen = new Set<string>();
  const changes: RequestedChange[] = [];
  for (const item of value) {
    const lotId = requiredPositiveId(item?.lotId, "Lot");
    const optionId = requiredPositiveId(item?.optionId, "option");
    const key = `${lotId}:${optionId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const price = item?.price === undefined || item.price === null
      ? undefined
      : Number(item.price);
    if (price !== undefined && !Number.isFinite(price)) {
      throw new Error("Enter a valid option price.");
    }
    changes.push({
      lotId,
      optionId,
      createdOption: item?.createdOption === true,
      price,
      priceNotApplicable: item?.priceNotApplicable === true,
    });
  }
  return changes;
}

export function recipientEmails(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Enter at least one recipient email address.");
  }

  const recipients = [
    ...new Set(value.map((email) => String(email).trim().toLowerCase())),
  ];
  if (
    recipients.length === 0 ||
    recipients.some((email) => !EMAIL_PATTERN.test(email))
  ) {
    throw new Error("Enter valid recipient email addresses.");
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new Error(`The email can have up to ${MAX_RECIPIENTS} recipients.`);
  }
  return recipients;
}

// The user may rewrite the subject in the dialog; only the shape is checked.
export function subjectOverride(value: unknown, fallback: string) {
  if (value == null || String(value).trim() === "") return fallback;
  const subject = String(value).trim();
  if (/[\r\n]/u.test(subject)) {
    throw new Error("The subject must be a single line.");
  }
  if (subject.length > 200) {
    throw new Error("Use 200 characters or fewer in the subject.");
  }
  return subject;
}
