import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPackageScheduleFileName,
  buildPackageScheduleStoragePath,
  describeDifference,
  describeOver,
  describeRepeated,
  describeSchedulePlan,
  describeUnmatchedLine,
  listEarlierPackages,
  matchPackageToSchedules,
  packageScheduleLines,
  summarizeSources,
} from '../src/features/payment-schedules/services/packageSchedule.js'

const rect = { x: 0.1, y: 0.2, w: 0.05, h: 0.01 }
const cell = (phase, lot, draw, amount, page = 1) => ({ phase, lot, draw, amount, page, rect })
const template = (id, cells, confirmedAt = '2026-10-10T10:00:00Z') => ({
  id,
  confirmedAt,
  pdf: { name: `${id}.pdf` },
  mapping: { version: 1, layout: 'matrix', cells },
})

// A Package line as the Package record stores it: draw index starts at 0.
const line = (phaseCode, lotNumber, drawIndex, baseDrawAmount, extra = {}) => ({
  phaseCode, lotNumber, drawIndex, baseDrawAmount, hardwareAmount: 0, ...extra,
})
const record = (...lines) => ({ persistedDrawLines: lines })

test('Package lines carry the Phase, Lot, draw number (from 1) and the accepted amounts', () => {
  const [one] = packageScheduleLines(record(line('MODELS', '1', 1, 1348.02, { hardwareAmount: 100 })))
  assert.deepEqual(
    [one.phase, one.lot, one.draw, one.label, one.packageAmount],
    ['MODELS', '1', 2, 'Lot 1', 1348.02],
  )
  assert.deepEqual(one.acceptedCents, [134802, 144802])
  assert.deepEqual(packageScheduleLines(null), [])
  assert.deepEqual(
    packageScheduleLines(record(line('1', 'UTILITY-1', 0, 5, { isUtilityBuilding: true, utilityLabel: 'Utility Closet' })))[0].label,
    'Utility Closet',
  )
})

test('a line finds its cell by Phase, Lot and draw, ignoring zeros and case', () => {
  const t = template('a', [cell('MODELS', '0001', 1, 1797.36), cell('MODELS', '0001', 2, 1348.02)])
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('Models', '1', 0, 1797.36), line('MODELS', '1', 1, 1348.02))),
    [t],
  )
  assert.equal(plan.matches.length, 2)
  assert.deepEqual(plan.matches.map((m) => m.cell.draw), [1, 2])
  assert.equal(plan.unmatched.length, 0)
  assert.equal(plan.differing.length, 0)
})

test('a cell in another Phase is not a match', () => {
  const t = template('a', [cell('MODELS', '1', 1, 100)])
  const plan = matchPackageToSchedules(packageScheduleLines(record(line('PHASE 2', '1', 0, 100))), [t])
  assert.equal(plan.matches.length, 0)
  assert.equal(plan.unmatched.length, 1)
})

test('a cell without a Phase matches the Lot and draw in any Phase, and a Phase one wins', () => {
  const t = template('a', [cell(null, '1', 1, 100), cell('B', '1', 1, 200)])
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('A', '1', 0, 100), line('B', '1', 0, 200))),
    [t],
  )
  assert.deepEqual(plan.matches.map((m) => m.cell.amount), [100, 200])
  assert.equal(plan.differing.length, 0)
})

test('amounts that differ are reported, and hardware billed in the draw is accepted', () => {
  const t = template('a', [cell('1', '1', 1, 1000), cell('1', '2', 1, 999.99)])
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(
      line('1', '1', 0, 900, { hardwareAmount: 100 }),
      line('1', '2', 0, 1000),
    )),
    [t],
  )
  assert.equal(plan.matches[0].amountsAgree, true)
  assert.equal(plan.matches[1].amountsAgree, false)
  assert.equal(plan.differing.length, 1)
  assert.equal(
    describeDifference(plan.differing[0]),
    'Lot 2 · draw 1: Package $1,000.00, schedule $999.99',
  )
})

