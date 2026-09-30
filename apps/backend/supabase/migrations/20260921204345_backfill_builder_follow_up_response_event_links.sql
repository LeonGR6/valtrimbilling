-- Link secure responses recorded before the automatic-response phase so they
-- appear in the authenticated recent-response history. Exact timestamp,
-- schedule, date and action equality make the association deterministic.

begin;

update valtrim.builder_follow_up_events event
set response_token_id = token.id
from valtrim.builder_follow_up_response_tokens token
where event.response_token_id is null
  and token.responded_at is not null
  and token.response_action is not null
  and event.schedule_id = token.schedule_id
  and event.target_work_date = token.target_work_date
  and event.action = token.response_action
  and event.created_at = token.responded_at;

commit;
