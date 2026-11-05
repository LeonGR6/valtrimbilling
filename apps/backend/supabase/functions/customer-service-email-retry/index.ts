import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { createCustomerServiceEmailRetryHandler } from "../_shared/customerServiceEmailRetry.ts";
import { processCustomerServiceEmailImport } from "../_shared/customerServiceEmailWorker.ts";
import { emailWorkerFetch } from "../_shared/customerServiceEmailRuntime.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

const handler = createCustomerServiceEmailRetryHandler({
  enabled: Deno.env.get("CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED") === "true",
  hasProviderKey: Boolean(Deno.env.get("API_KEY_MISTRAL_IA")?.trim()),
  authorize: async (req) => {
    const caller = userClient(req);
    const { data: { user }, error } = await caller.auth.getUser();
    if (error || !user) {
      return Response.json({ error: "Sign in first." }, { status: 401 });
    }
    const { data: profile, error: profileError } = await caller.from(
      "app_users",
    )
      .select("role,is_active").eq("id", user.id).maybeSingle();
    if (
      profileError || !profile?.is_active ||
      !["ADMIN", "SCHEDULING"].includes(profile.role)
    ) {
      return Response.json({
        error: "You do not have permission to retry imports.",
      }, { status: 403 });
    }
    return {
      hold: async (importId) => {
        const { data, error } = await caller.rpc(
          "hold_customer_service_email_retry",
          { p_import_id: importId },
        );
        if (error) throw error;
        if (!data?.status || data.importId !== importId) {
          throw new Error("Retry continuation was not confirmed.");
        }
        return data;
      },
      queue: async (importId, expectedUpdatedAt) => {
        const { data, error } = await caller.rpc(
          "retry_customer_service_email_import",
          {
            p_import_id: importId,
            p_expected_updated_at: expectedUpdatedAt,
          },
        );
        if (error) throw error;
        if (!data?.status || data.importId !== importId) {
          throw new Error("Retry was not confirmed.");
        }
        return data;
      },
    };
  },
  run: (importId) => {
    const now = performance.now();
    return processCustomerServiceEmailImport(
      serviceClient(
        emailWorkerFetch(now + 125_000, fetch, () => performance.now(), 15_000),
      ),
      {
        importId,
        apiKey: Deno.env.get("API_KEY_MISTRAL_IA"),
        fetcher: emailWorkerFetch(now + 90_000),
        graphCredentials: {
          tenantId: Deno.env.get("MS365_TENANT_ID") ?? "",
          clientId: Deno.env.get("MS365_CLIENT_ID") ?? "",
          clientSecret: Deno.env.get("MS365_CLIENT_SECRET") ?? "",
        },
      },
    );
  },
});

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  const result = await handler(req);
  return new Response(result.body, {
    status: result.status,
    headers: { ...Object.fromEntries(result.headers), ...corsHeaders },
  });
});
