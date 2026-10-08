begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(
  private.release_template_variables() = array[
    'through_date',
    'check_amount',
    'signature_date',
    'waiver_release_dates',
    'unpaid_progress_amount'
  ]::text[],
  'The catalog has the five Release variables in a stable order'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"waiver_release_dates","target":{"kind":"rect","page":1,"x":0.4,"y":0.72,"w":0.35,"h":0.018},"fontSize":9,"format":"MM/DD/YYYY"},
        {"variable":"unpaid_progress_amount","target":{"kind":"rect","page":1,"x":0.5,"y":0.74,"w":0.26,"h":0.018},"fontSize":9,"format":"currency"}
      ]}'::jsonb,
      1
    )
  $$,
  'Both exception blanks are accepted with their own formats'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"waiver_release_dates","target":{"kind":"acroform","fieldName":"affect"},"fontSize":9,"format":"MMMM D, YYYY"},
        {"variable":"unpaid_progress_amount","target":{"kind":"acroform","fieldName":"amount_2"},"fontSize":9,"format":"plain"}
      ]}'::jsonb,
      1
    )
  $$,
  'The exception blanks can map to form fields'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"waiver_release_dates","target":{"kind":"rect","page":1,"x":0.4,"y":0.72,"w":0.35,"h":0.018},"fontSize":9,"format":"currency"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for waiver_release_dates',
  'The waiver dates cannot use an amount format'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"unpaid_progress_amount","target":{"kind":"rect","page":1,"x":0.5,"y":0.74,"w":0.26,"h":0.018},"fontSize":9,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for unpaid_progress_amount',
  'The unpaid progress amount cannot use a date format'
);

select lives_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"through_date","target":{"kind":"rect","page":1,"x":0.2,"y":0.3,"w":0.3,"h":0.02},"fontSize":10,"format":"YYYY-MM-DD"},
        {"variable":"check_amount","target":{"kind":"rect","page":1,"x":0.3,"y":0.5,"w":0.3,"h":0.02},"fontSize":10,"format":"plain"},
        {"variable":"signature_date","target":{"kind":"rect","page":1,"x":0.25,"y":0.8,"w":0.3,"h":0.02},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  'The earlier variables keep working'
);

select throws_ok(
  $$
    select private.validate_release_template_mapping(
      '{"version":1,"fields":[
        {"variable":"check_amount","target":{"kind":"rect","page":1,"x":0.3,"y":0.5,"w":0.3,"h":0.02},"fontSize":10,"format":"MM/DD/YYYY"}
      ]}'::jsonb,
      1
    )
  $$,
  '23514',
  'Select a supported format for check_amount',
  'The check amount still rejects date formats'
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
