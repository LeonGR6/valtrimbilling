import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FILTER_BATCH_SIZE,
  FILTER_CONCURRENCY,
  PAGE_SIZE,
  inBatches,
  listAllRows,
  listAllRowsByIds,
} from '../src/services/pagedQuery.js'

// A table the way the Data API serves it: a request never returns more than 1000 rows, whatever
// range it asks for, and the last ones are simply missing.
function fakeTable(rows, { apiLimit = PAGE_SIZE } = {}) {
  return (filter = () => true) => ({
    range(start, end) {
      const matching = rows.filter(filter)
      const asked = matching.slice(start, end + 1)
      return Promise.resolve({ data: asked.slice(0, apiLimit), error: null })
    },
  })
}
const options = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1, plan_id: (index % 50) + 1 }))
const never = () => assert.fail('no error expected')

test('a list longer than a page is read in full, in order, with no row twice', async () => {
  const rows = options(2503)
  const read = await listAllRows(() => fakeTable(rows)(), never)

  assert.equal(read.length, 2503)
  assert.deepEqual(read.map(({ id }) => id), rows.map(({ id }) => id))
})

test('a page that is exactly full asks for the next one', async () => {
  assert.equal((await listAllRows(() => fakeTable(options(2000))(), never)).length, 2000)
  assert.equal((await listAllRows(() => fakeTable(options(1000))(), never)).length, 1000)
  assert.equal((await listAllRows(() => fakeTable([])(), never)).length, 0)
})

test('an error from a page goes to the handler, which says what happened', async () => {
  const seen = []
  const query = () => ({ range: () => Promise.resolve({ data: null, error: { code: '42501', message: 'denied' } }) })

  await assert.rejects(
    listAllRows(query, (error) => { seen.push(error.code); throw new Error('You do not have permission.') }),
    /permission/,
  )
  assert.deepEqual(seen, ['42501'])
})

test('a filter on many ids goes in batches, and each batch is read in full', async () => {
  const rows = options(1500)
  const ids = Array.from({ length: 50 }, (_, index) => index + 1)
  const batches = []
  const read = await listAllRowsByIds(ids, (batch) => {
    batches.push(batch.length)
    return fakeTable(rows, { apiLimit: 400 })((row) => batch.includes(row.plan_id))
  }, never, 400)

  assert.equal(read.length, 1500)
  // One batch of 50 ids, asked for four times: 400 rows a page.
  assert.deepEqual(batches, [50, 50, 50, 50])
  assert.deepEqual(inBatches(Array.from({ length: 450 }, (_, index) => index)).map((batch) => batch.length), [200, 200, 50])
  assert.equal(FILTER_BATCH_SIZE, 200)

  const many = Array.from({ length: 450 }, (_, index) => index + 1)
  const sizes = []
  await listAllRowsByIds(many, (batch) => { sizes.push(batch.length); return fakeTable([])() }, never)
  assert.deepEqual(sizes, [200, 200, 50])
  assert.deepEqual(await listAllRowsByIds([], () => fakeTable(rows)(), never), [])
})

const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds) })

// A table whose every request takes `delayOf(batch)` and that counts the requests in flight.
function slowTable({ delayOf = () => 5, failOn = () => false } = {}) {
  const state = { inFlight: 0, mostInFlight: 0, started: [] }
  const queryFor = (batch) => ({
    async range() {
      state.started.push(batch[0])
      state.inFlight += 1
      state.mostInFlight = Math.max(state.mostInFlight, state.inFlight)
      await wait(delayOf(batch))
      state.inFlight -= 1
      return failOn(batch)
        ? { data: null, error: { code: '42501', message: 'denied' } }
        : { data: batch.map((id) => ({ id })), error: null }
    },
  })
  return { state, queryFor }
}
const idsUpTo = (count) => Array.from({ length: count }, (_, index) => index + 1)

test('batches are read in parallel but never more than the limit at once', async () => {
  const { state, queryFor } = slowTable()

  const read = await listAllRowsByIds(idsUpTo(2000), queryFor, never, PAGE_SIZE, 3)

  assert.equal(read.length, 2000)
  assert.equal(state.started.length, 10)
  assert.equal(state.mostInFlight, 3)
  assert.equal(FILTER_CONCURRENCY, 6)
})

test('the rows come back in the order of the ids, whichever batch finishes first', async () => {
  // The later the batch, the sooner it answers.
  const { queryFor } = slowTable({ delayOf: (batch) => Math.max(1, 30 - Math.floor(batch[0] / 10)) })

  const read = await listAllRowsByIds(idsUpTo(1000), queryFor, never)

  assert.deepEqual(read.map(({ id }) => id), idsUpTo(1000))
})

test('after a batch fails no new batch is started, and the error is the one reported', async () => {
  // The failing batch answers first; the other one is still running when it does.
  const { state, queryFor } = slowTable({
    delayOf: (batch) => (batch[0] === 201 ? 1 : 15),
    failOn: (batch) => batch[0] === 201,
  })

  await assert.rejects(
    listAllRowsByIds(idsUpTo(2000), queryFor, (error) => { throw new Error(`failed ${error.code}`) }, PAGE_SIZE, 2),
    /failed 42501/,
  )
  await wait(40)

  // Two were running; the one that did not fail stopped instead of taking the next.
  assert.deepEqual(state.started, [1, 201])
})
