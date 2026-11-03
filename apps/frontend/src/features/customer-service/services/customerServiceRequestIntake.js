import { requireSupabase } from '../../../services/api.js'
import { uploadCustomerServiceSourcePdf } from './customerServiceSourcePdf.js'
import { createCustomerServiceIntakeRepository } from './customerServiceIntakeRepository.js'

export const customerServiceIntakeRepository = createCustomerServiceIntakeRepository({
  getClient: requireSupabase,
  uploadPdf: uploadCustomerServiceSourcePdf,
})
