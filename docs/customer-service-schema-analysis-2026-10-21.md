Análisis de persistencia de requests — 21 de octubre de 2026

La recomendación es revisar el modelo ahora y simplificarlo por etapas. Los
hallazgos siguientes no aprueban eliminaciones ni cambian reglas funcionales.
Se leyeron las reglas vigentes, las migraciones, los repositorios del frontend
y metadatos/conteos del proyecto Supabase vinculado. No se modificaron datos,
funciones, permisos ni migraciones. Solo se añadieron este informe y una consulta
SELECT reutilizable en `tmp/customer-service-schema-audit-readonly.sql`.

`supabase migration list` mostró 62 versiones con coincidencia local/remota.
`supabase db push --dry-run` confirmó que no hay migraciones pendientes. Esto
comprueba las versiones registradas; no demuestra que nadie haya modificado
manualmente el esquema ni que el contenido de cada archivo coincida byte por byte
con lo que se ejecutó. Dieciséis archivos de migración aparecen sin seguimiento
en Git, aunque sus versiones ya están aplicadas remotamente.

La tabla real es `valtrim.service_requests`: tiene 43 columnas y actualmente
contiene dos requests. Ambas tienen `workflow_stage = READY_TO_PROPOSE` y
`status = NEW`. Hay ocho triggers propios en esa tabla. Una columna vacía en
dos registros no constituye evidencia suficiente para eliminarla. Los conteos
son una fotografía de esta revisión, no una regla de negocio ni un historial
de uso de producción.

El frontend activo usa `CustomerServicePrototypeProvider`, que carga las requests
persistidas por los RPC de intake; los borradores y la planificación permanecen
en memoria. El repositorio anterior todavía contiene contratos para programación,
disponibilidad y cierre. La presencia de código antiguo no certifica que todos
sus flujos sean accesibles desde la navegación actual, pero sí identifica
dependencias que hay que resolver antes de retirar columnas.

**Inventario de las columnas de `service_requests`.** “Con datos” cuenta valores
distintos de SQL NULL; un booleano `false` o un arreglo vacío también cuenta.
“Revisar retiro” significa candidato sujeto a comprobar y migrar dependencias,
no autorización para borrarlo.

