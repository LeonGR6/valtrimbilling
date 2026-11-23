// The confirmation email of path a, "Customer accepted by phone" (block B, step B4):
// after the appointment is registered, the customer gets the visit details from the
// coordinator's own mailbox. These helpers decide what is sent and to whom; the Edge
// Function does the sending and records it in service_communications.
import { AppointmentInputError } from "./customerServiceAppointments.ts";
import {
  confirmationEmail,
  confirmationTextProblems,
  mailingAddress,
} from "./customerServiceEmailTemplates.mjs";
import { MicrosoftGraphSendError, MicrosoftGraphSyncError } from "./customerServiceMicrosoftGraph.ts";

export type ConfirmationInput = { greeting: string; message: string };

// Absent means "register without an email"; anything else must be a valid text.
export function parseConfirmationInput(value: unknown): ConfirmationInput | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppointmentInputError("The confirmation email has an invalid value.");
  }
  const { greeting, message } = value as Record<string, unknown>;
  const problems = confirmationTextProblems({ greeting, message });
  if (problems.length) throw new AppointmentInputError(problems.join(" "));
  return { greeting: String(greeting), message: String(message) };
}

// Who receives customer emails. While testing (decided 20 Nov 2026) every customer
// email goes to CUSTOMER_SERVICE_TEST_RECIPIENT instead; real customers are written
// to only with CUSTOMER_SERVICE_CUSTOMER_EMAILS=LIVE and no test recipient, which
// needs the user's OK. Without either, nothing is sent.
export type CustomerEmailDelivery =
  | { mode: "TEST"; recipient: string }
  | { mode: "LIVE" }
  | { mode: "OFF" };

export function customerEmailDelivery(
  env: { testRecipient?: string; customerEmails?: string },
): CustomerEmailDelivery {
  const testRecipient = env.testRecipient?.trim();
  if (testRecipient) return { mode: "TEST", recipient: testRecipient };
  return env.customerEmails?.trim() === "LIVE" ? { mode: "LIVE" } : { mode: "OFF" };
}

export type ConfirmationRequest = {
  folio: string;
  homeowner_name: string | null;
  homeowner_email: string | null;
  description: string | null;
  service_properties: {
    address: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
  } | null;
};

export type PreparedConfirmation =
  | { send: true; to: string; customerEmail: string; testMode: boolean; subject: string; text: string; html: string }
  | { send: false; message: string };

export function prepareConfirmation({ input, request, date, windowStart, senderName, senderEmail = "", delivery }: {
  input: ConfirmationInput;
  request: ConfirmationRequest;
  date: string;
  windowStart: string;
  senderName: string;
  senderEmail?: string;
  delivery: CustomerEmailDelivery;
}): PreparedConfirmation {
  const customerEmail = request.homeowner_email?.trim() ?? "";
  if (!customerEmail) {
    return { send: false, message: "This request has no customer email, so no confirmation was sent." };
  }
  if (delivery.mode === "OFF") {
    return { send: false, message: "Customer emails are turned off on the server, so no confirmation was sent." };
  }
  const property = request.service_properties;
  const email = confirmationEmail({
    folio: request.folio,
    homeownerName: request.homeowner_name,
    date,
    windowStart,
    address: mailingAddress({
      street: property?.address,
      city: property?.city,
      state: property?.state,
      postalCode: property?.postal_code,
    }),
    work: request.description,
    greeting: input.greeting,
    message: input.message,
    senderName,
    senderEmail,
  });
  const testMode = delivery.mode === "TEST";
  return {
    send: true,
    to: testMode ? delivery.recipient : customerEmail,
    customerEmail,
    testMode,
    subject: testMode ? `[TEST for ${customerEmail}] ${email.subject}` : email.subject,
    text: email.text,
    html: email.html,
  };
}

// True when Microsoft answered that it did not take the email. A timeout or an outage
// leaves it unknown: the email may still have been sent.
export function sendFailureIsCertain(error: unknown): boolean {
  if (error instanceof MicrosoftGraphSendError) return error.code !== "UNAVAILABLE";
  // Sign-in refusals happen before anything is posted; a network error may come from either step.
  return error instanceof MicrosoftGraphSyncError && ["AUTH_FAILED", "GRAPH_THROTTLED"].includes(error.code);
}

// What the coordinator reads when Microsoft did not take the email. The appointment
// is already registered at that point.
export function confirmationFailureMessage(error: unknown, mailbox: string): string {
  const code = error instanceof MicrosoftGraphSendError || error instanceof MicrosoftGraphSyncError
    ? error.code
    : "";
  if (code === "FORBIDDEN") {
    return `${mailbox} is not allowed to send Customer Service emails. Add it to the senders in Exchange Online.`;
  }
  if (code === "MAILBOX_NOT_FOUND") {
    return `Microsoft 365 has no mailbox for ${mailbox}. Sign in with your Valtrim email to send customer emails.`;
  }
  if (code === "REJECTED") {
    return "Microsoft 365 rejected the email. Check the customer's email address.";
  }
  if (code === "AUTH_FAILED") {
    return "The app could not sign in to Microsoft 365, so the email was not sent.";
  }
  if (code === "THROTTLED" || code === "GRAPH_THROTTLED") {
    return "Microsoft 365 is busy and did not take the email. Try again in a few minutes.";
  }
  return "Microsoft 365 did not take the email right now, so it may not have been sent. Confirm the visit with the customer.";
}
