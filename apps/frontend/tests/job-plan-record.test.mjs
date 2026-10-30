import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyJobPriceChanges,
  mergeJobPlanRecord,
  mergePlanOptionRecord,
  toJobPlan,
  toJobPlanMutation,
  toJobPricesRpc,
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
    priceNotApplicable: false,
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
    p_not_applicable: false,
  })
})

test('an Option priced NA is $0 with the flag, and goes to the database as NA', () => {
  const option = toPlanOption({
    id: 62, plan_id: 31, code: '2-OPT2', name: 'Window', description: null, is_active: true,
  }, { price: '0.00', is_not_applicable: true })

  assert.equal(option.price, 0)
  assert.equal(option.priceNotApplicable, true)
  // Whatever number was typed is ignored: NA is always sent as 0.
  assert.deepEqual(toOptionPriceRpc('62', 99, true), {
    p_option_id: 62,
    p_price: 0,
    p_not_applicable: true,
  })
  // An Option that was never priced has no price and is not NA.
  const unpriced = toPlanOption({
    id: 63, plan_id: 31, code: 'X', name: 'X', description: null, is_active: true,
  })
  assert.equal(unpriced.price, null)
  assert.equal(unpriced.priceNotApplicable, false)
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

test('the changed prices of a sheet go to the database as two lists of one Job', () => {
  const changes = [
    { type: 'plan', plan: { id: '31' }, to: { base: '7360.00', hardware: null } },
    { type: 'plan', plan: { id: 32 }, to: { base: 5000, hardware: '80.5' } },
    { type: 'option', plan: { id: 31 }, option: { id: '61' }, to: { amount: '250.50', notApplicable: false } },
    // Whatever number was typed is ignored: NA is always sent as 0.
    { type: 'option', plan: { id: 31 }, option: { id: 62 }, to: { amount: 99, notApplicable: true } },
    { type: 'option', plan: { id: 32 }, option: { id: 63 }, to: { amount: -150, notApplicable: false } },
  ]

  assert.deepEqual(toJobPricesRpc('14', changes), {
    p_job_id: 14,
    p_plans: [
      { plan_id: 31, base_price: 7360, hardware_price: null },
      { plan_id: 32, base_price: 5000, hardware_price: 80.5 },
    ],
    p_options: [
      { option_id: 61, price: 250.5, not_applicable: false },
      { option_id: 62, price: 0, not_applicable: true },
      { option_id: 63, price: -150, not_applicable: false },
    ],
  })
})

test('saving the sheet changes only the prices that were saved, in one pass', () => {
  const plans = [
    {
      id: 31,
      code: '2450',
      price: 7000,
      hardwarePrice: null,
      options: [
        { id: 61, code: 'A', price: 100, priceNotApplicable: false },
        { id: 62, code: 'B', price: 200, priceNotApplicable: false },
        { id: 63, code: 'C', price: null, priceNotApplicable: false },
      ],
    },
    { id: 32, code: '1980', price: 5000, hardwarePrice: 40, options: [{ id: 64, code: 'D', price: 10, priceNotApplicable: false }] },
  ]
  const saved = applyJobPriceChanges(plans, [
    { type: 'plan', plan: plans[0], to: { base: 7360, hardware: 80 } },
    { type: 'option', plan: plans[0], option: plans[0].options[0], to: { amount: 250.5, notApplicable: false } },
    { type: 'option', plan: plans[0], option: plans[0].options[2], to: { amount: 99, notApplicable: true } },
  ])

  assert.equal(saved[0].price, 7360)
  assert.equal(saved[0].hardwarePrice, 80)
  assert.deepEqual(saved[0].options.map(({ id, price, priceNotApplicable }) => [id, price, priceNotApplicable]), [
    [61, 250.5, false],
    [62, 200, false],
    [63, 0, true],
  ])
  // What was not changed is the same object, so it does not render again.
  assert.equal(saved[1], plans[1])
  assert.equal(plans[0].price, 7000)
})
