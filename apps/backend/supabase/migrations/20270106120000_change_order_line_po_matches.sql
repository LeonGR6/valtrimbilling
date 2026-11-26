-- Which builder Purchase Order backs each line (each Lot) of an Extra / Change Order.
--
-- The orders read from the PO PDFs of a Job (change_order_pos / change_order_po_lines) are compared with the
-- lines of the Extras / COs of the same Job, Lot by Lot. Nothing is stored: the view is worked out when read,
-- so it follows every new reading and every change to an Extra / CO.
--
-- A PO line backs a CO line when it lists the CO line's Lot ("0017", "Lot 17" and "17" are the same Lot).
-- A CO line with no Lot (a Sales Office) is backed only by a PO line with no Lot whose number is the
-- Extra / CO's PO / CO #. How sure it is:
--   NUMBER  the PO number is the PO / CO # of the Extra / CO (or of the line);
--   AMOUNT  the amount of the Lot is the same, gross or net of OCIP;
--   LOT     only the Lot is the same: it needs a look.
-- One PO can back several Extras / COs, and one line can have several POs; is_best marks, for each line, the
-- surest of them.

create or replace view valtrim.change_order_line_po_matches
with (security_invoker = true)
as
with po_lots as (
  select
    po.id as po_id,
    po.file_id,
    po.job_id,
    po.po_number,
    po.document_kind,
    po.issued_date,
    po.total_amount,
    po.net_amount,
    po_line.line_number as po_line_number,
    po_line.lots_checked,
    po_line.description as po_line_description,
    -- The amount of one Lot: a line that prints one amount for several Lots shares it among them; an order
    -- with a single line and no line amount gives its total.
    round(
      coalesce(
        po_line.amount,
        case when (select count(*) from valtrim.change_order_po_lines other where other.po_id = po.id) = 1
          then po.total_amount end
      ) / greatest(cardinality(po_line.lots), 1),
      2
    ) as lot_amount,
    lot.value as lot_text,
    regexp_replace(regexp_replace(lower(coalesce(lot.value, '')), '(lot|#|\s)', '', 'g'), '^0+([0-9])', '\1')
      as lot_key
  from valtrim.change_order_pos po
  join valtrim.change_order_po_lines po_line on po_line.po_id = po.id
  left join lateral unnest(nullif(po_line.lots, '{}')) as lot(value) on true
),
candidates as (
  select
    line.change_order_id,
    line.id as line_id,
    line.lot_id,
    line.lot_number,
    line.amount as line_amount,
    change_order.change_order_number,
    change_order.status as change_order_status,
    po_lot.po_id,
    po_lot.po_line_number,
    po_lot.file_id,
    po_lot.po_number,
    po_lot.document_kind,
    po_lot.issued_date,
    po_lot.lot_text,
    po_lot.lots_checked,
    po_lot.po_line_description,
    po_lot.lot_amount,
    case
      when po_lot.net_amount is not null and po_lot.total_amount > 0 and po_lot.lot_amount is not null
        then round(po_lot.lot_amount * po_lot.net_amount / po_lot.total_amount, 2)
    end as lot_net_amount,
    po_lot.po_number is not null
      and upper(regexp_replace(po_lot.po_number, '[^A-Za-z0-9]', '', 'g')) in (
        upper(regexp_replace(coalesce(change_order.po_co_number, ''), '[^A-Za-z0-9]', '', 'g')),
        upper(regexp_replace(coalesce(line.po_number, ''), '[^A-Za-z0-9]', '', 'g'))
      ) as number_matches
  from valtrim.change_order_lines line
  join valtrim.change_orders change_order on change_order.id = line.change_order_id
  join po_lots po_lot
    on po_lot.job_id = change_order.job_id
   and (
     (nullif(btrim(line.lot_number), '') is not null
       and po_lot.lot_key = regexp_replace(
         regexp_replace(lower(line.lot_number), '(lot|#|\s)', '', 'g'), '^0+([0-9])', '\1'))
     or (nullif(btrim(line.lot_number), '') is null and po_lot.lot_text is null)
   )
),
scored as (
  select
    candidate.*,
    case
      when candidate.lot_amount is not null and abs(candidate.line_amount - candidate.lot_amount) <= 0.01 then 'GROSS'
      when candidate.lot_net_amount is not null and abs(candidate.line_amount - candidate.lot_net_amount) <= 0.02 then 'NET'
    end as amount_matches
  from candidates candidate
  -- A line with no Lot is only taken from a PO that carries the Extra / CO's number.
  where candidate.lot_number is not null and btrim(candidate.lot_number) <> '' or candidate.number_matches
)
select
  scored.change_order_id,
  scored.line_id,
  scored.lot_id,
  scored.lot_number,
  scored.line_amount,
  scored.change_order_number,
  scored.change_order_status,
  scored.po_id,
  scored.po_line_number,
  scored.file_id,
  file.original_name as file_name,
  file.storage_bucket,
  file.storage_path,
  scored.po_number,
  scored.document_kind,
  scored.issued_date,
  scored.lot_text,
  scored.lots_checked,
  scored.po_line_description,
  scored.lot_amount,
  scored.lot_net_amount,
  scored.number_matches,
  scored.amount_matches,
  case
    when scored.number_matches then 'NUMBER'
    when scored.amount_matches is not null then 'AMOUNT'
    else 'LOT'
  end as match_level,
  rank() over (
    partition by scored.line_id
    order by
      (case when scored.number_matches then 4 else 0 end)
      + (case when scored.amount_matches is not null then 2 else 0 end) desc
  ) = 1 as is_best
from scored
join valtrim.change_order_po_files file on file.id = scored.file_id;

revoke all on valtrim.change_order_line_po_matches from public, anon, authenticated;
grant select on valtrim.change_order_line_po_matches to authenticated, service_role;
