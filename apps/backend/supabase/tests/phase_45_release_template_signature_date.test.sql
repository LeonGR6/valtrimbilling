begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  'signature_date' = any (private.release_template_variables())
  and 'through_date' = any (private.release_template_variables())
  and 'check_amount' = any (private.release_template_variables()),
  'The catalog keeps Through Date and Amount of Check and adds Date of Signature'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"signature_date","target":{"kind":"rect","page":1,"x":0.25,"y":0.78,"w":0.3,"h":0.02},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  'A signature date mapping is accepted'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"signature_date","target":{"kind":"acroform","fieldName":"date"},"fontSize":10,"format":"MMMM D, YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  'A signature date can map to a form field with a long date format'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"signature_date","target":{"kind":"rect","page":1,"x":0.25,"y":0.78,"w":0.3,"h":0.02},"fontSize":10,"format":"currency"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for signature_date',
  'A signature date cannot use an amount format'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"plain"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for through_date',
  'The existing variables keep their own formats'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"invoice_number","target":{"kind":"rect","page":1,"x":0.1,"y":0.2,"w":0.2,"h":0.03},"fontSize":10,"format":"plain"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported Release variable',
  'Variables outside the catalog are still rejected'
);

select * from finish();

rollback;
