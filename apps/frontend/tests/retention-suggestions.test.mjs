import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addOneMonthClamped,
  buildRetentionSuggestions,
  resolveRetentionCutoffDate,
} from '../src/features/draw-invoice/utils/retentionSuggestions.js'

function schedule(overrides = {}) {
  return {
    id: 501,
    builderId: 7,
    retentionEnabled: true,
    retentionPercentage: 5,
    retentionReleaseScope: 'BUILDING',
    separateHardwarePrice: false,
    frequency: 'MONTHLY',
    anyDate: false,
    cutoffDay: 20,
    cutoffDays: [],
    cutoffWeekday: 1,
    ...overrides,
  }
}

function job() {
  return {
    id: 11,
    code: '1405',
    builderId: 7,
    builder: 'Acme Builder',
    community: 'Stone Creek',
    billingSetupVersionId: 501,
    sequenceSheet: {
      phases: [
        {
          id: 21,
          name: '1',
          building: '1',
          lots: [
            { id: 101, lotNumber: '101' },
            { id: 102, lotNumber: '102' },
            { id: 103, lotNumber: 'UTILITY-1', isUtilityBuilding: true },
          ],
        },
        {
          id: 22,
          name: '2',
          building: '2',
          lots: [{ id: 201, lotNumber: '201' }],
        },
      ],
    },
  }
}

function drawPackage({
  id,
  status,
  packageDate,
  lines,
}) {
  return {
    id,
    packageType: 'DRAW',
    jobId: 11,
    status,
    packageDate,
    persistedDrawLines: lines,
  }
}

function line({
  phaseId = 21,
  lotId,
  drawId,
  eventType = 'HW',
  retentionAmount,
  hardwareAmount = 0,
  hardwareBillingMode = 'FULL',
  hardwareEventType = null,
  hardwarePercentage = 0,
  isUtilityBuilding = false,
}) {
  return {
    phaseId,
    lotId,
    drawId,
    eventType,
    retentionAmount,
    hardwareAmount,
    hardwareBillingMode,
    hardwareEventType,
    hardwarePercentage,
    isUtilityBuilding,
  }
}

test('DRAFT retention is projected, including Utility and Options, but is not releasable', () => {
  const suggestions = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages: [
      drawPackage({
        id: 1,
        status: 'AWAITING_PAYMENT',
        packageDate: '2026-09-15',
        lines: [
          // The retention snapshot includes base Draw plus Options.
          line({ lotId: 101, drawId: 1, retentionAmount: 55 }),
          // Utility contributes retention but never satisfies the Hardware gate.
          line({
            lotId: 103,
            drawId: 2,
            eventType: 'EXT',
            retentionAmount: 20,
            isUtilityBuilding: true,
          }),
        ],
      }),
      drawPackage({
        id: 2,
        status: 'DRAFT',
        packageDate: '2026-09-16',
        lines: [line({ lotId: 102, drawId: 3, retentionAmount: 30 })],
      }),
    ],
    asOfDate: '2026-10-20',
  })

  const buildingOne = suggestions.find(({ phaseId }) => phaseId === 21)
  assert.equal(buildingOne.projectedRetention, 105)
  assert.equal(buildingOne.releasableRetention, 75)
  assert.equal(buildingOne.draftRetention, 30)
  assert.equal(buildingOne.remainingHardwareLots, 1)
  assert.equal(buildingOne.projectedRemainingHardwareLots, 0)
  assert.equal(buildingOne.status, 'PROJECTED')
})

test('a Job whose Packages are all Drafts has no suggestion until one is Awaiting payment', () => {
  const draftsOnly = [
    drawPackage({
      id: 1,
      status: 'DRAFT',
      packageDate: '2026-09-15',
      lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
    }),
    drawPackage({
      id: 2,
      status: 'DRAFT',
      packageDate: '2026-09-16',
      lines: [line({ lotId: 102, drawId: 2, retentionAmount: 30 })],
    }),
  ]
  const suggestionsFor = (packages) => buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages,
    asOfDate: '2026-10-20',
  })

  assert.deepEqual(suggestionsFor(draftsOnly), [])

  // Once one of them is Awaiting payment the Job shows, and the other is still projected.
  const [first, second] = draftsOnly
  const shown = suggestionsFor([{ ...first, status: 'AWAITING_PAYMENT' }, second])
    .find(({ phaseId }) => phaseId === 21)
  assert.equal(shown.releasableRetention, 55)
  assert.equal(shown.draftRetention, 30)
  assert.equal(shown.status, 'PROJECTED')
})

