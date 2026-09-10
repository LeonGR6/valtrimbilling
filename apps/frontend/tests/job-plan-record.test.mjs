import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeJobPlanRecord,
  mergePlanOptionRecord,
  toJobPlan,
  toJobPlanMutation,
  toOptionPriceRpc,
  toPlanOption,
  toPlanOptionMutation,
  toPlanPriceRpc,
} from '../src/features/jobs/services/jobPlanRecord.js'

test('Plan mutations normalize codes and preserve an optional display name', () => {
  assert.deepEqual(toJobPlanMutation('12', {
    code: ' 2-ada ',
    name: ' ADA Plan ',
  }), {
    job_id: 12,
    code: '2-ADA',
    name: 'ADA Plan',
    description: null,
  })

  assert.deepEqual(toJobPlanMutation(12, {
    code: ' 3 ',
    name: ' ',
  }), {
    job_id: 12,
    code: '3',
    name: '3',
    description: null,
  })
})

test('Option mutations use the UI description as the billing-line name', () => {
  assert.deepEqual(toPlanOptionMutation('31', {
    code: ' 2-opt ',
    description: ' Door at Primary Bath ',
  }), {
    plan_id: 31,
    code: '2-OPT',
    name: 'Door at Primary Bath',
    description: 'Door at Primary Bath',
  })
})

test('Plan and Option rows map current nullable prices', () => {
  const option = toPlanOption({
    id: 61,
    plan_id: 31,
    code: '2-OPT',
    name: 'Door at Primary Bath',
    description: null,
    is_active: true,
  }, { price: '250.50' })
  const plan = toJobPlan({
    id: 31,
    job_id: 12,
    code: '2',
    name: '2',
    description: null,
    is_active: true,
  }, {
    base_price: '7360.00',
    hardware_price: null,
  }, [option])

  assert.deepEqual(option, {
    id: 61,
    planId: 31,
    code: '2-OPT',
    description: 'Door at Primary Bath',
    price: 250.5,
    isActive: true,
  })
  assert.deepEqual(plan, {
    id: 31,
    jobId: 12,
    code: '2',
    name: '',
    price: 7360,
    hardwarePrice: null,
    isActive: true,
    options: [option],
  })
})

test('Price RPC payloads expose only ids and normalized amounts', () => {
  assert.deepEqual(toPlanPriceRpc('31', '7360.00', null), {
    p_plan_id: 31,
    p_base_price: 7360,
    p_hardware_price: null,
  })
  assert.deepEqual(toOptionPriceRpc('61', '250.50'), {
    p_option_id: 61,
    p_price: 250.5,
  })
})

test('Catalog edits retain prices and nested Options already in state', () => {
  const options = [{ id: 61, price: 250 }]
  assert.deepEqual(mergeJobPlanRecord({
    id: 31,
    code: '2',
    name: 'Plan 2',
    price: 7360,
    hardwarePrice: 1200,
    options,
  }, {
    id: 31,
    code: '2A',
    name: 'Plan 2A',
    price: null,
    hardwarePrice: null,
    options: [],
  }), {
    id: 31,
    code: '2A',
    name: 'Plan 2A',
    price: 7360,
    hardwarePrice: 1200,
    options,
  })

  assert.deepEqual(mergePlanOptionRecord({
    id: 61,
    code: '2-OPT',
    description: 'Old',
    price: 250,
  }, {
    id: 61,
    code: '2-OPT',
    description: 'Updated',
    price: null,
  }), {
    id: 61,
    code: '2-OPT',
    description: 'Updated',
    price: 250,
  })
})