| Columna | Con datos / 2 | Uso comprobado y recomendación |
| --- | ---: | --- |
| `id` | 2 | Identidad y relaciones; conservar. |
| `folio` | 2 | Folio persistido; el default remoto ya usa `CS-`; conservar. |
| `property_id` | 2 | Vínculo con ubicación y Job; conservar. |
| `reported_on` | 2 | Fecha fuente y cálculo del plazo; conservar. |
| `created_by` | 2 | Autor y auditoría; conservar. |
| `coordinator_user_id` | 2 | Coordinación y nombre recuperado por el RPC; conservar. No equivale conceptualmente al autor aunque inicialmente sea la misma persona. |
| `homeowner_name` | 2 | Copia del contacto principal; los RPC nuevos todavía la escriben y el adaptador tiene fallback. Revisar retiro después de migrar consumidores. |
| `homeowner_email` | 2 | Copia del contacto principal; misma dependencia de compatibilidad. |
| `homeowner_phone` | 2 | Copia del contacto principal; misma dependencia de compatibilidad. |
| `request_type` | 2 | Enum anterior: WARRANTY/PUNCH_LIST/SERVICE_CALL/COMPLAINT. El alta nueva escribe SERVICE_CALL fijo. No es `service_kind`; revisar necesidad y retiro del contrato anterior. |
| `priority` | 2 | Prioridad vigente; conservar. |
| `status` | 2 | Estado anterior, todavía leído por bloqueos, vistas, funciones y triggers. Revisar consolidación con `workflow_stage`; no eliminar directamente. |
| `tag` | 2 | Clasificación derivada del estado anterior por `normalize_service_request`; revisar retiro con ese contrato. |
| `status_note` | 0 | Nota del estado anterior, consumida por historial y funciones de cierre/reapertura; revisar con esos flujos. |
| `description` | 2 | Resumen de ítems concatenados y limitado a 2000 caracteres; los RPC nuevos lo mantienen. `service_request_items` conserva el detalle. Revisar si se convierte en dato derivado después de migrar consumidores. |
| `internal_notes` | 0 | Campo vigente y editable; conservar aunque las requests actuales no tengan notas. |
| `status_before_close` | 0 | Reapertura anterior; las reglas definitivas de cancelación/cierre siguen abiertas. Revisar después de acordarlas. |
| `closed_at` | 0 | Cierre anterior y constraints asociados; misma revisión. |
| `closed_by` | 0 | Actor del cierre anterior; misma revisión. |
| `close_reason` | 0 | Motivo del cierre anterior; misma revisión. |
| `updated_by` | 2 | Actor de edición y auditoría; conservar. |
| `created_at` | 2 | Fecha de creación real; conservar. |
| `updated_at` | 2 | Versión exacta para rechazar ediciones/aprobaciones obsoletas; conservar precisión, incluidos microsegundos. |
| `work_type` | 0 | Enum anterior HW/WS/HW_WS. El formulario actual usa `work_category`; vistas, triggers y funciones antiguas todavía lo referencian. Candidato a retiro coordinado. |
| `estimated_duration_minutes` | 2 | Estimación revisada para planificar; conservar. |
| `customer_availability_notes` | 0 | Existe lectura en el adaptador nuevo; la disponibilidad se obtiene tras responder a la propuesta. Conservar provisionalmente y definir su persistencia al integrar respuestas. |
| `due_on` | 2 | Plazo calculado por trigger desde Reported on y ajustes; conservar. Ser derivado no lo hace innecesario para listados/índices. |
| `resolution_status` | 0 | Modelo anterior de resolución RESOLVED/EXCEPTION; vistas, auditoría y constraint lo referencian. Revisar alineación con cierre/completion vigente. |
| `completed_at` | 0 | Marca de finalización del modelo anterior. El flujo nuevo aún no persiste su programación; definir su uso al integrar completion. No inferir que toda marca de tiempo de fin sobra. |
| `completion_notes` | 0 | Notas de finalización anteriores; revisar con reglas vigentes sobre Internal notes en COMPLETED. |
| `exception_reason` | 0 | Excepción de resolución anterior, ligada a constraint; revisar con resolución/cierre. |
| `customer_unavailable_dates` | 2 | Arreglo persistido con default vacío, leído por el adaptador; parte del seguimiento futuro del cliente. No pedirlo durante New Request. |
| `customer_needs_contact` | 2 | Booleano con default false; puede solaparse con NEEDS_CONTACT. Revisar semántica al persistir respuestas, antes de elegir una representación. |
| `submission_key` | 2 | Idempotencia del alta y reintentos sin duplicar request/folio; conservar. |
| `workflow_stage` | 2 | Estado operativo del flujo actual; referencia que debe guiar la futura consolidación. |
| `reported_on_source` | 2 | Procedencia de Reported on; conservar. |
| `service_kind` | 2 | Adjustment/Replacement/Paid Extra; clasificación vigente, distinta del tipo antiguo. |
| `work_category` | 2 | Categorías vigentes, incluida Multiple work types; conservar. |
| `service_task` | 2 | Tarea para planificar; conservar. |
| `crew_size` | 2 | Personal requerido; conservar. |
| `reviewed_at` | 2 | Momento de aprobación humana; conservar. |
| `reviewed_by` | 2 | Revisor autenticado; conservar. |
| `valtrim_items_confirmed` | 2 | Confirmación explícita del alcance Valtrim; conservar. |