test('Per Building becomes ready one clamped calendar month after final Hardware cutoff', () => {
  const packages = [
    drawPackage({
      id: 1,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-09-15',
      lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
    }),
    drawPackage({
      id: 2,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-09-16',
      lines: [line({ lotId: 102, drawId: 2, retentionAmount: 30 })],
    }),
  ]
  const before = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages,
    asOfDate: '2026-10-19',
  }).find(({ phaseId }) => phaseId === 21)
  const ready = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages,
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)

  assert.equal(before.sourceCutoffDate, '2026-09-20')
  assert.equal(before.availableDate, '2026-10-20')
  assert.equal(before.status, 'WAITING_FOR_DATE')
  assert.equal(ready.status, 'READY')
  assert.equal(ready.releasableRetention, 85)
})

test('retention waiting for its date can be reviewed but not created', () => {
  const packages = [
    drawPackage({
      id: 1,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-09-15',
      lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
    }),
    drawPackage({
      id: 2,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-09-16',
      lines: [line({ lotId: 102, drawId: 2, retentionAmount: 30 })],
    }),
  ]
  const suggestion = (asOfDate, sourcePackages = packages) => buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages: sourcePackages,
    asOfDate,
  }).find(({ phaseId }) => phaseId === 21)

  // The day after the cutoff, and even the day before the month is up: reviewable, not creatable.
  for (const asOfDate of ['2026-09-21', '2026-10-19']) {
    const waiting = suggestion(asOfDate)
    assert.equal(waiting.status, 'WAITING_FOR_DATE')
    assert.equal(waiting.isReady, false)
    assert.equal(waiting.canReview, true)
    assert.equal(waiting.availableDate, '2026-10-20')
    assert.equal(waiting.releasableRetention, 85)
  }

  const ready = suggestion('2026-10-20')
  assert.equal(ready.isReady, true)
  assert.equal(ready.canReview, true)

  // Hardware still missing: nothing to review yet, whatever the date.
  const noHardware = suggestion('2026-12-01', [packages[0]])
  assert.equal(noHardware.status, 'WAITING_FOR_HARDWARE')
  assert.equal(noHardware.isReady, false)
  assert.equal(noHardware.canReview, false)
})

test('Per Job waits for every Building and excludes amounts allocated to an active release', () => {
  const setup = schedule({ retentionReleaseScope: 'JOB' })
  const sourcePackages = [
    drawPackage({
      id: 1,
      status: 'PAID_CLOSED',
      packageDate: '2026-08-15',
      lines: [
        line({ lotId: 101, drawId: 1, retentionAmount: 40 }),
        line({ lotId: 102, drawId: 2, retentionAmount: 30 }),
      ],
    }),
    drawPackage({
      id: 2,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-08-18',
      lines: [line({ phaseId: 22, lotId: 201, drawId: 3, retentionAmount: 25 })],
    }),
  ]
  const release = {
    id: 90,
    packageType: 'RETENTION_RELEASE',
    jobId: 11,
    status: 'DRAFT',
    retentionRelease: {
      sourceLines: [{
        sourcePackageId: 1,
        sourceLotId: 101,
        sourceDrawId: 1,
        retentionAmount: 40,
      }],
    },
  }

  const active = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [setup],
    packages: [...sourcePackages, release],
    asOfDate: '2026-10-01',
  })[0]
  const cancelled = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [setup],
    packages: [...sourcePackages, { ...release, status: 'CANCELLED' }],
    asOfDate: '2026-10-01',
  })[0]

  assert.equal(active.scopeType, 'JOB')
  assert.equal(active.remainingHardwareLots, 0)
  assert.equal(active.releasableRetention, 55)
  assert.equal(cancelled.releasableRetention, 95)
})

