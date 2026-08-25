export const MIN_DRAW_COUNT = 3
export const MAX_DRAW_COUNT = 5

export const defaultDraws = [
  { percentage: 0 },
  { percentage: 0 },
  { percentage: 0 },
]

export const initialBuilderDrawSchedules = [
  {
    id: 1,
    builderId: 2,
    draws: [
      { percentage: 15 },
      { percentage: 75 },
      { percentage: 10 },
    ]
  },
  {
    id: 2,
    builderId: 4,
    draws: [
      { percentage: 25 },
      { percentage: 50 },
      { percentage: 25 },
    ],
  },
]
