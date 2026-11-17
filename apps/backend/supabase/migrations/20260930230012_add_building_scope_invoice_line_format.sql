-- PostgreSQL enum values cannot be used safely until the transaction that
-- adds them commits. Keep this enum-only migration separate from the data and
-- constraint migration that follows it.

alter type valtrim.invoice_line_format
  add value if not exists 'BUILDING_SCOPE' after 'LOT_SCOPE';