test('lines the schedules do not list are returned, with a readable name', () => {
  const t = template('a', [cell('1', '1', 1, 100)])
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('1', '1', 0, 100), line('1', '7', 2, 50))),
    [t],
  )
  assert.equal(plan.unmatched.length, 1)
  assert.equal(describeUnmatchedLine(plan.unmatched[0]), '1 · Lot 7 · draw 3')
})

test('each schedule used lists its cells, and the newest confirmed schedule wins a shared cell', () => {
  const older = template('older', [cell('1', '1', 1, 100), cell('1', '2', 1, 100)], '2026-10-01T00:00:00Z')
  const newer = template('newer', [cell('1', '1', 1, 100)], '2026-10-09T00:00:00Z')
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('1', '1', 0, 100), line('1', '2', 0, 100))),
    [older, newer],
  )
  assert.deepEqual(plan.sources.map((s) => [s.template.id, s.cells.length]), [['newer', 1], ['older', 1]])
})

test('a schedule with no match is not a source, and the plan says whether anything can be generated', () => {
  const unused = template('unused', [cell('9', '9', 1, 1)])
  const used = template('used', [cell('1', '1', 1, 100)])
  const lines = packageScheduleLines(record(line('1', '1', 0, 100), line('1', '5', 0, 100)))
  const plan = matchPackageToSchedules(lines, [unused, used])

  assert.deepEqual(plan.sources.map((s) => s.template.id), ['used'])
  assert.deepEqual(describeSchedulePlan(plan, lines.length), {
    highlighted: 1, lineCount: 2, sourceCount: 1, warnings: 1, canGenerate: true,
  })

  const none = matchPackageToSchedules(lines, [unused])
  assert.equal(describeSchedulePlan(none, lines.length).canGenerate, false)
  assert.equal(matchPackageToSchedules([], [used]).matches.length, 0)
})

test('the generated file is named after the Job and the Package and lives under the Package', () => {
  assert.equal(
    buildPackageScheduleFileName({ jobCode: '1318', packageNumber: 'DP-00000046' }),
    'Payment Schedule - Job 1318 - DP-00000046.pdf',
  )
  assert.equal(
    buildPackageScheduleFileName({ jobCode: 'A/B:C', packageNumber: '' }),
    'Payment Schedule - Job A B C.pdf',
  )
  assert.equal(buildPackageScheduleStoragePath(68, 'abc'), '68/payment_schedule/abc.pdf')
})

// --- Previously Invoiced and This Request ---------------------------------

const target = (draw, y) => ({ draw, page: 1, rect: { x: 0.2 + draw * 0.05, y, w: 0.04, h: 0.01 } })
const summaryRows = {
  previouslyInvoiced: [1, 2, 3].map((draw) => target(draw, 0.4)),
  thisRequest: [1, 2, 3].map((draw) => target(draw, 0.42)),
}
// The schedule of the reference image: Lots 14 to 27, draws 1 to 3 here.
const schedule = (id, extra = {}) => ({
  ...template(id, [
    ...['14', '15', '16', '17', '18', '19', '20', '21', '22'].flatMap((lot) => [
      cell('003', lot, 1, 1929.04), cell('003', lot, 2, 1446.78), cell('003', lot, 3, 482.26),
    ]),
    ...['23', '24', '25', '26', '27'].flatMap((lot) => [
      cell('003', lot, 1, 2149.2), cell('003', lot, 2, 1611.9), cell('003', lot, 3, 537.3),
    ]),
  ]),
  mapping: { version: 1, layout: 'matrix', cells: [], summaryRows },
  ...extra,
})
function scheduleWithRows(id = 'ex1') {
  const base = schedule(id)
  // template() builds the mapping from the cells; rebuild it with the rows.
  const built = template(id, [
    ...['14', '15', '16', '17', '18', '19', '20', '21', '22'].flatMap((lot) => [
      cell('003', lot, 1, 1929.04), cell('003', lot, 2, 1446.78), cell('003', lot, 3, 482.26),
    ]),
    ...['23', '24', '25', '26', '27'].flatMap((lot) => [
      cell('003', lot, 1, 2149.2), cell('003', lot, 2, 1611.9), cell('003', lot, 3, 537.3),
    ]),
  ])
  built.mapping = { ...built.mapping, summaryRows }
  void base
  return built
}
const lotsLines = (lots, draw, amount) => lots.map((lot) => line('3', lot, draw - 1, amount))
const pkg = (id, createdAt, lines, extra = {}) => ({
  id, jobId: 1, packageNumber: `DP-${id}`, packageType: 'DRAW', status: 'AWAITING_PAYMENT',
  createdAt, persistedDrawLines: lines, ...extra,
})