Las dos copias del contacto principal coinciden en los registros actuales.
La sincronización está implementada en los RPC de alta/edición, no debe suponerse
que cualquier escritura directa o RPC anterior conserve esa equivalencia.
Tampoco existe equivalencia automática entre las clasificaciones antigua/nueva
o entre sus estados. En particular, aprobar con el flujo nuevo no actualiza
`status` a un estado equivalente a READY_TO_PROPOSE.

**Inventario de tablas relacionadas y uso actual.**

| Tabla | Filas | Interpretación y recomendación |
| --- | ---: | --- |
| `service_requests` | 2 | Cabecera e identidad del servicio; mantener y reducir compatibilidad por etapas. |
| `service_properties` | 4 | Snapshot de ubicación y referencia a Job; las dos requests tienen Job. Investigar por separado propiedades sin request antes de proponer limpieza. |
| `service_request_contacts` | 4 | Contacto principal y adicional normalizados; usadas en alta, lectura, edición y aprobación. |
| `service_request_items` | 2 | Ítems, Material y Chargeable; usadas por el flujo actual. |
| `service_request_sources` | 2 | Fuente original, OCR/JSON y estado del PDF; usadas por el flujo actual. |
| `service_request_workflow_history` | 4 | Historial de las fases nuevas; mantener. |
| `service_request_status_history` | 2 | Historial del estado anterior; se genera incluso al crear una request nueva. No borrar historia al retirar su mecanismo. |
| `service_request_notes` | 0 | Colección anterior de notas, distinta de una sola nota en cabecera. Sin uso en el contrato de lectura intake revisado; evaluar con los flujos que realmente la necesiten. |
| `service_request_parts` | 0 | Modelo anterior de partes/compras; no equivale al indicador Material de un ítem. Evaluar fuera de la captura actual. |
| `service_request_attachments` | 0 | Adjuntos genéricos anteriores. El PDF fuente actual se relaciona mediante `service_request_sources.file_id` y `stored_files`; no eliminar su archivo por ver esta tabla vacía. |
| `service_request_availability` | 0 | Ventanas del cliente del contrato anterior; revisar al integrar respuestas y propuestas vigentes. |
| `service_appointments` | 0 | Modelo persistido de citas anterior. La planificación nueva sigue en memoria; validar compatibilidad con ventanas completas y crew antes de reutilizarlo. |
| `service_schedule_proposals` | 0 | Propuestas del generador anterior; no afirmar que ya persisten los borradores del Workspace actual. |
| `service_schedule_proposal_stops` | 0 | Paradas de ese generador anterior; misma revisión. |
| `service_communications` | 0 | Estructura de comunicaciones; no prueba envío SMTP implementado. |
| `private.service_confirmation_tokens` | 0 | Tokens del contrato anterior; revisar antes de conectarlos a una futura página pública. |

El alcance de conteos fue el de esas 16 tablas. También intervienen `jobs`,
`builders`, `app_users`, `stored_files`, Storage y la auditoría global; este
informe no es una auditoría completa de esos módulos ni de seguridad/RLS.

**Los dos problemas que conviene resolver antes de compartir despliegues.**

Primero, versionar el estado que ya está aplicado. Los 16 archivos todavía no
rastreados por Git incluyen todas las migraciones de intake y la limpieza.
Una copia que solo incluya lo ya confirmado en Git no reproduce el historial
actual. Preparar un commit revisado que incluya migraciones y sus dependencias
de código, pruebas y documentación; no añadir indiscriminadamente temporales,
artefactos o secretos. Esta revisión no creó ese commit ni comprobó la rama de
tu compañero.

Segundo, la cadena actual tiene una operación específica del entorno:
`20261020210000_customer_service_legacy_test_cleanup.sql`. Exige que existan
exactamente las requests 3/4 con determinados folios, timestamps y dependencias.
En una base vacía o diferente abortaría por diseño. La limpieza se aplicó en la
base vinculada y no debe repetirse allí. En esa misma base, `db push` consulta
el historial y omite las migraciones ya aplicadas.

