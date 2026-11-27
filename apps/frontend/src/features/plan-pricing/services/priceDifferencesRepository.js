import { requireSupabase } from '../../../services/api.js'

const DIFFERENCE_COLUMNS = [
  'id', 'recalculation_id', 'package_id', 'package_number', 'line_kind', 'lot_id',
  'draw_number', 'hardware_event_type', 'phase_id', 'phase_code', 'building', 'lot_number',
  'plan_code', 'billed_gross', 'new_gross', 'billed_net', 'new_net', 'delta_base', 'delta_hardware',
  'delta_utility', 'delta_options', 'delta_gross', 'delta_retention', 'delta_wrap',
  'delta_net', 'created_at',
].join(', ')

const PAGE_SIZE = 1000

/**
 * The price differences still pending for a Job (or one Package of it), with the
 * workflow status of each Package. Only administrators and project management can
 * read them: anyone else simply gets an empty list.
 */
export async function listPendingPriceDifferences({ jobId = null, packageId = null }) {
  const client = await requireSupabase()
  const rows = []
  let start = 0

  while (true) {
    let query = client
      .from('package_price_differences')
      .select(DIFFERENCE_COLUMNS)
      .eq('status', 'PENDING')
      .order('package_id', { ascending: true })
      .order('id', { ascending: true })
      .range(start, start + PAGE_SIZE - 1)
    if (jobId != null) query = query.eq('job_id', Number(jobId))
    if (packageId != null) query = query.eq('package_id', Number(packageId))

    const { data, error } = await query
    if (error) {
      throw new Error(error.message || 'The price differences could not be loaded.', {
        cause: error,
      })
    }

    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  const packageIds = [...new Set(rows.map((row) => row.package_id))]
  const statuses = new Map()
  if (packageIds.length > 0) {
    const { data, error } = await client
      .from('draw_packages')
      .select('id, workflow_status')
      .in('id', packageIds)

    if (error) {
      throw new Error(error.message || 'The Package statuses could not be loaded.', {
        cause: error,
      })
    }
    ;(data ?? []).forEach((row) => statuses.set(Number(row.id), row.workflow_status))
  }

  return { rows, statuses }
}
