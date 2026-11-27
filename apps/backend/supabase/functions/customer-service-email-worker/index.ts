import { serviceClient } from "../_shared/supabase.ts";
import { emailWorkerFetch } from "../_shared/customerServiceEmailRuntime.ts";
import {
  createCustomerServiceEmailWorkerHandler,
  processCustomerServiceEmailImport,
} from "../_shared/customerServiceEmailWorker.ts";
import { withCustomerServiceEmailScheduledDispatch } from "../_shared/customerServiceEmailScheduledDispatch.ts";

const secret = Deno.env.get("CUSTOMER_SERVICE_EMAIL_WORKER_SECRET") ?? "";
const handler = createCustomerServiceEmailWorkerHandler({
  secret: Deno.env.get("CUSTOMER_SERVICE_EMAIL_WORKER_SECRET") ?? "",
  enabled: Deno.env.get("CUSTOMER_SERVICE_EMAIL_WORKER_ENABLED") === "true",
  hasProviderKey: Boolean(Deno.env.get("API_KEY_MISTRAL_IA")?.trim()),
  run: (importId) => {
    const now = performance.now();
    // Independent SQL/Storage allowance leaves room to retain errors after the
    // 90-second inference budget. Scheduling is a separate, explicitly enabled
    // database dispatcher; this handler still processes only one claimed import.
    const databaseFetch = emailWorkerFetch(
      now + 125_000,
      fetch,
      () => performance.now(),
      15_000,
    );
    return processCustomerServiceEmailImport(serviceClient(databaseFetch), {
      importId,
      apiKey: Deno.env.get("API_KEY_MISTRAL_IA"),
      fetcher: emailWorkerFetch(now + 90_000),
      graphCredentials: {
        tenantId: Deno.env.get("MS365_TENANT_ID") ?? "",
        clientId: Deno.env.get("MS365_CLIENT_ID") ?? "",
        clientSecret: Deno.env.get("MS365_CLIENT_SECRET") ?? "",
      },
    });
  },
});
Deno.serve(withCustomerServiceEmailScheduledDispatch({ kind: "WORKER",secret,handler,
  consume: async (args) => {
    const admin = serviceClient(emailWorkerFetch(Date.now() + 15_000,fetch,Date.now,15_000));
    const { data,error } = await admin.rpc("consume_customer_service_email_dispatch",args);
    if (error) throw new Error("DISPATCH_DATABASE_ERROR");
    return data === true;
  },
}));