test('only earlier, uncancelled draw Packages of the same Job count as invoiced', () => {
  const current = pkg(10, '2026-10-10T10:00:00Z', [])
  const list = listEarlierPackages(current, [
    pkg(9, '2026-10-09T10:00:00Z', []),
    pkg(7, '2026-10-01T10:00:00Z', []),
    pkg(11, '2026-10-11T10:00:00Z', []),
    pkg(10, '2026-10-10T10:00:00Z', []),
    pkg(8, '2026-10-02T10:00:00Z', [], { status: 'CANCELLED' }),
    pkg(6, '2026-10-02T10:00:00Z', [], { packageType: 'RETENTION_RELEASE' }),
    pkg(4, '2026-10-02T10:00:00Z', [], { packageType: 'PRICE_ADJUSTMENT' }),
    pkg(5, '2026-10-02T10:00:00Z', [], { jobId: 2 }),
    pkg(12, '2026-10-10T10:00:00Z', []),
  ])
  assert.deepEqual(list.map(({ id }) => id), [7, 9])
  assert.deepEqual(listEarlierPackages(current, null), [])
})

test('the rows hold what was billed before and what this Package bills, per draw', () => {
  const t = scheduleWithRows()
  const lots9 = ['14', '15', '16', '17', '18', '19', '20', '21', '22']
  const lots5 = ['23', '24', '25', '26', '27']

  // Before: draw 1 of all 14 Lots, and draws 2 and 3 of the first nine.
  const before = packageScheduleLines(record(
    ...lotsLines(lots9, 1, 1929.04), ...lotsLines(lots5, 1, 2149.2),
    ...lotsLines(lots9, 2, 1446.78), ...lotsLines(lots9, 3, 482.26),
  ))
  // Now: draws 2 and 3 of the last five.
  const now = packageScheduleLines(record(...lotsLines(lots5, 2, 1611.9), ...lotsLines(lots5, 3, 537.3)))

  const [item] = summarizeSources(
    matchPackageToSchedules(now, [t]),
    [{ id: 1, number: 'DP-1', plan: matchPackageToSchedules(before, [t]) }],
  )

  assert.deepEqual(
    item.draws.map(({ draw, previously, request, contract }) => [draw, previously, request, contract]),
    [
      [1, 28107.36, 0, 28107.36],
      [2, 13021.02, 8059.5, 21080.52],
      [3, 4340.34, 2686.5, 7026.84],
    ],
  )
  // Draw 2 and 3 close exactly: before + now equals the schedule.
  assert.deepEqual(item.over, [])
  assert.deepEqual(item.repeated, [])

  // A draw nothing is billed in now stays blank.
  assert.deepEqual(
    item.fills.map(({ row, draw, text }) => [row, draw, text]),
    [
      ['previouslyInvoiced', 1, '28,107.36'],
      ['previouslyInvoiced', 2, '13,021.02'],
      ['previouslyInvoiced', 3, '4,340.34'],
      ['thisRequest', 2, '8,059.50'],
      ['thisRequest', 3, '2,686.50'],
    ],
  )
  assert.deepEqual(item.fills[0].rect, summaryRows.previouslyInvoiced[0].rect)
  // Every box of both rows is kept to clear what was typed there, filled or not.
  assert.equal(item.fillBoxes.length, 6)
})

test('with no earlier Package, Previously Invoiced stays blank', () => {
  const t = scheduleWithRows()
  const lines = packageScheduleLines(record(...lotsLines(['23'], 1, 2149.2)))
  const [item] = summarizeSources(matchPackageToSchedules(lines, [t]), [])
  assert.deepEqual(item.fills.map(({ row, draw, text }) => [row, draw, text]), [['thisRequest', 1, '2,149.20']])
})

