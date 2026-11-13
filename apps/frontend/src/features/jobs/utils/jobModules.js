import { isRoleAllowed, PAGE_ROLES } from '../../auth/authorization/roleAccess.js'
import {
  jobDrawInvoicePath,
  jobPlanPricingPath,
  jobPlansOptionsPath,
  jobSequenceSheetPath,
} from './jobRoutes.js'

// The pages of one Job, each with the roles that may open it: the same ones the routes check.
export const JOB_MODULES = [
  { id: 'plans-options', label: 'Plans & Options', path: jobPlansOptionsPath, roles: PAGE_ROLES.planning },
  { id: 'sequence-sheet', label: 'Sequence Sheet', path: jobSequenceSheetPath, roles: PAGE_ROLES.scheduling },
  { id: 'plan-pricing', label: 'Plan Pricing', path: jobPlanPricingPath, roles: PAGE_ROLES.planning },
  { id: 'draw-invoice', label: 'Draws', path: jobDrawInvoicePath, roles: PAGE_ROLES.drawInvoice },
]

/** The pages of a Job that a role can open, so a tab never leads to "Access denied". */
export function jobModulesForRole(role) {
  return JOB_MODULES.filter((module) => isRoleAllowed(role, module.roles))
}

/** Whether a role can open the list of a Builder's Jobs, where the "Builder jobs" button goes. */
export function canOpenBuilderJobs(role) {
  return isRoleAllowed(role, PAGE_ROLES.planning)
}
