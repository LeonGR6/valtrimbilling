begin;

-- The review offers to remember a community name only for the Builder the source named
-- (corrected 26 Nov 2026). CS-3572's email names KB Home and "KB Rancho Madrina"; that
-- name must not be offered for a Brookfield Job. The read now returns the Builder the
-- import combined with the community, as the import matches it: the property Builder, or
-- the document issuer when the property names none.
drop function valtrim.read_customer_service_import_community(bigint);

create function valtrim.read_customer_service_import_property(p_request_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'communityName', nullif(btrim(receipt.analysis_payload #>> '{structuredData,property,communityName}'), ''),
    'builderName', coalesce(
      nullif(btrim(receipt.analysis_payload #>> '{structuredData,property,builderName}'), ''),
      nullif(btrim(receipt.analysis_payload #>> '{structuredData,document,issuerName}'), '')
    )
  )
  from valtrim.service_request_imports receipt
  where receipt.request_id = p_request_id
    and (select private.has_app_role('ADMIN', 'SCHEDULING'))
  order by receipt.created_at desc
  limit 1
$$;

revoke all on function valtrim.read_customer_service_import_property(bigint) from public, anon;
grant execute on function valtrim.read_customer_service_import_property(bigint) to authenticated;

commit;
