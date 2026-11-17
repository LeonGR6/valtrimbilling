begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_column(
  'valtrim',
  'job_documents',
  'is_complete',
  'A Job document records whether it was saved complete'
);

select ok(
  (
    select is_nullable = 'NO' and column_default = 'false'
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'job_documents'
      and column_name = 'is_complete'
  ),
  'A document is incomplete unless it is registered as complete'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.job_documents', 'is_complete', 'select')
  and not has_column_privilege('authenticated', 'valtrim.job_documents', 'is_complete', 'update')
  and not has_column_privilege('authenticated', 'valtrim.job_documents', 'is_complete', 'insert'),
  'Signed-in users can read the flag but only the registration function sets it'
);

select ok(
  pg_get_functiondef('private.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint,boolean)'::regprocedure)
    like '%p_document_type <> ''PRELIMINARY_NOTICE'' or coalesce(p_is_complete, false)%',
  'Only a Preliminary Notice can be registered as incomplete'
);

select hasnt_function(
  'valtrim',
  'register_job_document',
  array['bigint', 'valtrim.billing_document_type', 'text', 'text', 'bigint'],
  'The registration function has no overload without the flag'
);

select ok(
  pg_get_functiondef('private.require_preliminary_notice_for_package()'::regprocedure)
    like '%document.is_complete%',
  'Creating a Package needs a completed Preliminary Notice'
);

select ok(
  has_function_privilege('authenticated', 'valtrim.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint,boolean)', 'execute'),
  'Only signed-in users can register documents'
);

select * from finish();

rollback;
