const sequencePlans = [
  {
    id: 1101,
    code: '1',
    name: 'Plan 1',
    price: 5912,
    options: [
      {
        id: 110101,
        code: '1-OPT',
        description: '1 - Door at Primary Bath',
        price: null,
      },
    ],
  },
  {
    id: 1102,
    code: '2',
    name: 'Plan 2',
    price: 7360,
    options: [
      { id: 110201, code: '2-OPT', description: '2 - Door at Primary Bath', price: null },
      { id: 110202, code: '2-OPT', description: '2 - FLEX ROOM', price: null },
      { id: 110203, code: '2-ADA', description: 'UNIT 2X ADA', price: null },
      { id: 110204, code: '2-ADA-OPT', description: '2 - Door at Primary Bath', price: null },
      { id: 110205, code: '2-ADA-OPT', description: '2X - FLEX ROOM', price: null },
    ],
  },
  {
    id: 1103,
    code: '3',
    name: 'Plan 3',
    price: 6785,
    options: [
      { id: 110301, code: '3-OPT', description: '3 - Door at Primary Bath', price: null },
      { id: 110302, code: '3-OPT', description: 'No MDF Shelf laundry', price: null },
      { id: 110303, code: '3-W/UTI', description: '3 - W/UTI', price: null },
      { id: 110304, code: '3-W/UTI-OPT', description: '3 - Door at Primary Bath', price: null },
      { id: 110305, code: '3-W/UTI-OPT', description: 'No MDF Shelf laundry', price: null },
    ],
  },
  {
    id: 1104,
    code: '2Y',
    name: 'Plan 2Y',
    price: 7360,
    options: [],
  },
]

export const testJobs = [
  {
    id: 1,
    builderId: 2,
    code: '1307',
    builder: 'Trumark Homes',
    community: 'Andara',
    supervisorId: 1,
    superintendentId: 1,
    sequenceSheet: {
      id: 1001,
      name: 'Options Sequence Sheet',
      plans: sequencePlans,
      phases: [
        {
          id: 2102,
          name: '2',
          building: '15',
          createdAt: '2026-08-26',
          lots: [
            { id: 3201, lotNumber: '66', planId: 1103, reverse: false, optionIds: [] },
            { id: 3202, lotNumber: '67', planId: 1101, reverse: false, optionIds: [] },
            { id: 3203, lotNumber: '68', planId: 1102, reverse: false, optionIds: [] },
            { id: 3204, lotNumber: '69', planId: 1102, reverse: false, optionIds: [] },
            { id: 3205, lotNumber: '70', planId: 1104, reverse: false, optionIds: [] },
          ],
        },
        {
          id: 2101,
          name: '3',
          building: '5',
          createdAt: '2026-08-18',
          lots: [
            {
              id: 3101,
              lotNumber: '18',
              planId: 1103,
              reverse: false,
              optionIds: [110301, 110302],
            },
            {
              id: 3102,
              lotNumber: '19',
              planId: 1101,
              reverse: false,
              optionIds: [110101],
            },
            {
              id: 3103,
              lotNumber: '20',
              planId: 1102,
              reverse: false,
              optionIds: [110201, 110202],
            },
            {
              id: 3104,
              lotNumber: '21',
              planId: 1101,
              reverse: false,
              optionIds: [110101],
            },
            {
              id: 3105,
              lotNumber: '22',
              planId: 1103,
              reverse: false,
              optionIds: [110301],
            },
          ],
        },
      ],
    },
  },
]
