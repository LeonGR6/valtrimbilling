-- Accept Graph's equivalent OData folder-key paths without rewriting a cursor,
-- weakening mailbox/folder identity checks, or changing any connection state.
begin;

create or replace function private.validate_customer_service_graph_cursor(
  p_mailbox_id uuid,p_folder_id text,p_kind text,p_url text
)
returns void language plpgsql immutable set search_path = '' as $function$
declare
  v_path text; v_query text; v_skip integer; v_delta integer;
  v_parts text[]; v_key text[]; v_folder text;
begin
  if p_mailbox_id is null or p_folder_id is null
    or p_kind is null or p_kind not in ('NEXT','DELTA') or p_url is null
    or char_length(p_url) > 16384 or p_url ~ '[[:space:][:cntrl:]#\\]'
    or p_url !~ '^https://graph[.]microsoft[.]com/v1[.]0/users/' then
    raise exception 'Invalid Graph cursor' using errcode = '22023';
  end if;
  v_path := split_part(p_url,'?',1);
  v_query := substr(p_url,char_length(v_path) + 2);
  v_parts := string_to_array(v_path,'/');
  if cardinality(v_parts) = 10 and v_parts[7] = 'mailFolders'
    and v_parts[9] = 'messages' and v_parts[10] = 'delta' then
    v_folder := private.customer_service_graph_path_decode(v_parts[8]);
  elsif cardinality(v_parts) = 9 and v_parts[8] = 'messages' and v_parts[9] = 'delta' then
    -- Decode the one segment once; a literal apostrophe in an OData string is
    -- doubled. Both literal and percent-encoded quote delimiters are supported.
    v_key := regexp_match(private.customer_service_graph_path_decode(v_parts[7]),
      $key$^mailFolders\('((?:[^']|'')+)'\)$$key$);
    if v_key is null then raise exception 'Invalid Graph cursor' using errcode = '22023'; end if;
    v_folder := replace(v_key[1],chr(39) || chr(39),chr(39));
  else
    raise exception 'Invalid Graph cursor' using errcode = '22023';
  end if;
  if private.customer_service_graph_path_decode(v_parts[6]) is distinct from p_mailbox_id::text
    or v_folder is distinct from p_folder_id then
    raise exception 'Graph cursor must belong to the configured mailbox and folder' using errcode = '22023';
  end if;
  if v_parts[6] in ('.','..') or v_folder in ('.','..') then
    raise exception 'Invalid Graph cursor' using errcode = '22023';
  end if;
  select count(*) into v_skip from regexp_matches(v_query,'(^|&)(\$|%24)skiptoken=','g');
  select count(*) into v_delta from regexp_matches(v_query,'(^|&)(\$|%24)deltatoken=','g');
  if (p_kind = 'NEXT' and (v_skip <> 1 or v_delta <> 0))
    or (p_kind = 'DELTA' and (v_delta <> 1 or v_skip <> 0))
    or (p_kind = 'NEXT' and v_query !~ '(^|&)(\$|%24)skiptoken=[^&]+')
    or (p_kind = 'DELTA' and v_query !~ '(^|&)(\$|%24)deltatoken=[^&]+') then
    raise exception 'Graph cursor kind and continuation token must agree' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function private.validate_customer_service_graph_cursor(uuid,text,text,text)
  from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
