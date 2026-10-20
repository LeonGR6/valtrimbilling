-- Phase 55: Payment Schedule templates come from PAYMENT_SCHEDULE documents only.
--
-- Phase 54 also accepted PURCHASE_ORDER documents. A Payment Schedule that a
-- builder sends as a list (laid out like a purchase order) is uploaded as a
-- Payment Schedule, and real Purchase Orders are not schedules, so the rule is
-- tightened to the one document type. No template exists for any other type.

begin;

create or replace function private.sync_payment_schedule_template_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document valtrim.job_documents%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.job_document_id is distinct from old.job_document_id then
    raise exception 'A Payment Schedule template cannot move to another document'
      using errcode = '23514';
  end if;

  select document.*
    into v_document
  from valtrim.job_documents document
  where document.id = new.job_document_id;

  if not found or v_document.document_type <> 'PAYMENT_SCHEDULE' then
    raise exception
      'Payment Schedule templates require a PAYMENT_SCHEDULE Job document'
      using errcode = '23514';
  end if;

  new.job_id := v_document.job_id;
  return new;
end;
$$;

comment on table valtrim.payment_schedule_templates is
  'Analysis and confirmed cells (Lot, draw, amount, position) of a PAYMENT_SCHEDULE Job document. Never stores the extracted text.';

commit;
