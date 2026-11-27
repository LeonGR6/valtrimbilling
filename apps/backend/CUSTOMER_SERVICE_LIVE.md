# Customer Service: quitar el modo de prueba (LIVE)

**Para:** Andrés, en el proyecto de Supabase de producción.
**Cuándo:** cuando Customer Service ya esté montado ahí (migraciones, Edge Functions, secretos y
automatización de correo) y exista el dominio de producción en Vercel.

Hasta este paso todo sigue en modo de prueba: ningún cliente real recibe correos.

## Qué está en modo de prueba

Son cuatro interruptores. Ninguno es un botón de la app: dos son secretos de las Edge Functions, uno
es una columna de la base y el otro es la dirección de la app.

| Qué | Dónde | En prueba | En LIVE |
|---|---|---|---|
| Desvío de los correos al cliente | secreto `CUSTOMER_SERVICE_TEST_RECIPIENT` | Todo correo para un cliente llega a ese buzón con el asunto `[TEST for cliente@…]`. Los avisos a quien mandó la propuesta también. | Se borra el secreto. |
| Envío real | secreto `CUSTOMER_SERVICE_CUSTOMER_EMAILS` | No existe. | `LIVE` |
| Botones del correo (página del cliente) | secreto `CUSTOMER_SERVICE_PUBLIC_APP_URL` | `http://localhost:5173`: solo funcionan en una computadora con la app corriendo. | `https://<dominio de producción>` |
| "Cancel proposal" | columna `valtrim.service_scheduling_settings.test_mode` | `true`: el botón se ve y la base permite cancelar una propuesta enviada. | `false`: el botón desaparece y la base lo impide. |

Una visita confirmada se mueve o se cancela con "Move visit" y "Cancel visit" en los dos modos (bloque
Reschedule, 27 nov 2026): no depende de `test_mode`.

Cómo se decide a quién va un correo:

- Si existe `CUSTOMER_SERVICE_TEST_RECIPIENT`, el correo va a ese buzón, aunque también esté `LIVE`.
- Si no existe, el correo va al cliente solo cuando `CUSTOMER_SERVICE_CUSTOMER_EMAILS=LIVE`.
- Sin ninguno de los dos, no sale ningún correo.

## Antes de empezar

- [x] **Bloque Reschedule terminado** (27 nov 2026): "Move visit" y "Cancel visit" funcionan también en
      LIVE.
- [ ] **El buzón de Anelda conectado** para leer las requests nuevas. Si las requests van a seguir
      llegando a otro buzón, ese.
- [ ] **Sin datos de prueba en producción.** Las migraciones de datos de prueba
      (`20261020210000`, `20261106150000`, `20261109150000`, `20261110160000`, `20261112140000`) se
      marcan como aplicadas con `supabase migration repair --status applied <versión>`, sin correrlas.
- [ ] **Usuarios reales** (Anelda y quien programe) con rol `ADMIN` o `SCHEDULING`.
- [ ] **Prueba de punta a punta en modo de prueba**, en el proyecto de producción: invitación, página
      del cliente, confirmación, recordatorios y avisos, todo llegando al buzón de prueba.
- [ ] **Revisar lo que está pendiente de enviar.** Al activar LIVE, las propuestas enviadas reciben su
      recordatorio de 24 h y las visitas confirmadas su recordatorio del día anterior, ahora con el
      cliente real. Esta consulta las lista:

```sql
select 'proposal' as kind, 'CS-' || (p.request_id + 1000) as folio, p.status::text as status,
  p.sent_at as at
from valtrim.service_proposals p
where p.status = 'SENT'
union all
select 'visit', 'CS-' || (a.request_id + 1000), a.state::text, a.window_starts_at
from valtrim.service_appointments a
where a.is_current and a.state = 'SCHEDULED' and a.window_starts_at > now()
order by kind, at;
```

  Cada fila debe ser un cliente real que de verdad espera esa visita o esa respuesta.
  - Las visitas de prueba se cancelan con "Cancel visit"; conviene desmarcar el correo al cliente.
  - Las propuestas de prueba se cancelan con "Cancel proposal" **antes** del paso 2, mientras ese botón
    todavía existe.

## Pasos

En este orden: primero la dirección y al final el envío real, para que ningún cliente reciba botones
que apunten a `localhost`.

1. **La dirección de la app.**

   ```powershell
   npx supabase secrets set CUSTOMER_SERVICE_PUBLIC_APP_URL=https://<dominio> --project-ref <ref>
   ```

   - En Supabase → Authentication → URL Configuration, el mismo dominio en *Site URL* y en
     *Redirect URLs*.
   - Comprobar que `https://<dominio>/customer-service/respond` abre **sin iniciar sesión**.
2. **Quitar el botón "Cancel proposal".** Solo en producción, en el SQL Editor (no como migración, porque
   apagaría también el modo de prueba de desarrollo):

   ```sql
   update valtrim.service_scheduling_settings set test_mode = false where id = 1;
   ```

3. **Activar el envío real.** Al borrar el desvío, el siguiente correo ya va al cliente:

   ```powershell
   npx supabase secrets set CUSTOMER_SERVICE_CUSTOMER_EMAILS=LIVE --project-ref <ref>
   ```

   ```powershell
   npx supabase secrets unset CUSTOMER_SERVICE_TEST_RECIPIENT --project-ref <ref>
   ```

   Los secretos se leen en cada llamada, así que no hace falta volver a desplegar las funciones.

## Comprobar

- [ ] Mandar una propuesta a una request cuyo "cliente" sea un correo interno (por ejemplo, el de
      Anelda). Debe llegar **sin** `[TEST for …]` en el asunto, y su botón debe abrir el dominio de
      producción.
- [ ] En la app, el aviso después de enviar ya no dice "(test inbox)".
- [ ] En Proposal Workspace ya no aparece "Cancel proposal". "Move visit" y "Cancel visit" siguen en el
      Calendar: son de uso normal.

## Si hay que volver al modo de prueba

```powershell
npx supabase secrets set CUSTOMER_SERVICE_TEST_RECIPIENT=<buzón de prueba> --project-ref <ref>
```

Desde la siguiente llamada, todo correo vuelve a llegar a ese buzón. Para que regrese el botón "Cancel
proposal", se pone `test_mode = true` con el mismo `update` del paso 2.
