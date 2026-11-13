# Codex preferences

## Supabase MCP - Uso de logs
- No consultar logs automáticamente durante tareas normales de desarrollo.
- Utilizar `query_logs` o `get_logs` únicamente cuando sea necesario investigar un problema específico.
- Limitar las consultas de logs al proyecto, servicio y periodo de tiempo más pequeños posibles.
- Evitar consultas repetitivas, búsquedas generales y polling de logs.
- Priorizar inspección de código, consultas SQL y errores proporcionados por el usuario antes de revisar logs.
