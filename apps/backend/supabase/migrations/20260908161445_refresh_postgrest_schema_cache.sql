-- The exposed-schema configuration and the schema structure have independent
-- PostgREST reload signals. Refresh the schema cache after exposing `valtrim`
-- so newly created tables are immediately addressable through the Data API.
notify pgrst, 'reload schema';
