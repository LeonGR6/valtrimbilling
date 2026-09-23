import { requireSupabase } from '../../../services/api.js'

const auditColumns = [
  'id',
  'correlation_id',
  'module',
  'action',
  'result',
  'actor_user_id',
  'actor_name',
  'actor_email',
  'actor_role',
  'target_user_id',
  'target_name',
  'target_email',
  'entity_type',
  'entity_id',
  'entity_label',
  'summary',
  'previous_values',
  'new_values',
  'metadata',
  'created_at',
].join(',')

function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

function periodStart(period) {
  if (period === 'all') return null

  const start = new Date()
  if (period === '1') {
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(start.getDate() - Number(period))
  }
  return start.toISOString()
}

function mapAuditEvent(row) {
  const metadata = row.metadata ?? {}
  const entitySubtitle = {
    BUILDER: metadata.builderCode,
    BUILDER_CONTACT: metadata.builderName,
    SUPERVISOR: metadata.supervisorEmail ?? metadata.territory,
  }[row.entity_type]

  return {
    id: row.id,
    correlationId: row.correlation_id,
    occurredAt: row.created_at,
    module: row.module,
    action: row.action,
    result: row.result,
    actor: {
      id: row.actor_user_id,
      name: row.actor_name,
      email: row.actor_email ?? row.actor_role ?? 'System',
      role: row.actor_role,
    },
    target: {
      id: row.target_user_id,
      name: row.target_name ?? row.entity_label ?? 'Unknown record',
      email: row.target_email ?? entitySubtitle ?? row.entity_type,
    },
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: row.entity_label,
    summary: row.summary,
    source: row.module,
    previousValues: row.previous_values ?? {},
    nextValues: row.new_values ?? {},
    metadata,
  }
}

function applyAuditFilters(query, {
  search,
  module,
  action,
  result,
  period,
}) {
  let filtered = query
  const normalizedSearch = search.trim().toLowerCase()
  const createdAfter = periodStart(period)

  if (normalizedSearch) {
    filtered = filtered.ilike(
      'search_text',
      `%${escapeLikePattern(normalizedSearch)}%`,
    )
  }
  if (module !== 'all') filtered = filtered.eq('module', module)
  if (action !== 'all') filtered = filtered.eq('action', action)
  if (result !== 'all') filtered = filtered.eq('result', result)
  if (createdAfter) filtered = filtered.gte('created_at', createdAfter)

  return filtered
}

export async function listAuditEvents({
  search = '',
  module = 'all',
  action = 'all',
  result = 'all',
  period = '30',
  page = 0,
  rowsPerPage = 10,
} = {}) {
  const client = await requireSupabase()
  const from = page * rowsPerPage
  const to = from + rowsPerPage - 1
  let query = client
    .from('audit_events')
    .select(auditColumns, { count: 'exact' })

  query = applyAuditFilters(query, { search, module, action, result, period })
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    events: (data ?? []).map(mapAuditEvent),
    total: count ?? 0,
  }
}

async function countAuditEvents(client, configure = (query) => query) {
  const query = configure(
    client.from('audit_events').select('id', { count: 'exact', head: true }),
  )
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function getAuditStats() {
  const client = await requireSupabase()
  const today = periodStart('1')
  const [eventsToday, userEvents, catalogChanges, problemEvents] = await Promise.all([
    countAuditEvents(client, (query) => query.gte('created_at', today)),
    countAuditEvents(client, (query) => query.eq('module', 'USERS')),
    countAuditEvents(client, (query) => query.in(
      'module',
      ['BUILDERS', 'BUILDER_CONTACTS', 'PEOPLE'],
    )),
    countAuditEvents(client, (query) => query.in('result', ['REJECTED', 'FAILED'])),
  ])

  return { eventsToday, userEvents, catalogChanges, problemEvents }
}
