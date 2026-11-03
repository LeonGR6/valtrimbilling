# Customer Service — bloque 4: limpieza y regresión

## Limpieza remota aplicada

Ejecutada el 20 de octubre de 2026 mediante
`20261020210000_customer_service_legacy_test_cleanup.sql`.
El usuario autorizó expresamente **eliminar sin respaldar**. No se exportaron
requests ni se crearon copias recuperables o scripts de restauración.
La eliminación ya se confirmó; no hay un despliegue pendiente de esta limpieza.

| Datos eliminados | IDs / cantidad |
| --- | --- |
| Requests antiguas | 3 — SR-00001003; 4 — SR-00001004 |
| Propiedades exclusivas sin Job | 3 y 4 |
| Citas de prueba | 2 y 3, ambas vinculadas a la propuesta 19 |
| Propuestas históricas exclusivas | IDs 1–21, enumerados explícitamente en SQL |
| Paradas de esas propuestas | 42, todas correspondientes a requests 3/4 |
| Disponibilidades | 2 |
| Historial de estado de las requests | 4 |

No había archivos, fuentes, contactos, ítems, notas, partes, comunicaciones ni
tokens de confirmación asociados. No se borró nada de Storage ni se desplegaron
Edge Functions. No se reiniciaron secuencias de IDs o folios.

Se conservaron `CS-1055` (ID 55, READY_TO_PROPOSE) y `CS-1064` (ID 64,
NEEDS_REVIEW), ambas vinculadas al Job 12, con sus contactos, ítems y fuentes.
La migración comparó hashes antes/después de todos los registros ajenos en las
tablas afectadas, auditoría histórica, Builders, Jobs, técnicos y archivos.
Esos hashes solo existieron en memoria durante la transacción: no son respaldos.
Se añadieron dos eventos SERVICE_REQUEST_TEST_DATA_DELETED con identidades y
conteos, sin copiar contenido de las requests. La auditoría anterior permanece.

## Protecciones verificadas antes del borrado

La migración se probó primero dentro de una transacción con rollback. Rechazó:

- Una request cuya versión cambió después del inventario.
- Una propiedad vinculada a un Job o compartida con otra request.
- Una propuesta que incluyera una request ajena a las dos pruebas.
- Fuentes/dependencias nuevas no presentes durante la inspección.

Una falla inyectada al eliminar las propiedades, después de borrar citas,
propuestas y requests, revirtió toda la operación y no dejó auditoría de éxito.
La validación también comprobó la conservación de las requests ajenas.
Después se ejecutaron migration list y db push --dry-run: solo estaba pendiente
la migración de limpieza. db push la aplicó y se verificó su registro remoto.

## Regresión automatizada

- Frontend: **379 pruebas aprobadas**, antes y después de la limpieza.
- Lint completo del frontend: aprobado.
- Build: aprobado; permanece el aviso de bundle mayor a 500 kB.
- Edge Functions: **44 pruebas unitarias aprobadas**, con transportes simulados,
  sin habilitar acceso de los tests a APIs reales.
- Comprobación estática completa de Edge Functions: aprobada.
- BD antes: **29 suites aprobadas / 12 fallidas**, sobre 41 suites.
- BD después: **30 suites aprobadas / las mismas 12 fallidas**, sobre 42 suites.
  La suite nueva de limpieza pasó; no aparecieron suites fallidas adicionales.

La suite nueva `customer_service_legacy_test_cleanup.test.sql` valida los IDs
retirados, dependencias, auditoría sin contenido/respaldos y ausencia de huérfanos.
Las pruebas de BD utilizan el proyecto remoto vinculado y rollback. No se usó
Docker ni una base local. No se hizo una comprobación manual en navegador en
este paso; las guías de los bloques 1–3 conservan sus recorridos manuales.

### Fallos detectados ANTES de la limpieza

No se modificaron estas pruebas, los permisos de otros módulos ni las reglas de
agenda para ocultar los fallos. Requieren revisión separada; ejecutar la regresión
completa no significa que haya terminado sin fallos.

| Suite | Aserciones fallidas en la línea base |
| --- | --- |
| customer_service_scheduling_restrictions | Caso 9: espera que todos los perfiles técnicos usen jornada 07:00–17:00; no coincide con los datos actuales. La regla vigente de la nueva planificación termina a las 15:30. |
| phase_0_auth_rls | Caso 9: espera Plans todavía cerrado. |
| phase_1_builders | Caso 17: espera Plans todavía cerrado. |
| phase_2_supervisors | Casos 22–24: espera 3 políticas RLS, existen 6; espera Communities/jobsites y Plans cerrados. |
| phase_3_builder_contacts | Casos 17–18: espera Communities y Plans cerrados. |
| phase_4_builder_billing_setups | Casos 36–37: espera Plans y Communities cerrados. |
| phase_5_jobs | Casos 19–21: espera Communities, Plans y Sequence Sheet cerrados. |
| phase_6_plans_options_pricing | Casos 46–47: espera Phases y Lots cerrados. |
| phase_7_sequence_sheets | Caso 36: espera Customer Service todavía cerrado. |
| phase_8_draw_invoice_packages | Caso 38: espera Customer Service todavía cerrado. |
| phase_10_production_calendar | Caso 35: espera Customer Service todavía cerrado. |
| phase_14_draw_package_corrections | Caso 14: no pasa la comprobación textual que espera bloqueo de Phase antes de Packages. No se certifica aquí su orden efectivo de bloqueo. |

### Comandos para repetir la verificación

No volver a ejecutar manualmente el SQL de eliminación: sus objetivos ya no
existen y sus protecciones lo rechazarían. La migración quedó registrada como aplicada.

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\backend
npm run db:test
npm run db:test -- customer_service_legacy_test_cleanup.test.sql
npx deno test --config supabase/functions/deno.json --lock supabase/functions/deno.lock supabase/functions/_shared supabase/functions/users-admin/user-status.test.ts
```

```powershell
cd C:\Users\u\Documentos\Proyectos\ValtrimBilling\apps\frontend
npm test
npm run lint
npm run build
```
