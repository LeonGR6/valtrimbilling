import { serviceClient } from "../_shared/supabase.ts";
import { emailWorkerFetch } from "../_shared/customerServiceEmailRuntime.ts";
import { createCustomerServiceEmailConnectionRepository } from "../_shared/customerServiceEmailConnection.ts";
import { createCustomerServiceMicrosoftGraph } from "../_shared/customerServiceMicrosoftGraph.ts";
import {
  createCustomerServiceEmailReconcileHandler,
  reconcileCustomerServiceEmailFolder,
} from "../_shared/customerServiceEmailReconcile.ts";
import { withCustomerServiceEmailScheduledDispatch } from "../_shared/customerServiceEmailScheduledDispatch.ts";

const tenantId = Deno.env.get("MS365_TENANT_ID") ?? "";
const clientId = Deno.env.get("MS365_CLIENT_ID") ?? "";
const clientSecret = Deno.env.get("MS365_CLIENT_SECRET") ?? "";

const secret = Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_SECRET") ?? "";
const handler = createCustomerServiceEmailReconcileHandler({
  secret: Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_SECRET") ?? "",
  enabled: Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_ENABLED") === "true",
  credentialsConfigured: Boolean(tenantId && clientId && clientSecret),
  run: (connectionId) => {
    const start = Date.now();
    const admin = serviceClient(
      emailWorkerFetch(start + 125_000, fetch, Date.now, 15_000),
    );
    return reconcileCustomerServiceEmailFolder({
      connectionId,
      admin,
      connections: createCustomerServiceEmailConnectionRepository(admin),
      graph: createCustomerServiceMicrosoftGraph({
        tenantId,
        clientId,
        clientSecret,
        deadline: start + 95_000,
      }),
    });
  },
});
Deno.serve(
  withCustomerServiceEmailScheduledDispatch({
    kind: "RECONCILE",
    secret,
    handler,
    consume: async (args) => {
      const admin = serviceClient(
        emailWorkerFetch(Date.now() + 15_000, fetch, Date.now, 15_000),
      );
      const { data, error } = await admin.rpc(
        "consume_customer_service_email_dispatch",
        args,
      );
      if (error) throw new Error("DISPATCH_DATABASE_ERROR");
      return data === true;
    },
  }),
);