test('billing a Lot and draw twice, or more than the schedule holds, is reported', () => {
  const t = scheduleWithRows()
  const lines = packageScheduleLines(record(...lotsLines(['23', '24'], 2, 1611.9)))
  const [item] = summarizeSources(
    matchPackageToSchedules(lines, [t]),
    [{ id: 1, number: 'DP-1', plan: matchPackageToSchedules(lines, [t]) }],
  )
  assert.equal(item.repeated.length, 2)
  assert.equal(describeRepeated(item.repeated[0]), 'Lot 23 · draw 2, already in DP-1')

  // Billing the whole draw twice is more than the schedule holds.
  const everyLot = packageScheduleLines(record(
    ...lotsLines(['14', '15', '16', '17', '18', '19', '20', '21', '22'], 2, 1446.78),
    ...lotsLines(['23', '24', '25', '26', '27'], 2, 1611.9),
  ))
  const [over] = summarizeSources(
    matchPackageToSchedules(everyLot, [t]),
    [{ id: 1, number: 'DP-1', plan: matchPackageToSchedules(everyLot, [t]) }],
  )
  assert.deepEqual(over.over.map((row) => row.draw), [2])
  assert.match(describeOver(over.over[0]), /^Draw 2: \$21,080\.52 before \+ \$21,080\.52 now is more than the \$21,080\.52/)
})

test('a differing amount asks for what the Package bills, not what the schedule says', () => {
  const t = scheduleWithRows()
  const lines = packageScheduleLines(record(line('3', '23', 1, 1000)))
  const [item] = summarizeSources(matchPackageToSchedules(lines, [t]), [])
  assert.equal(item.draws[0].request, 1000)
})

test('a schedule without summary rows has nothing to fill', () => {
  const plain = template('plain', [cell('3', '23', 1, 100)])
  const lines = packageScheduleLines(record(line('3', '23', 0, 100)))
  assert.deepEqual(summarizeSources(matchPackageToSchedules(lines, [plain]), []), [])
})

// DP-00000059: three Lots of MODELS, draw 1, with OCIP / WRAP of 0.833% and no
// Retention. The schedule prints the gross price; the Package holds the net.
const withDeductions = (phaseCode, lotNumber, drawIndex, gross, wrap, extra = {}) => line(
  phaseCode,
  lotNumber,
  drawIndex,
  gross,
  {
    grossAmount: gross,
    retentionAmount: 0,
    wrapAmount: wrap,
    netAmount: Math.round((gross - wrap) * 100) / 100,
    ...extra,
  },
)
const dp59 = () => record(
  withDeductions('MODELS', '27', 0, 1286, 10.71),
  withDeductions('MODELS', '28', 0, 1303.75, 10.86),
  withDeductions('MODELS', '29', 0, 871.5, 7.26),
)
const modelsSchedule = () => ({
  ...template('models', [
    cell('MODELS', '27', 1, 1286),
    cell('MODELS', '28', 1, 1303.75),
    cell('MODELS', '29', 1, 871.5),
  ]),
  mapping: {
    version: 1,
    layout: 'matrix',
    cells: [
      cell('MODELS', '27', 1, 1286),
      cell('MODELS', '28', 1, 1303.75),
      cell('MODELS', '29', 1, 871.5),
    ],
    summaryRows: {
      previouslyInvoiced: [{ draw: 1, page: 1, rect }],
      thisRequest: [{ draw: 1, page: 1, rect }],
    },
  },
})

test('This Request is the net of the Package, not the gross of the schedule', () => {
  const plan = matchPackageToSchedules(packageScheduleLines(dp59()), [modelsSchedule()])
  const [item] = summarizeSources(plan, [])

  // 1,275.29 + 1,292.89 + 864.24, not 1,286.00 + 1,303.75 + 871.50 = 3,461.25.
  assert.deepEqual(
    item.fills.map(({ row, draw, text }) => [row, draw, text]),
    [['thisRequest', 1, '3,432.42']],
  )
  assert.equal(item.draws[0].request, 3432.42)
  // The contract is judged on the gross price: nothing here is over.
  assert.equal(item.draws[0].requestGross, 3461.25)
  assert.equal(item.draws[0].over, false)
})

