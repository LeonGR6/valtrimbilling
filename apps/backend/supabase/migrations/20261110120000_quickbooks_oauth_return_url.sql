-- Where the browser goes back to once Intuit finishes the authorization. It is
-- the page the administrator pressed "Connect" on (checked against an allowed
-- list by the Edge Function), so connecting works from localhost and from the
-- deployed site without changing a secret. Null keeps the configured QBO_RETURN_URL.

alter table valtrim.quickbooks_oauth_states
  add column return_url text
    check (return_url is null or char_length(return_url) <= 300);
