-- Customer Service Reschedule block, part R5 (27 Nov 2026; plan in
-- docs/customer-service-reschedule-plan.md). The screens cancel a confirmed visit through the
-- Edge Function customer-service-appointments, which calls cancel_customer_service_visit
-- (part R1) and can email the customer. The browser RPC cancel_customer_service_appointment
-- (block A, 5 Nov 2026; test mode only since 23 Nov) has no caller left and goes.
-- test_mode now only allows cancelling a sent proposal.
begin;

drop function valtrim.cancel_customer_service_appointment(bigint, timestamptz, text);

comment on column valtrim.service_scheduling_settings.test_mode is
  'While true, coordinators may cancel a sent proposal (Cancel proposal) to clean up tests. A confirmed visit is cancelled live since the Reschedule block (27 Nov 2026). Turn it off when customer emails go live: apps/backend/CUSTOMER_SERVICE_LIVE.md.';

notify pgrst, 'reload schema';

commit;
