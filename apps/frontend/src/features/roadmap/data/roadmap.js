// The project roadmap shown to the client for review. Edit this file to update
// the Roadmap page: every item needs a title, a description and one of the
// statuses below.

export const roadmapUpdatedOn = 'November 23, 2026'

export const roadmapStatuses = {
  DONE: { label: 'Done', color: 'success' },
  NEXT: { label: 'Next', color: 'info' },
  PLANNED: { label: 'Planned', color: 'default' },
  INPUT: { label: 'Needs your input', color: 'warning' },
}

export const roadmapAreas = [
  {
    title: 'Operations',
    description: 'Jobs, Sequence Sheets and the production Calendar.',
    items: [
      {
        title: 'Jobs',
        status: 'DONE',
        description:
          'Each Job with its Builder, community, coordinates and team: Supervisor, Jobsite Superintendent, Project Manager and the Builder contacts.',
      },
      {
        title: 'Plans & Options',
        status: 'DONE',
        description:
          'The Plans and Options of each Job with their prices, edited in one grid, with notes that show who wrote them and when.',
      },
      {
        title: 'Sequence Sheets',
        status: 'DONE',
        description:
          'Phases with their Lots, Plans and Options. They are emailed to the Builder coordinators, and option changes can be emailed to Purchasing.',
      },
      {
        title: 'Production Calendar',
        status: 'DONE',
        description:
          'Schedule the work of each Phase, drag to reschedule, filter by Builder, community and Job, and send DM reminder emails.',
      },
      {
        title: 'Builder follow-ups',
        status: 'DONE',
        description:
          'Follow-up emails to the Builder with a response page that reschedules the work, plus Google Calendar sync.',
      },
      {
        title: 'Purchase Orders',
        status: 'DONE',
        description:
          'Purchase Order PDFs are read and compared with the options of the Job. Missing options and their suggested prices can be added from there.',
      },
      {
        title: 'Field Completion',
        status: 'INPUT',
        description:
          'Do crews need their own screen to mark work as completed in the field, or is the Calendar enough?',
      },
    ],
  },
  {
    title: 'Customer Service',
    description: 'Service requests from homeowners, from the first email to the visit.',
    items: [
      {
        title: 'Service requests',
        status: 'DONE',
        description:
          'Requests are captured, reviewed and marked ready to propose. Every change is kept in the history.',
      },
      {
        title: 'Email intake from Outlook',
        status: 'DONE',
        description:
          'Emails that reach the service mailbox become requests for review. AI reads the email, its PDF and its photos to fill the form, and a person always approves it.',
      },
      {
        title: 'Appointments by technician',
        status: 'DONE',
        description:
          'Accepted visits are saved per technician in 2-hour windows (8–10, 10–12 and 12–2). Several visits can share a window when the work, 10 minutes of pickup and the drive fit.',
      },
      {
        title: 'Automatic visit status',
        status: 'DONE',
        description:
          'A visit shows In progress when its window starts and Completed when the window ends.',
      },
      {
        title: 'Drive times with traffic',
        status: 'DONE',
        description:
          'Drive times come from Google Maps for the real departure time, using the heavy-traffic estimate. The coordinator can still type a time by hand.',
      },
      {
        title: 'Nearby visits and suggested times',
        status: 'DONE',
        description:
          'The planner lists the visits near a new request with their driving miles, and suggests times next to them in 5-minute steps.',
      },
      {
        title: 'Final-days rule',
        status: 'DONE',
        description:
          'When no nearby visit fits, the request is suggested on its due date first and then one business day earlier at a time, so visits are grouped on one route day.',
      },
      {
        title: 'Day-before traffic check',
        status: 'DONE',
        description:
          'The afternoon before, the drives are checked again with traffic. The screen warns when a visit would no longer fit inside its customer window or when a time typed by hand is shorter than Google’s.',
      },
      {
        title: 'Visit details while planning',
        status: 'DONE',
        description:
          'While planning a request, selecting a visit in the technician’s day agenda opens that visit’s request: homeowner, lot, work type, customer window, work time and technician. It is read-only, so nothing is cancelled by mistake.',
      },
      {
        title: 'Recommended slot',
        status: 'DONE',
        description:
          'Each request opens with one recommended slot and the reason for it in plain words. Using it fills the form and calculates the drive times. The homeowner’s phone, clearer messages and a folded list of nearby visits are on the same screen.',
      },
      {
        title: 'Suggestions that can be kept',
        status: 'DONE',
        description:
          'Suggestions start two business days ahead so the homeowner can answer, or on the due date when it is sooner, marked as short notice. The heavy-traffic drive and 10 minutes of pickup are the only buffer. On days without nearby visits, Jorge is suggested first.',
      },
      {
        title: 'Send to the homeowner',
        status: 'DONE',
        description:
          'From the planner the coordinator either books a visit the homeowner already accepted by phone, or emails a proposal with one or two days from their own mailbox. Every email follows the team’s design.',
      },
      {
        title: 'Sent proposals hold their time',
        status: 'DONE',
        description:
          'A proposal sent to a homeowner reserves its days for the technicians, so the same time is not offered twice. The days are listed by date, the earliest first.',
      },
      {
        title: 'Homeowner response',
        status: 'DONE',
        description:
          'Buttons in the email open a page where the homeowner confirms a day, and the visit is booked at once; picks one of up to three other open days for the coordinator to approve; or asks for a call, with the best time and phone. Answers by email or phone are recorded on screen.',
      },
      {
        title: 'Homeowner does not answer',
        status: 'DONE',
        description:
          'After 24 hours the homeowner gets one reminder, sent from 8 AM to 6 PM. After 48 hours the coordinator is emailed to call the Builder’s superintendent. If every offered day passes, the coordinator is told to plan a new day.',
      },
      {
        title: 'Confirmation and visit reminder',
        status: 'DONE',
        description:
          'The confirmation includes a calendar file the homeowner can add with one click, and the business day before the visit, from 3 PM, the homeowner gets a reminder.',
      },
      {
        title: 'Coordinator alerts',
        status: 'DONE',
        description:
          'The coordinator is emailed only when they need to act: the homeowner picked another day or asked for a call, 48 hours passed, or the offered days passed. The request list shows the same labels.',
      },
      {
        title: 'Reschedule a confirmed visit',
        status: 'PLANNED',
        description:
          'Confirmed visits and sent proposals are not cancelled. Moving a confirmed visit, with a notice to the homeowner, will be its own step; until then the coordinator calls the homeowner.',
      },
      {
        title: 'Live emails to homeowners',
        status: 'NEXT',
        description:
          'Today every homeowner email goes to a test inbox. Sending them to real homeowners needs the app’s public address for the email buttons and your approval.',
      },
      {
        title: 'Several requests from one Job in one email',
        status: 'INPUT',
        description:
          'Our proposal: group them into one visit after the coordinator confirms it. Is that right?',
      },
      {
        title: 'Homeowner notes in suggestions',
        status: 'PLANNED',
        description: 'Use notes such as “afternoons only” when suggesting times.',
      },
    ],
  },
  {
    title: 'Billing',
    description: 'Draws, Packages, Releases and QuickBooks.',
    items: [
      {
        title: 'Builder Setup',
        status: 'DONE',
        description:
          'The draws, cutoff and submission days, payment terms, retention, OCIP / WRAP and required documents of each Builder, kept in versions.',
      },
      {
        title: 'Plan Pricing and price changes',
        status: 'DONE',
        description:
          'Prices per Phase, moving a Phase to today’s price, and Price Adjustment Packages for the difference.',
      },
      {
        title: 'Draw & Invoice Packages',
        status: 'DONE',
        description:
          'Package Suggestions by cutoff, Packages per Phase or Building, partial payments and internal notes. Options and Hardware are billed with their Draw.',
      },
      {
        title: 'QuickBooks invoices',
        status: 'DONE',
        description:
          'Each Package creates, updates or voids its QuickBooks invoice with a serial number, and payments come back from QuickBooks. Test and Production modes.',
      },
      {
        title: 'Releases',
        status: 'DONE',
        description:
          'The Release templates of each Builder are read once and filled for every Package, with the Exceptions lines for unpaid earlier Packages, plus the Retention Release.',
      },
      {
        title: 'Payment Schedules',
        status: 'DONE',
        description: 'The Payment Schedule of a Job is read, and a new one is generated for each Package.',
      },
      {
        title: 'Preliminary Notice',
        status: 'DONE',
        description:
          'The California Preliminary Notice is filled from the app and is required before creating Packages.',
      },
      {
        title: 'Accounts receivable',
        status: 'DONE',
        description: 'Open invoices aged by due date, by invoice, Job or Builder, including partly paid ones.',
      },
      {
        title: 'Extra / Change Orders',
        status: 'DONE',
        description:
          'Created and moved through their statuses, with a Calendar event per Lot, and invoiced in QuickBooks.',
      },
      {
        title: 'Release - Builder Portal',
        status: 'PLANNED',
        description:
          'Track the Releases submitted through Builder portals such as Supply Pro and Textura. Scope to be defined with you.',
      },
      {
        title: 'Real billing setup for Pulte Homes, Toll Brothers and Hill View Homes',
        status: 'INPUT',
        description:
          'They use a temporary setup (2 draws of 50%, cutoff on day 20). Please send their real draws, cutoff and payment terms.',
      },
      {
        title: 'Real Supervisors and Jobsite Superintendents',
        status: 'INPUT',
        description: 'Jobs use test people for now. Please send the real names and emails.',
      },
    ],
  },
  {
    title: 'Pricing and reports',
    description: 'Proposals to Builders and what the team sees at a glance.',
    items: [
      {
        title: 'Home: Needs action',
        status: 'DONE',
        description: 'The Home page shows what is waiting on the Calendar and on Draw & Invoice.',
      },
      {
        title: 'Proposals',
        status: 'PLANNED',
        description: 'Price proposals for Builders. Scope to be defined with you.',
      },
      {
        title: 'Reports',
        status: 'INPUT',
        description: 'Which reports do you need first?',
      },
    ],
  },
  {
    title: 'Administration and integrations',
    description: 'Users, contacts, history and connections with other systems.',
    items: [
      {
        title: 'Users and roles',
        status: 'DONE',
        description: 'Users are invited by email, and each role opens only its own area of the app.',
      },
      {
        title: 'Contacts',
        status: 'DONE',
        description:
          'Company Contacts and Builder Contacts: Estimator, Job Coordinator, Purchasing, Scheduling and Options Coordinator.',
      },
      {
        title: 'Activity History',
        status: 'DONE',
        description: 'A log of important changes: who did what and when.',
      },
      {
        title: 'Hyphen SPConnect',
        status: 'PLANNED',
        description:
          'Receive Builder purchase orders and change orders automatically. Waiting on a meeting with Hyphen.',
      },
      {
        title: 'Builder Types',
        status: 'PLANNED',
        description: 'Single Family and Multi Family. Scope to be defined with you.',
      },
      {
        title: 'Configuration',
        status: 'PLANNED',
        description: 'One place for the settings of the whole app.',
      },
    ],
  },
]
