export const calendarStatusOptions = ['Confirmado', 'En curso', 'Completado', 'Excepción']

export const initialCalendarEvents = [
  {
    id: 'evt-101',
    title: 'EXT • Lotes 9–12',
    start: '2026-08-10T09:00:00',
    end: '2026-08-10T12:00:00',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Confirmado',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 20, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-102',
    title: 'DM • Lote 9',
    start: '2026-08-10T12:30:00',
    end: '2026-08-10T14:00:00',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Completado',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-103',
    title: 'HW • Lotes 10–11',
    start: '2026-08-10T14:30:00',
    end: '2026-08-10T16:00:00',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 55, rate: 875,
      billingReady: false,
    },
  },
  {
    id: 'evt-104',
    title: 'HW • Lotes 10–11',
    start: '2026-08-11T09:00:00',
    end: '2026-08-11T11:00:00',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Completado',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 100, rate: 875,
      billingReady: true,
    },
  },
  {
    id: 'evt-105',
    title: 'WS • Lote 12',
    start: '2026-08-11T12:30:00',
    end: '2026-08-11T14:00:00',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 60, rate: 940,
      billingReady: false,
    },
  },
  {
    id: 'evt-106',
    title: 'QA • Inspección',
    start: '2026-08-11T15:00:00',
    end: '2026-08-11T16:30:00',
    extendedProps: {
      code: 'QA', workType: 'Inspección de calidad', lots: '9–12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Excepción',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 35, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-107',
    title: 'EXT • Lotes 9–12',
    start: '2026-08-12T09:00:00',
    end: '2026-08-12T11:00:00',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 65, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-108',
    title: 'DM • Lote 9',
    start: '2026-08-12T12:30:00',
    end: '2026-08-12T14:00:00',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Completado',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-109',
    title: 'MIS • Inspección',
    start: '2026-08-12T14:30:00',
    end: '2026-08-12T16:00:00',
    extendedProps: {
      code: 'MIS', workType: 'Inspección MEP', lots: '9–12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 45, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-110',
    title: 'HW • Lotes 10–11',
    start: '2026-08-13T09:00:00',
    end: '2026-08-13T11:00:00',
    extendedProps: {
      code: 'HW', workType: 'Hardware', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Completado',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 100, rate: 875,
      billingReady: false,
    },
  },
  {
    id: 'evt-111',
    title: 'CLG • Lote 14',
    start: '2026-08-13T11:15:00',
    end: '2026-08-13T12:30:00',
    extendedProps: {
      code: 'CLG', workType: 'Ceiling grid', lots: '14', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 2', building: 'Edificio 2', status: 'Confirmado',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 2', progress: 10, rate: 1100,
      billingReady: false,
    },
  },
  {
    id: 'evt-112',
    title: 'WS • Lote 12',
    start: '2026-08-13T13:00:00',
    end: '2026-08-13T14:30:00',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 1', progress: 70, rate: 940,
      billingReady: false,
    },
  },
  {
    id: 'evt-113',
    title: 'EXT • Lotes 9–12',
    start: '2026-08-14T09:00:00',
    end: '2026-08-14T11:00:00',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '9, 10, 11, 12', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'En curso',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 1', progress: 80, rate: 2000,
      billingReady: false,
    },
  },
  {
    id: 'evt-114',
    title: 'DM • Lote 9',
    start: '2026-08-14T12:30:00',
    end: '2026-08-14T14:00:00',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '9', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Completado',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 1', progress: 100, rate: 1250,
      billingReady: true,
    },
  },
  {
    id: 'evt-115',
    title: 'QA • Punch list',
    start: '2026-08-14T14:30:00',
    end: '2026-08-14T16:00:00',
    extendedProps: {
      code: 'QA', workType: 'Punch list', lots: '10, 11', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 1', building: 'Edificio 3', status: 'Excepción',
      foreman: 'Carlos Ruiz', crew: 'Quality', plan: 'Plan 1', progress: 25, rate: 0,
      billingReady: false,
    },
  },
  {
    id: 'evt-116',
    title: 'EXT • Lotes 22–24',
    start: '2026-08-17T09:00:00',
    end: '2026-08-17T12:00:00',
    extendedProps: {
      code: 'EXT', workType: 'Exterior', lots: '22, 23, 24', builder: 'Lennar',
      community: 'Solara', phase: 'Fase 2', building: 'Edificio 1', status: 'Confirmado',
      foreman: 'Miguel Santos', crew: 'Crew 04', plan: 'Plan 2', progress: 0, rate: 2100,
      billingReady: false,
    },
  },
  {
    id: 'evt-117',
    title: 'DM • Lote 24',
    start: '2026-08-18T12:30:00',
    end: '2026-08-18T14:30:00',
    extendedProps: {
      code: 'DM', workType: 'Drywall material', lots: '24', builder: 'Lennar',
      community: 'Solara', phase: 'Fase 2', building: 'Edificio 1', status: 'Confirmado',
      foreman: 'Luis Ortega', crew: 'Crew 02', plan: 'Plan 2', progress: 0, rate: 1325,
      billingReady: false,
    },
  },
  {
    id: 'evt-118',
    title: 'WS • Lote 25',
    start: '2026-08-19T09:00:00',
    end: '2026-08-19T11:00:00',
    extendedProps: {
      code: 'WS', workType: 'Window sill', lots: '25', builder: 'KB Home',
      community: 'Andara', phase: 'Fase 2', building: 'Edificio 2', status: 'Confirmado',
      foreman: 'Ana López', crew: 'Crew 07', plan: 'Plan 2', progress: 0, rate: 980,
      billingReady: false,
    },
  },
]

export const emptyCalendarDraft = {
  code: 'EXT', workType: 'Exterior', lots: '', date: '2026-08-10', startTime: '09:00',
  endTime: '11:00', builder: 'KB Home', community: 'Andara', phase: 'Fase 1',
  building: 'Edificio 3', status: 'Confirmado', foreman: 'Miguel Santos',
  crew: 'Crew 04', plan: 'Plan 1', rate: 0,
}

export const calendarStatusTone = {
  Confirmado: 'confirmed',
  'En curso': 'progress',
  Completado: 'completed',
  Excepción: 'exception',
}
