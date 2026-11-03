-- Canonical read contract for the current New Request form. Scheduling remains
-- on its existing, separate contract. This operation never changes a request.
begin;

create function valtrim.read_customer_service_request_intakes(
  p_request_id bigint default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.require_customer_service_actor();

  return query
  select jsonb_build_object(
    'request', to_jsonb(request),
    'property', to_jsonb(property),
    'builderName', coalesce(builder.name, legacy_builder.name),
    'community', coalesce(job.community, community.name),
    'jobCode', job.code,
    'coordinatorName', coordinator.name,
    'reviewerName', reviewer.name,
    'contacts', coalesce((
      select jsonb_agg(to_jsonb(contact) order by contact.role)
      from valtrim.service_request_contacts contact
      where contact.request_id = request.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.item_number)
      from valtrim.service_request_items item
      where item.request_id = request.id
    ), '[]'::jsonb),
    'source', (
      select to_jsonb(source) || jsonb_build_object('file', (
        select jsonb_build_object(
          'id', file.id,
          'bucket_id', file.bucket_id,
          'object_path', file.object_path,
          'original_filename', file.original_filename,
          'mime_type', file.mime_type,
          'size_bytes', file.size_bytes,
          'sha256', btrim(file.sha256)
        )
        from valtrim.stored_files file
        where file.id = source.file_id
      ))
      from valtrim.service_request_sources source
      where source.request_id = request.id
    ),
    'workflowHistory', coalesce((
      select jsonb_agg(to_jsonb(history) order by history.changed_at, history.id)
      from valtrim.service_request_workflow_history history
      where history.request_id = request.id
    ), '[]'::jsonb)
  )
  from valtrim.service_requests request
  join valtrim.service_properties property on property.id = request.property_id
  left join valtrim.jobs job on job.id = property.job_id
  left join valtrim.builders builder on builder.id = job.builder_id
  left join valtrim.communities community on community.id = property.community_id
  left join valtrim.builders legacy_builder on legacy_builder.id = community.builder_id
  left join valtrim.app_users coordinator on coordinator.id = request.coordinator_user_id
  left join valtrim.app_users reviewer on reviewer.id = request.reviewed_by
  where p_request_id is null or request.id = p_request_id
  order by request.created_at desc, request.id desc;
end;
$function$;

revoke all on function valtrim.read_customer_service_request_intakes(bigint)
  from public, anon, authenticated;
grant execute on function valtrim.read_customer_service_request_intakes(bigint)
  to authenticated;

comment on function valtrim.read_customer_service_request_intakes(bigint) is
  'Read-only New Request records including Job, contacts, items, immutable source and workflow history. Active ADMIN/SCHEDULING users only. A null id lists all requests; an id returns at most one.';

notify pgrst, 'reload schema';
commit;