test('Separate Hardware waits until every configured Event Type portion is billed', () => {
  const setup = schedule({
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 25, DM: 25, HW: 50 },
  })
  const packages = [drawPackage({
    id: 1,
    status: 'AWAITING_PAYMENT',
    packageDate: '2026-09-15',
    lines: [
      line({
        lotId: 101,
        drawId: 1,
        eventType: 'EXT',
        retentionAmount: 10,
        hardwareAmount: 250,
        hardwareBillingMode: 'BY_EVENT',
        hardwareEventType: 'EXT',
        hardwarePercentage: 25,
      }),
      line({
        lotId: 101,
        drawId: 2,
        eventType: 'DM',
        retentionAmount: 10,
        hardwareAmount: 250,
        hardwareBillingMode: 'BY_EVENT',
        hardwareEventType: 'DM',
        hardwarePercentage: 25,
      }),
      line({
        lotId: 102,
        drawId: 3,
        eventType: 'EXT',
        retentionAmount: 10,
        hardwareAmount: 250,
        hardwareBillingMode: 'BY_EVENT',
        hardwareEventType: 'EXT',
        hardwarePercentage: 25,
      }),
    ],
  })]

  const suggestion = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [setup],
    packages,
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)

  assert.equal(suggestion.completedHardwareLots, 0)
  assert.equal(suggestion.remainingHardwareLots, 2)
})

test('independent Calendar Hardware lines complete retention and are released once', () => {
  const setup = schedule({
    separateHardwarePrice: true,
    hardwareBillingMode: 'BY_EVENT',
    hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
  })
  const packages = [
    {
      ...drawPackage({
        id: 1,
        status: 'AWAITING_PAYMENT',
        packageDate: '2026-09-15',
        lines: [line({ lotId: 101, drawId: 1, eventType: 'EXT', retentionAmount: 40 })],
      }),
      persistedHardwareLines: [{
        id: 801,
        phaseId: 21,
        lotId: 101,
        hardwareEventType: 'HW',
        hardwarePercentage: 100,
        hardwareAmount: 600,
        retentionAmount: 30,
      }],
    },
    {
      ...drawPackage({
        id: 2,
        status: 'PAID_CLOSED',
        packageDate: '2026-09-16',
        lines: [line({ lotId: 102, drawId: 2, eventType: 'DM', retentionAmount: 25 })],
      }),
      persistedHardwareLines: [{
        id: 802,
        phaseId: 21,
        lotId: 102,
        hardwareEventType: 'HW',
        hardwarePercentage: 100,
        hardwareAmount: 500,
        retentionAmount: 25,
      }],
    },
  ]

  const ready = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [setup],
    packages,
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)
  const released = buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [setup],
    packages: [...packages, {
      id: 90,
      packageType: 'RETENTION_RELEASE',
      jobId: 11,
      status: 'DRAFT',
      retentionRelease: {
        sourceLines: [],
        sourceHardwareLines: [{ sourceHardwareLineId: 801 }],
      },
    }],
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)

  assert.equal(ready.status, 'READY')
  assert.equal(ready.completedHardwareLots, 2)
  assert.equal(ready.releasableRetention, 120)
  assert.equal(released.releasableRetention, 90)
})

test('cutoff and release dates clamp short months', () => {
  assert.equal(
    resolveRetentionCutoffDate('2027-02-15', schedule({ cutoffDay: 31 })),
    '2027-02-28',
  )
  assert.equal(addOneMonthClamped('2027-01-31'), '2027-02-28')
})

function adjustment({ id, status, lines }) {
  return {
    id,
    packageType: 'PRICE_ADJUSTMENT',
    jobId: 11,
    status,
    packageDate: '2026-10-01',
    priceAdjustment: { lines },
  }
}

function releasePackage({ id, adjustmentLineIds }) {
  return {
    id,
    packageType: 'RETENTION_RELEASE',
    jobId: 11,
    status: 'DRAFT',
    retentionRelease: {
      sourceLines: [],
      sourceHardwareLines: [],
      sourceAdjustmentLines: adjustmentLineIds.map((sourceAdjustmentLineId) => ({
        sourceAdjustmentLineId,
      })),
    },
  }
}

const hardwareReadyPackages = () => [
  drawPackage({
    id: 1,
    status: 'AWAITING_PAYMENT',
    packageDate: '2026-09-15',
    lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
  }),
  drawPackage({
    id: 2,
    status: 'AWAITING_PAYMENT',
    packageDate: '2026-09-16',
    lines: [line({ lotId: 102, drawId: 2, retentionAmount: 30 })],
  }),
]

function suggestionFor(packages) {
  return buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages,
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)
}

