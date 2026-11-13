begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select lives_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[
        {"phase":"003","lot":"0014","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ],"summaryRows":{
        "previouslyInvoiced":[{"draw":1,"page":1,"rect":{"x":0.3,"y":0.5,"w":0.05,"h":0.01}}],
        "thisRequest":[{"draw":1,"page":1,"rect":{"x":0.3,"y":0.52,"w":0.05,"h":0.01}}]
      }}'::jsonb,
      1
    )
  $$,
  'A matrix mapping with summary rows is accepted'
);

select lives_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[
        {"phase":null,"lot":"1","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ]}'::jsonb,
      1
    )
  $$,
  'A mapping without summary rows, as saved before this phase, is still accepted'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"line_items","cells":[
        {"phase":null,"lot":"1","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ],"summaryRows":{"thisRequest":[{"draw":1,"page":1,"rect":{"x":0.3,"y":0.5,"w":0.05,"h":0.01}}]}}'::jsonb,
      1
    )
  $$,
  '23514',
  'The summary rows only apply to the matrix layout',
  'A list layout has no summary rows'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[
        {"phase":null,"lot":"1","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ],"summaryRows":{"thisRequest":[
        {"draw":1,"page":1,"rect":{"x":0.3,"y":0.5,"w":0.05,"h":0.01}},
        {"draw":1,"page":1,"rect":{"x":0.4,"y":0.5,"w":0.05,"h":0.01}}
      ]}}'::jsonb,
      1
    )
  $$,
  '23514',
  'Each summary box needs a draw number from 1 to 5, used once',
  'Each draw can have one summary box'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[
        {"phase":null,"lot":"1","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ],"summaryRows":{"thisRequest":[{"draw":1,"page":2,"rect":{"x":0.3,"y":0.5,"w":0.05,"h":0.01}}]}}'::jsonb,
      1
    )
  $$,
  '23514',
  'The summary box page is outside the document',
  'A summary box must be on a page of the document'
);

select throws_ok(
  $$
    select private.validate_payment_schedule_mapping(
      '{"version":1,"layout":"matrix","cells":[
        {"phase":null,"lot":"1","draw":1,"amount":100,"page":1,"rect":{"x":0.1,"y":0.2,"w":0.05,"h":0.01}}
      ],"summaryRows":{"thisRequest":[{"draw":1,"page":1,"rect":{"x":0.99,"y":0.5,"w":0.05,"h":0.01}}]}}'::jsonb,
      1
    )
  $$,
  '23514',
  'The summary box rectangle must stay inside the page',
  'A summary box must stay inside the page'
);

select * from finish();

rollback;
