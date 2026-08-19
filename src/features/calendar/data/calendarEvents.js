export const calendarStatusOptions = ['Confirmed', 'In progress', 'Completed', 'Exception']

export const initialCalendarEvents = [
  {
    id: 'evt-101',
    title: 'EXT • Lots 9–12',
    start: '2026-08-10',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Confirmed',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 20, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-102',
    title: 'DM • Lot 9',
    start: '2026-08-10',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Completed',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-103',
    title: 'HW • Lots 10–11',
    start: '2026-08-10',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 55, rate: 875,
      billingReady: false,
    },
  },
  {
    id: 'evt-104',
    title: 'HW • Lots 10–11',
    start: '2026-08-11',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Completed',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 100, rate: 875,
      billingReady: true,
    },
  },
  {
    id: 'evt-105',
    title: 'WS • Lot 12',
    start: '2026-08-11',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 60, rate: 940,
      billingReady: false,
    },
  },
  {
    id: 'evt-106',
    title: 'QA • Inspection',
    start: '2026-08-11',
    extendedProps: {
      code: 'QA', workType: 'Quality inspection', lots: '9–12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Exception',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 35, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-107',
    title: 'EXT • Lots 9–12',
    start: '2026-08-12',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 65, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-108',
    title: 'DM • Lot 9',
    start: '2026-08-12',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Completed',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-109',
    title: 'MIS • Inspection',
    start: '2026-08-12',
    extendedProps: {
      code: 'MIS', workType: 'MEP inspection', lots: '9–12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 45, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-110',
    title: 'HW • Lots 10–11',
    start: '2026-08-13',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Completed',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 100, rate: 875,
      billingReady: false,
    },
  },
  {
    id: 'evt-111',
    title: 'CLG • Lot 14',
    start: '2026-08-13',
    extendedProps: {
      code: 'CLG', workType: 'Ceiling grid', lots: '14', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 2', building: 'Building 2', status: 'Confirmed',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 2', progress: 10, rate: 1100,
      billingReady: false,
    },
  },
  {
    id: 'evt-112',
    title: 'WS • Lot 12',
    start: '2026-08-13',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 70, rate: 940,
      billingReady: false,
    },
  },
  {
    id: 'evt-113',
    title: 'EXT • Lots 9–12',
    start: '2026-08-14',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'In progress',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 80, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-114',
    title: 'DM • Lot 9',
    start: '2026-08-14',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Completed',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-115',
    title: 'QA • Punch list',
    start: '2026-08-14',
    extendedProps: {
      code: 'QA', workType: 'Punch list', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 1', building: 'Building 3', status: 'Exception',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 25, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-116',
    title: 'EXT • Lots 22–24',
    start: '2026-08-17',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '22, 23, 24', builder: 'Lennar',
      community: 'Solara', phase: 'Phase 2', building: 'Building 1', status: 'Confirmed',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 2', progress: 0, rate: 2100,
      billingReady: false,
    },
  },
  {
    id: 'evt-117',
    title: 'DM • Lot 24',
    start: '2026-08-18',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '24', builder: 'Lennar',
      community: 'Solara', phase: 'Phase 2', building: 'Building 1', status: 'Confirmed',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 2', progress: 0, rate: 1325,
      billingReady: false,
    },
  },
  {
    id: 'evt-118',
    title: 'WS • Lot 25',
    start: '2026-08-19',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '25', builder: 'KB Home',
      community: 'Andara', phase: 'Phase 2', building: 'Building 2', status: 'Confirmed',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 2', progress: 0, rate: 980,
      billingReady: false,
    },
  },
]

export const emptyCalendarDraft = {
  code: 'EXT', workType: 'Exterior', lots: '', date: '2026-08-10',
  builder: 'KB Home', community: 'Andara', phase: 'Phase 1',
  building: 'Building 3', status: 'Confirmed', foreman: 'Miguel Santos',
  crew: 'Crew 04', plan: 'Plan 1', rate: 0,
}

export const calendarStatusTone = {
  Confirmed: 'confirmed',
  'In progress': 'progress',
  Completed: 'completed',
  Exception: 'exception',
}
