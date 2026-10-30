begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  'PRELIMINARY_NOTICE' = any (enum_range(null::valtrim.billing_document_type)::text[]),
  'The document type enum has PRELIMINARY_NOTICE'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.job_documents'::regclass
      and contype = 'c'
      and conname = 'job_documents_document_type_check'
      and pg_get_constraintdef(oid) like '%PRELIMINARY_NOTICE%'
  ),
  'A Job document can be a Preliminary Notice'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'job_documents_objects_insert'
      and with_check like '%preliminary_notice%'
  ),
  'Storage accepts the preliminary_notice folder'
);

select ok(
  pg_get_functiondef('private.register_job_document(bigint,valtrim.billing_document_type,text,text,bigint,boolean)'::regprocedure)
    like '%preliminary_notice%',
  'The registration function knows the preliminary_notice folder'
);

select * from finish();

rollback;