test('the highlighted cells and their amounts still agree with the schedule gross', () => {
  const plan = matchPackageToSchedules(packageScheduleLines(dp59()), [modelsSchedule()])

  assert.equal(plan.matches.length, 3)
  // The schedule prints gross prices, so the Package agrees with them.
  assert.equal(plan.differing.length, 0)
})

test('Previously Invoiced is the net of the earlier Packages', () => {
  const schedules = [modelsSchedule()]
  const earlier = matchPackageToSchedules(
    packageScheduleLines(record(withDeductions('MODELS', '27', 0, 1286, 10.71))),
    schedules,
  )
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(withDeductions('MODELS', '28', 0, 1303.75, 10.86))),
    schedules,
  )
  const [item] = summarizeSources(plan, [{ number: 'DP-1', plan: earlier }])

  assert.deepEqual(
    item.fills.map(({ row, text }) => [row, text]),
    [['previouslyInvoiced', '1,275.29'], ['thisRequest', '1,292.89']],
  )
})

test('Retention comes off the request too, with the OCIP / WRAP', () => {
  // Gross 1,000.00, Retention 5% = 50.00, WRAP 0.833% = 8.33: net 941.67.
  const schedules = [{
    ...modelsSchedule(),
    mapping: { ...modelsSchedule().mapping, cells: [cell('MODELS', '27', 1, 1000)] },
  }]
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('MODELS', '27', 0, 1000, {
      grossAmount: 1000, retentionAmount: 50, wrapAmount: 8.33, netAmount: 941.67,
    }))),
    schedules,
  )
  const [item] = summarizeSources(plan, [])

  assert.deepEqual(item.fills.map(({ text }) => text), ['941.67'])
})

test('only the share of the line that the schedule holds is netted', () => {
  // The line also bills 100.00 of options: gross 1,100.00, WRAP 10% for the example.
  // The schedule holds the 1,000.00 of the draw, so the request is 1,000.00 less its
  // share of the deductions: 900.00 (net 990.00 of 1,100.00 is 90%).
  const schedules = [{
    ...modelsSchedule(),
    mapping: { ...modelsSchedule().mapping, cells: [cell('MODELS', '27', 1, 1000)] },
  }]
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(line('MODELS', '27', 0, 1000, {
      optionsAmount: 100, grossAmount: 1100, retentionAmount: 0, wrapAmount: 110, netAmount: 990,
    }))),
    schedules,
  )
  const [item] = summarizeSources(plan, [])

  assert.deepEqual(item.fills.map(({ text }) => text), ['900.00'])
})

test('a line without amounts of its own is requested whole, as before', () => {
  const [one] = packageScheduleLines(record(line('MODELS', '27', 0, 500)))
  assert.equal(one.netRatio, 1)

  const [noGross] = packageScheduleLines(record(line('MODELS', '27', 0, 500, { grossAmount: 0, netAmount: 0 })))
  assert.equal(noGross.netRatio, 1)
})

test('"more than the schedule holds" is judged on the gross price, and said so', () => {
  const schedules = [{
    ...modelsSchedule(),
    mapping: { ...modelsSchedule().mapping, cells: [cell('MODELS', '27', 1, 1000)] },
  }]
  const earlier = matchPackageToSchedules(
    packageScheduleLines(record(withDeductions('MODELS', '27', 0, 1000, 8.33))),
    schedules,
  )
  const plan = matchPackageToSchedules(
    packageScheduleLines(record(withDeductions('MODELS', '27', 0, 1000, 8.33))),
    schedules,
  )
  const [item] = summarizeSources(plan, [{ number: 'DP-1', plan: earlier }])

  // 1,000 + 1,000 gross is more than the 1,000 contract, even though each net is 991.67.
  assert.equal(item.draws[0].over, true)
  assert.equal(item.draws[0].previously, 991.67)
  assert.match(describeOver(item.draws[0]), /\$1,000\.00 before \+ \$1,000\.00 now is more than the \$1,000\.00/)
})
