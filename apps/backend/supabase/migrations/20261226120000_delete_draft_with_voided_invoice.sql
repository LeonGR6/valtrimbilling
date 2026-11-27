-- A Draft Package whose QuickBooks invoice was voided can be deleted even when it
-- still holds the saved INVOICE document (the PDF of that invoice).
--
-- The correction guard refused every Package with a document that has a file or is
-- COMPLETE / WAIVED, because a generated Release or a Payment Schedule means the
-- Package was issued. The INVOICE document is different: it is the PDF downloaded
-- from QuickBooks, and it can be saved again after the invoice was voided (the PDF
-- of a $0 invoice). The Package then could not be deleted, and the screen said to
-- "remove its generated Release first" although there was no Release.
--
-- Only a CANCEL of a Package whose invoice is VOIDED skips the INVOICE document.
-- Editing and transferring cells still require the Package to be unsynced, and
-- every other document (Releases, Payment Schedule) still blocks the deletion. The
-- INVOICE document stays attached to the cancelled Package as history.
--
-- The same document rule is repeated where a Draw cell is deleted
-- (valtrim.reject_package_line_change), so both places change together.

-- Swaps one piece of a live function definition, refusing when it is not there exactly
-- once, so a definition that changed meanwhile stops the migration.
create function pg_temp.swap(
  p_definition text,
  p_old text,
  p_new text,
  p_label text
)
returns text
language plpgsql
as $$
declare
  v_found integer;
begin
  v_found := (char_length(p_definition) - char_length(replace(p_definition, p_old, '')))
    / greatest(char_length(p_old), 1);
  if v_found <> 1 then
    raise exception 'Delete draft with voided invoice: % matched % time(s), expected 1',
      p_label, v_found;
  end if;
  return replace(p_definition, p_old, p_new);
end;
$$;

do $migration$
declare
  v_definition text;
begin
  -- 1. The correction / cancel guard.
  select pg_get_functiondef(
    'private.correct_draw_invoice_package(text,bigint,bigint,jsonb,text,text)'::regprocedure
  ) into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$       select 1 from valtrim.package_documents document
       where document.package_id = p_package_id
         and (
           document.file_id is not null
           or document.status in ('COMPLETE', 'WAIVED')
         )
     ) then$source$,
    $source$       select 1 from valtrim.package_documents document
       where document.package_id = p_package_id
         and not (
           p_action = 'CANCEL'
           and v_target.quickbooks_status = 'VOIDED'
           and document.document_type = 'INVOICE'
         )
         and (
           document.file_id is not null
           or document.status in ('COMPLETE', 'WAIVED')
         )
     ) then$source$,
    'cancel guard'
  );
  execute v_definition;

  -- 2. The delete of the Package's Draw cells while it is cancelled.
  select pg_get_functiondef('valtrim.reject_package_line_change()'::regprocedure)
  into v_definition;

  v_definition := pg_temp.swap(
    v_definition,
    $source$           select 1 from valtrim.package_documents document
           where document.package_id = package.id
             and (
               document.file_id is not null
               or document.status in ('COMPLETE', 'WAIVED')
             )
         )
     ) then
    return old;
  end if;

  -- An unpaid Package waiting for payment$source$,
    $source$           select 1 from valtrim.package_documents document
           where document.package_id = package.id
             and not (
               package.quickbooks_status = 'VOIDED'
               and document.document_type = 'INVOICE'
             )
             and (
               document.file_id is not null
               or document.status in ('COMPLETE', 'WAIVED')
             )
         )
     ) then
    return old;
  end if;

  -- An unpaid Package waiting for payment$source$,
    'cell delete guard'
  );
  execute v_definition;
end;
$migration$;
