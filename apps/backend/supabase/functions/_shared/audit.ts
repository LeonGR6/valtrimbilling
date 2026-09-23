import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export type AuditResult = 'SUCCESS' | 'REJECTED' | 'FAILED'

export interface AuditActor {
  id: string
  name: string
  email: string
  role: string
}

export interface AuditTargetUser {
  id?: string | null
  name?: string | null
  email?: string | null
}

export interface AuditEventInput {
  correlationId?: string
  module: string
  action: string
  result: AuditResult
  actor: AuditActor
  targetUser?: AuditTargetUser
  entityType: string
  entityId?: string | number | null
  entityLabel?: string | null
  summary: string
  previousValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

function toAuditRow(event: AuditEventInput) {
  return {
    correlation_id: event.correlationId ?? crypto.randomUUID(),
    module: event.module,
    action: event.action,
    result: event.result,
    actor_type: 'USER',
    actor_user_id: event.actor.id,
    actor_name: event.actor.name,
    actor_email: event.actor.email,
    actor_role: event.actor.role,
    target_user_id: event.targetUser?.id ?? null,
    target_name: event.targetUser?.name ?? null,
    target_email: event.targetUser?.email ?? null,
    entity_type: event.entityType,
    entity_id: event.entityId === null || event.entityId === undefined
      ? null
      : String(event.entityId),
    entity_label: event.entityLabel ?? null,
    summary: event.summary,
    previous_values: event.previousValues ?? {},
    new_values: event.newValues ?? {},
    metadata: event.metadata ?? {},
  }
}

// Audit writes are best effort during this first rollout. A completed business
// operation must not be reported as failed just because its audit insert had a
// transient problem; the failure still reaches the Edge Function logs.
export async function writeAuditEvents(
  db: SupabaseClient<any, any, any, any, any>,
  events: AuditEventInput[],
): Promise<boolean> {
  if (events.length === 0) return true

  const { error } = await db
    .from('audit_events')
    .insert(events.map(toAuditRow))

  if (error) {
    console.error('Unable to write application audit event.', {
      code: error.code,
      actions: events.map(({ action }) => action),
    })
    return false
  }

  return true
}

export async function writeAuditEvent(
  db: SupabaseClient<any, any, any, any, any>,
  event: AuditEventInput,
): Promise<boolean> {
  return writeAuditEvents(db, [event])
}
