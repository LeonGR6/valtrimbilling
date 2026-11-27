-- Block B, step B5 (docs/customer-service-block-b-plan.md): the customer page.
--
-- Decided 23 Nov 2026: the invitation has an "Accept" button per offered day and a "None
-- of these days work" button; all open a Valtrim page where the customer confirms. When
-- none works, the page shows up to three other days the planner found when the proposal
-- was sent. They are not held: if the customer picks one, it is recorded as a
-- counter-proposal for the coordinator to approve. If none works either, we call the
-- customer (Needs contact).
--
-- Accepting and declining from the link already exist (20261119120000, a null actor is
-- the customer). This migration only stores the other days with each proposal. The Edge
-- Function customer-service-proposals writes them right after sending; nothing else
-- changes them.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.service_proposals
  add column alternatives jsonb not null default '[]'::jsonb,
  add constraint service_proposals_alternatives_check
    check (jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 3);

comment on column valtrim.service_proposals.alternatives is
  'Up to three other days the planner found when sending ({date, windowStart, workStart, technicianIds}); not held. The customer may pick one when no offered day works.';

notify pgrst, 'reload schema';
commit;
