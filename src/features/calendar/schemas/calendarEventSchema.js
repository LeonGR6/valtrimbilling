import { z } from 'zod'

const requiredText = (message, max = 100) => z
  .string()
  .trim()
  .min(1, message)
  .max(max, `Usa ${max} caracteres o menos.`)

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

export const calendarEventSchema = z
  .object({
    code: requiredText('Ingresa el código del trabajo.', 12)
      .transform((value) => value.toUpperCase()),
    workType: requiredText('Ingresa el tipo de trabajo.'),
    lots: requiredText('Ingresa al menos un lote o unidad.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha válida.'),
    startTime: z.string().regex(timePattern, 'Selecciona una hora de inicio válida.'),
    endTime: z.string().regex(timePattern, 'Selecciona una hora de fin válida.'),
    builder: requiredText('Ingresa el builder.'),
    community: requiredText('Ingresa la comunidad.'),
    phase: requiredText('Ingresa la fase.', 30),
    building: requiredText('Ingresa el edificio.', 30),
    status: z.enum(['Confirmado', 'En curso', 'Completado', 'Excepción']),
    foreman: requiredText('Ingresa el responsable.'),
    crew: requiredText('Ingresa la cuadrilla.'),
    plan: requiredText('Ingresa el plan.', 30),
    rate: z.coerce.number().min(0, 'La tarifa no puede ser negativa.'),
    progress: z.number().min(0).max(100).optional(),
    billingReady: z.boolean().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    path: ['endTime'],
    message: 'La hora de fin debe ser posterior a la hora de inicio.',
  })
