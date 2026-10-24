-- PostgreSQL enum values cannot be used safely until the transaction that
-- adds them commits. This migration only extends the enum; the next one lets
-- Job documents use the new value.

alter type valtrim.billing_document_type add value if not exists 'PRELIMINARY_NOTICE';
