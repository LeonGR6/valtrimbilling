begin;

-- Keep the remote Data API aligned with config.toml. RLS and explicit grants,
-- not schema exposure by itself, determine which rows each client can access.
alter role authenticator
  set pgrst.db_schemas = 'public, graphql_public, valtrim';

notify pgrst, 'reload config';

commit;
