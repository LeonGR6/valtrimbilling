-- Separate unmatched email messages from real import issues. No data cleanup,
-- automatic matching, request mutation, Graph invocation or new workflow state.
begin;
create or replace function valtrim.count_customer_service_email_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  perform private.require_customer_service_actor();
  return (select jsonb_build_object('processing',count(*) filter(where state = 'PROCESSING'),
    'requiresAction',count(*) filter(where state = 'REQUIRES_ACTION'),
    'unmatched',count(*) filter(where state = 'REQUIRES_ACTION' and source_kind = 'FOLDER_MESSAGE'),
    'importIssues',count(*) filter(where state = 'REQUIRES_ACTION' and source_kind = 'IMPORT'),
    'registered',count(*) filter(where state = 'REGISTERED'),'total',count(*),
    'revision',count(*)::text || ':' || coalesce(max(updated_at)::text,''))
    from private.customer_service_email_inbox_items);
end;
$function$;
comment on function valtrim.count_customer_service_email_inbox() is
  'Counts email messages, not requests. Unmatched originals/forwards and import issues are separate; only a verified request link resolves a message.';
commit;
