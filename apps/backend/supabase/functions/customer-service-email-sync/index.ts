import { serviceClient } from "../_shared/supabase.ts";
import { createCustomerServiceEmailConnectionRepository } from "../_shared/customerServiceEmailConnection.ts";
import { createCustomerServiceMicrosoftGraph } from "../_shared/customerServiceMicrosoftGraph.ts";
import { customerServiceEmailSyncStorage } from "../_shared/customerServiceEmailSyncStorage.ts";
import {
  createCustomerServiceEmailSyncHandler,
  syncCustomerServiceEmailPage,
} from "../_shared/customerServiceEmailSync.ts";
import { emailWorkerFetch } from "../_shared/customerServiceEmailRuntime.ts";
import { recoverCustomerServiceEmailSource } from "../_shared/customerServiceEmailSourceRecovery.ts";
import { customerServiceEmailSourceRecoveryStorage } from "../_shared/customerServiceEmailSourceRecoveryStorage.ts";
import { withCustomerServiceEmailScheduledDispatch } from "../_shared/customerServiceEmailScheduledDispatch.ts";

const tenantId = Deno.env.get("MS365_TENANT_ID") ?? "";
const clientId = Deno.env.get("MS365_CLIENT_ID") ?? "";
const clientSecret = Deno.env.get("MS365_CLIENT_SECRET") ?? "";

function services() {
  const start = Date.now();
  const admin = serviceClient(
    emailWorkerFetch(start + 125_000, fetch, Date.now, 15_000),
  );
  return {
    connections: createCustomerServiceEmailConnectionRepository(admin),
    sources: customerServiceEmailSyncStorage(admin),
    recovery: customerServiceEmailSourceRecoveryStorage(admin),
    graph: createCustomerServiceMicrosoftGraph({
      tenantId,
      clientId,
      clientSecret,
      deadline: start + 95_000,
    }),
    deadline: start + 95_000,
  };
}

const secret = Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_SECRET") ?? "";
const handler = createCustomerServiceEmailSyncHandler({
  secret: Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_SECRET") ?? "",
  enabled: Deno.env.get("CUSTOMER_SERVICE_EMAIL_SYNC_ENABLED") === "true",
  credentialsConfigured: Boolean(tenantId && clientId && clientSecret),
  run: (connectionId) =>
    syncCustomerServiceEmailPage({ connectionId, ...services() }),
  recover: (connectionId, input) =>
    recoverCustomerServiceEmailSource({ connectionId, input, ...services() }),
});
Deno.serve(withCustomerServiceEmailScheduledDispatch({ kind: "SYNC",secret,handler,
  consume: async (args) => {
    const admin = serviceClient(emailWorkerFetch(Date.now() + 15_000,fetch,Date.now,15_000));
    const { data,error } = await admin.rpc("consume_customer_service_email_dispatch",args);
    if (error) throw new Error("DISPATCH_DATABASE_ERROR");
    return data === true;
  },
}));
