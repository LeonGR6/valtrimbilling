import { handlePreflight, json } from "../_shared/cors.ts";
import {
  extractEmailTextWithMistral,
  extractPdfWithMistral,
  MistralOcrError,
  validateCustomerServiceEmailText,
  validateCustomerServicePdf,
} from "../_shared/mistralOcr.ts";
import type { CustomerServicePdfExtraction } from "../_shared/customerServicePdfExtractionSchema.ts";
import { userClient } from "../_shared/supabase.ts";

const ALLOWED_ROLES = ["ADMIN", "SCHEDULING"];

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function secret: ${name}.`);
  return value;
}

function optionalText(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (normalized.length > maximum) return undefined;
  return normalized || null;
}

function withEmailMetadata(
  structuredData: CustomerServicePdfExtraction,
  from: string | null,
  subject: string | null,
): CustomerServicePdfExtraction {
  return {
    ...structuredData,
    document: {
      ...structuredData.document,
      sourceEmailFrom: from ?? structuredData.document.sourceEmailFrom,
      sourceEmailSubject: subject ?? structuredData.document.sourceEmailSubject,
    },
  };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const caller = userClient(req);
    const {
      data: { user },
      error: authError,
    } = await caller.auth.getUser();

    if (authError || !user) return json({ error: "Sign in first." }, 401);

    const { data: profile, error: profileError } = await caller
      .from("app_users")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.is_active || !ALLOWED_ROLES.includes(profile.role)) {
      return json(
        {
          error: "You do not have permission to extract Customer Service source information.",
        },
        403,
      );
    }

    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    const apiKey = requiredEnv("API_KEY_MISTRAL_IA");

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body || body.sourceType !== "EMAIL_TEXT") {
        return json({ error: "Send sourceType EMAIL_TEXT and the email text." }, 400);
      }

      const validationError = validateCustomerServiceEmailText(body.text);
      if (validationError) return json({ error: validationError }, 400);
      const from = optionalText(body.from, 320);
      const subject = optionalText(body.subject, 500);
      if (from === undefined || subject === undefined) {
        return json({ error: "The email metadata is invalid or too long." }, 400);
      }

      const result = await extractEmailTextWithMistral(body.text as string, apiKey);
      return json({
        ok: true,
        sourceType: "EMAIL_TEXT",
        fileName: "",
        fileSize: null,
        pageCount: 0,
        model: result.model,
        text: result.text,
        structuredData: withEmailMetadata(result.structuredData, from, subject),
        pages: [],
        usageInfo: result.usageInfo,
      });
    }

    if (!contentType.includes("multipart/form-data")) {
      return json({ error: "Send a PDF or pasted email text." }, 415);
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Attach a PDF in the file field." }, 400);
    }

    const validationError = await validateCustomerServicePdf(file);
    if (validationError) return json({ error: validationError }, 400);

    const result = await extractPdfWithMistral(
      file,
      apiKey,
    );

    return json({
      ok: true,
      sourceType: "PDF",
      fileName: file.name,
      fileSize: file.size,
      pageCount: result.pages.length,
      model: result.model,
      text: result.text,
      structuredData: result.structuredData,
      pages: result.pages.map((page) => ({
        page: page.index + 1,
        markdown: page.markdown,
        averageConfidence: page.averageConfidence,
        minimumConfidence: page.minimumConfidence,
      })),
      usageInfo: result.usageInfo,
    });
  } catch (error) {
    console.error("Customer Service source extraction failed.", error);
    if (error instanceof MistralOcrError) {
      return json({
        error: "Mistral could not process this source. Review it and try again.",
        providerStatus: error.providerStatus,
      }, 502);
    }
    return json({ error: (error as Error).message }, 500);
  }
});