Si el destino es otra base nueva, no ejecutar automáticamente toda esta cadena
como si ya se hubiera comprobado su reproducibilidad. Una migración correctiva
posterior no evita el aborto de una anterior. Hace falta diseñar y validar la
inicialización de ese entorno, por ejemplo mediante una línea base de esquema
controlada con su historial correspondiente, sin editar la migración aplicada
ni improvisar `migration repair` o marcar SQL como ejecutado sin comprobarlo.
Esto requiere un trabajo separado; aquí no se creó una línea base ni se probó
una instalación desde cero.

**Flujo recomendado para dos personas.**

1. Mantener una rama común de integración y una rama por cambio. Sincronizar antes
   de crear una migración y revisar sus dependencias/orden antes de integrarla.
2. Conservar las migraciones aplicadas. Las correcciones se hacen con archivos
   nuevos; no renombrar, editar ni borrar los que ya registró cualquier entorno
   compartido. Los timestamps únicos no garantizan compatibilidad entre cambios.
3. Revisar por PR los cambios de columnas junto con funciones, vistas, triggers,
   permisos, datos existentes y consumidores frontend. Evitar cambios de esquema
   directos en el Dashboard remoto.
4. Dar a una persona la responsabilidad de desplegar desde la rama integrada,
   o usar posteriormente un pipeline con despliegues serializados. Ambos pueden
   diseñar cambios; solo un proceso aplica migraciones a la base compartida.
5. Antes de aplicar, ejecutar desde `apps/backend`: `npx supabase migration list`
   y `npx supabase db push --dry-run`; revisar los archivos concretos pendientes
   y el proyecto destino. El dry-run no demuestra que el SQL ejecute con éxito.
6. Probar en un entorno remoto de desarrollo/pruebas separado de producción.
   Aquí no hay Docker ni Supabase local. Usar `npm run db:test` con el proyecto
   remoto vinculado para pgTAP; no `supabase test db --linked` ni pruebas `--local`.
   Después de desplegar, verificar contratos y persistencia de los flujos afectados.

Git separa cambios de código, pero dos ramas Git vinculadas al mismo proyecto
Supabase siguen compartiendo la misma base. Si necesitan validar cambios de
esquema incompatibles a la vez, necesitan entornos remotos separados o turnarse
para desplegar y probar, en lugar de asumir aislamiento por rama.

**Orden propuesto de simplificación.**

Primero asegurar Git, despliegues coordinados e inicialización del destino.
Después retirar de forma controlada los consumidores antiguos de `work_type`
y decidir la consolidación de `status`/`workflow_stage`. Luego migrar las copias
de contactos y el resumen de ítems a una sola fuente de verdad, conservando la
historia. Antes de cualquier DROP: comprobar dependencias, adaptar consumidores,
migrar/verificar datos y probar que altas, reintentos, ediciones concurrentes y
aprobaciones siguen funcionando. El cierre y la cancelación requieren antes
decisiones funcionales; no resolverlas por inferencia para hacer limpieza.

La regresión del bloque 4 documentó 12 suites de BD fallidas antes y después de
su limpieza, incluidas expectativas antiguas de otros módulos. Es un resultado
histórico, no una verificación repetida hoy. Esta revisión no ejecutó pruebas
que escriban datos ni certifica la suite actual en verde. Revisar esos pendientes
antes de presentar la base compartida como una línea de partida validada.

Referencias locales: `customer-service-business-rules.md`,
`customer-service-block-4-testing.md`, las migraciones de intake de octubre,
`CustomerServicePrototypeProvider.jsx`, `customerServiceIntakeRepository.js`,
`customerServiceIntakeRecord.js` y `customerServiceRepository.js`.

La recomendación de versionar el esquema y serializar despliegues sigue la
[guía oficial de migraciones de Supabase](https://supabase.com/docs/guides/deployment/database-migrations#working-with-a-team).