test('what Price Adjustments retained is released with the rest, credits taking away', () => {
  const base = suggestionFor(hardwareReadyPackages())
  assert.equal(base.releasableRetention, 85)

  const withAdjustment = suggestionFor([
    ...hardwareReadyPackages(),
    adjustment({
      id: 301,
      status: 'AWAITING_PAYMENT',
      lines: [
        { id: 1, phaseId: 21, retention: 40 },
        // A credit: the Builder retained too much on this one.
        { id: 2, phaseId: 21, retention: -5 },
        // Another Building: not part of this scope.
        { id: 3, phaseId: 22, retention: 99 },
      ],
    }),
  ])

  assert.equal(withAdjustment.releasableRetention, 120)
  assert.equal(withAdjustment.projectedRetention, 120)
  assert.equal(withAdjustment.status, 'READY')
})

test('an adjustment still in Draft is projected, never releasable', () => {
  const suggestion = suggestionFor([
    ...hardwareReadyPackages(),
    adjustment({ id: 301, status: 'DRAFT', lines: [{ id: 1, phaseId: 21, retention: 40 }] }),
  ])

  assert.equal(suggestion.releasableRetention, 85)
  assert.equal(suggestion.projectedRetention, 125)
  assert.equal(suggestion.draftRetention, 40)
})

test('a cancelled adjustment, and lines a release already holds, are not counted again', () => {
  const adjusted = adjustment({
    id: 301,
    status: 'AWAITING_PAYMENT',
    lines: [{ id: 1, phaseId: 21, retention: 40 }, { id: 2, phaseId: 21, retention: 10 }],
  })

  assert.equal(
    suggestionFor([...hardwareReadyPackages(), { ...adjusted, status: 'CANCELLED' }]).releasableRetention,
    85,
  )
  assert.equal(
    suggestionFor([...hardwareReadyPackages(), adjusted, releasePackage({ id: 400, adjustmentLineIds: [1] })])
      .releasableRetention,
    95,
  )
})

test('adjustments never satisfy the Hardware gate', () => {
  const suggestion = suggestionFor([
    drawPackage({
      id: 1,
      status: 'AWAITING_PAYMENT',
      packageDate: '2026-09-15',
      lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
    }),
    adjustment({ id: 301, status: 'AWAITING_PAYMENT', lines: [{ id: 1, phaseId: 21, retention: 40 }] }),
  ])

  assert.equal(suggestion.remainingHardwareLots, 1)
  assert.equal(suggestion.status, 'WAITING_FOR_HARDWARE')
})

test('the retention of Options billed on their own is projected, and not counted again once released', () => {
  const optionsPackage = (status) => ({
    id: 30,
    packageType: 'OPTIONS',
    jobId: 11,
    status,
    packageDate: '2026-09-20',
    persistedOptionLines: [
      { phaseId: 21, lotId: 101, optionId: 7, retentionAmount: 12.5 },
      { phaseId: 22, lotId: 201, optionId: 8, retentionAmount: 9 },
      { phaseId: 21, lotId: 102, optionId: 9, retentionAmount: 0 },
    ],
  })
  const source = drawPackage({
    id: 1,
    status: 'AWAITING_PAYMENT',
    packageDate: '2026-09-15',
    lines: [line({ lotId: 101, drawId: 1, retentionAmount: 55 })],
  })
  const suggest = (packages) => buildRetentionSuggestions({
    jobs: [job()],
    jobBillingSetupVersions: [schedule()],
    packages,
    asOfDate: '2026-10-20',
  }).find(({ phaseId }) => phaseId === 21)

  const projected = suggest([source, optionsPackage('AWAITING_PAYMENT')])
  assert.equal(projected.projectedRetention, 67.5, 'Building 1 only counts the Options of its own Lots')
  assert.equal(projected.releasableRetention, 67.5)

  const drafted = suggest([source, optionsPackage('DRAFT')])
  assert.equal(drafted.releasableRetention, 55)
  assert.equal(drafted.draftRetention, 12.5)

  const released = suggest([
    source,
    optionsPackage('AWAITING_PAYMENT'),
    {
      id: 90,
      packageType: 'RETENTION_RELEASE',
      jobId: 11,
      status: 'DRAFT',
      retentionRelease: { sourceOptionLines: [{ sourcePackageId: 30, sourceLotId: 101, sourceOptionId: 7 }] },
    },
  ])
  assert.equal(released.projectedRetention, 55, 'what a Retention Release already takes is not counted again')

  assert.equal(suggest([source, optionsPackage('CANCELLED')]).projectedRetention, 55)
})

