-- Sanitized operator read. Never print Vault values, delta URLs or mail bodies.
select jsonb_build_object(
  'configured',a.connection_id is not null,'enabled',coalesce(a.enabled,false),
  'cronActive',(select active from cron.job where jobname = 'customer-service-email-minute'),
  'lastTickAt',a.last_tick_at,'lastSyncAt',c.last_success_at,
  'schedulerError',a.error_code,'connectionError',c.last_error_code,
  'scan',(select jsonb_build_object('completedAt',completed_at,'inProgress',scan_id is not null,'errorCode',error_code)
    from private.customer_service_email_folder_scan where connection_id = a.connection_id),
  'missingMessages',(select coalesce(jsonb_agg(jsonb_build_object('webLink',web_link,'firstSeenAt',first_seen_at)),'[]'::jsonb)
    from (select v.web_link,v.created_at first_seen_at from private.customer_service_email_inbox_items v
      where v.source_kind = 'FOLDER_MESSAGE' and v.state = 'REQUIRES_ACTION'
      order by v.created_at,v.id limit 20) missing),
  'inboxCounts',(select jsonb_build_object('processing',count(*) filter(where state = 'PROCESSING'),
    'requiresAction',count(*) filter(where state = 'REQUIRES_ACTION'),
    'registered',count(*) filter(where state = 'REGISTERED')) from private.customer_service_email_inbox_items),
  'dispatches',(select jsonb_agg(jsonb_build_object('kind',kind,'inFlight',request_id is not null,
    'startedAt',started_at,'finishedAt',finished_at,'lastSuccessAt',last_success_at,
    'outcome',outcome,'httpStatus',http_status,'errorCode',error_code,'retryNotBefore',retry_not_before))
    from private.customer_service_email_dispatch)
) as automation
from (select 1) anchor
left join private.customer_service_email_automation a on a.singleton
left join private.customer_service_email_connections c on c.id = a.connection_id;
