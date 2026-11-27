import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkVisitDate,
  customerServiceHolidayName,
  isCustomerServiceBusinessDay,
  setCustomerServiceHolidays,
} from '../src/features/customer-service/utils/customerServiceScheduling.js'
import { suggestionStartDate } from '../src/features/customer-service/utils/proposalDraft.js'
import { calculatePrototypeDueDate } from '../src/features/customer-service/utils/newRequestPrototype.js'
import { calculateBusinessDueDate } from '../src/features/customer-service/schemas/persistedCustomerServiceSchema.js'

// US holidays Valtrim closes (decided 24 Nov 2026): they are not business days. Valtrim
// works the day after Thanksgiving (25 Nov 2026).
const thanksgiving = [{ date: '2026-11-26', name: 'Thanksgiving Day' }]

function withHolidays(holidays, run) {
  setCustomerServiceHolidays(holidays)
  try {
    run()
  } finally {
    setCustomerServiceHolidays([])
  }
}

test('a holiday is not a business day and keeps its name', () => {
  assert.equal(isCustomerServiceBusinessDay('2026-11-26'), true, 'without holidays loaded it is a Thursday')
  withHolidays([...thanksgiving, { date: 'not-a-date', name: 'Ignored' }], () => {
    assert.equal(isCustomerServiceBusinessDay('2026-11-26'), false)
    assert.equal(isCustomerServiceBusinessDay('2026-11-25'), true)
    assert.equal(isCustomerServiceBusinessDay('2026-11-27'), true, 'the day after Thanksgiving is a work day')
    assert.equal(isCustomerServiceBusinessDay('2026-11-28'), false, 'weekends still are not business days')
    assert.equal(customerServiceHolidayName('2026-11-26'), 'Thanksgiving Day')
    assert.equal(customerServiceHolidayName('2026-11-25'), '')
    assert.equal(customerServiceHolidayName('not-a-date'), '')
  })
})

test('no visit is registered on a holiday', () => {
  withHolidays(thanksgiving, () => {
    const { errors } = checkVisitDate({ date: '2026-11-26', workStart: '09:00', today: '2026-11-24', nowMinutes: 600 })
    assert.deepEqual(errors, [{ field: 'date', message: 'Thanksgiving Day is a holiday and Valtrim is closed.' }])
    assert.deepEqual(
      checkVisitDate({ date: '2026-11-25', workStart: '09:00', today: '2026-11-24', nowMinutes: 600 }).errors,
      [],
    )
  })
})

test('suggestions count the lead days past the holidays', () => {
  assert.equal(suggestionStartDate({ today: '2026-11-24' }).date, '2026-11-26')
  withHolidays(thanksgiving, () => {
    // Tuesday: Wednesday is one business day, then Friday after Thanksgiving is the second.
    assert.equal(suggestionStartDate({ today: '2026-11-24' }).date, '2026-11-27')
  })
})

test('due dates skip the holidays, like the database', () => {
  withHolidays(thanksgiving, () => {
    assert.equal(calculatePrototypeDueDate('2026-11-23'), '2026-12-01')
    assert.equal(calculateBusinessDueDate('2026-11-23', 5), '2026-12-01')
    assert.equal(calculateBusinessDueDate('2026-11-16', 5), '2026-11-23', 'a week without holidays is unchanged')
  })
})
