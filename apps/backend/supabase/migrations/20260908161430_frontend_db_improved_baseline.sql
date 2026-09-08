-- ValtrimBilling - esquema compacto mejorado.
-- PostgreSQL / Supabase. Ejecutar una sola vez en una base nueva.
--
-- Esta migracion NO crea autenticacion, perfiles, grants para el cliente ni RLS.
-- Las columnas *_by son UUID sin FK para que la migracion de Auth pueda
-- enlazarlas posteriormente con la tabla de perfiles elegida por el equipo.
-- El esquema valtrim permanece cerrado a PUBLIC hasta que se aplique la
-- migracion final de Auth + grants + RLS.

begin;

create schema valtrim;
set local search_path = valtrim, pg_catalog;

create domain email_address as varchar(160)
  check (
    value = lower(btrim(value))
    and value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  );

create domain phone_number as varchar(16)
  check (value ~ '^([+]1[0-9]{10}|[+]52[0-9]{10})$');

create domain amount as numeric(14,2)
  check (value between 0 and 999999999999.99);

create domain percentage as numeric(5,2)
  check (value between 0 and 100);

create type contact_type as enum (
  'JOBSITE_SUPERINTENDENT',
  'AP_CONTACT'
);

create type person_role as enum (
  'SUPERVISOR',
  'FOREMAN',
  'SERVICE_TECHNICIAN'
);

create type setup_version_status as enum (
  'DRAFT',
  'ACTIVE',
  'SUPERSEDED'
);

create type billing_frequency as enum (
  'MONTHLY',
  'SEMIMONTHLY',
  'WEEKLY'
);

create type work_accepted_through as enum ('CUTOFF', 'SUBMISSION');
create type invoice_date_rule as enum ('SUBMISSION', 'CUTOFF', 'MONTH_END');
create type invoice_line_format as enum ('LOT_SCOPE', 'LOT', 'SCOPE', 'SINGLE');

create type billing_document_type as enum (
  'INVOICE',
  'PURCHASE_ORDER',
  'PAYMENT_SCHEDULE',
  'RELEASE',
  'BACKUP',
  'CUSTOM'
);

create type document_status as enum (
  'MISSING',
  'PENDING',
  'COMPLETE',
  'WAIVED'
);

create type package_status as enum (
  'DRAFT',
  'READY',
  'INVOICED',
  'SUBMITTED',
  'PAID',
  'VOIDED'
);

create type quickbooks_status as enum (
  'NOT_CREATED',
  'CREATED',
  'SYNC_ERROR',
  'VOIDED'
);

create type submission_status as enum (
  'NOT_SUBMITTED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED'
);

create type invoice_status as enum (
  'DRAFT',
  'ISSUED',
  'SUBMITTED',
  'PARTIALLY_PAID',
  'PAID',
  'VOIDED'
);

create type payment_status as enum ('PENDING', 'CLEARED', 'VOIDED');

create type date_owner as enum (
  'SUPERVISOR',
  'JOBSITE_SUPERINTENDENT',
  'TENTATIVE'
);

create type production_stage_type as enum ('EXT', 'SHUTTER', 'DM', 'HW');
create type production_schedule_variant as enum (
  'BASE',
  'DIVISION',
  'INSTALL_ONLY',
  'LOCK_UP'
);

create type production_activity_status as enum (
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

create type service_status as enum (
  'NEW',
  'CONTACT_NEEDED',
  'CONFIRMED',
  'EN_ROUTE',
  'AWAITING_PARTS',
  'COMPLETED',
  'OVERDUE',
  'CLOSED'
);

create type service_tag as enum (
  'NEW',
  'FOLLOW_UP',
  'PARTS_NEEDED',
  'COMPLETED',
  'OVERDUE'
);

create type service_request_type as enum (
  'WARRANTY',
  'PUNCH_LIST',
  'SERVICE_CALL',
  'COMPLAINT'
);

create type service_priority as enum ('LOW', 'MEDIUM', 'HIGH');

create type service_appointment_state as enum (
  'NOT_SCHEDULED',
  'SCHEDULED',
  'COMPLETED',
  'OVERDUE',
  'CANCELLED'
);

create type service_part_status as enum (
  'NEEDED',
  'ORDERED',
  'RECEIVED',
  'INSTALLED',
  'CANCELLED'
);

create sequence draw_package_number_seq start with 1;
create sequence service_request_folio_seq start with 1001;

create table builders (
  id bigint generated always as identity primary key,
  code varchar(24) not null unique
    check (code = upper(btrim(code)) and code <> ''),
  name varchar(100) not null check (btrim(name) <> ''),
  description varchar(240),
  address varchar(240),
  contact_name varchar(100),
  contact_email email_address,
  contact_phone phone_number,
  is_active boolean not null default true,
  ext_to_dm_weeks smallint not null default 4
    check (ext_to_dm_weeks between 0 and 52),
  shutter_before_dm_weeks smallint not null default 1
    check (shutter_before_dm_weeks between 1 and 52),
  dm_to_hw_weeks smallint not null default 1
    check (dm_to_hw_weeks between 0 and 52),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index builders_name_uq on builders (lower(btrim(name)));

create table people (
  id bigint generated always as identity primary key,
  name varchar(100) not null check (btrim(name) <> ''),
  email email_address not null,
  phone phone_number,
  office_phone phone_number,
  territory varchar(80),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index people_email_uq on people (lower(email));

create table person_roles (
  person_id bigint not null references people(id) on delete cascade,
  role person_role not null,
  primary key (person_id, role)
);

create table builder_contacts (
  id bigint generated always as identity primary key,
  builder_id bigint not null references builders(id) on delete restrict,
  name varchar(100) not null check (btrim(name) <> ''),
  type contact_type not null,
  email email_address not null,
  phone phone_number,
  office_phone phone_number,
  notes varchar(300),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, builder_id, type)
);

create unique index builder_contacts_email_uq
  on builder_contacts (lower(email));

create table communities (
  id bigint generated always as identity primary key,
  builder_id bigint not null references builders(id) on delete restrict,
  code varchar(40),
  name varchar(100) not null check (btrim(name) <> ''),
  address varchar(240),
  city varchar(80),
  state varchar(2) check (state is null or state ~ '^[A-Z]{2}$'),
  postal_code varchar(10),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, builder_id),
  unique (builder_id, code)
);

create unique index communities_builder_name_uq
  on communities (builder_id, lower(btrim(name)));

create table billing_setups (
  id bigint generated always as identity primary key,
  builder_id bigint not null unique references builders(id) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, builder_id)
);

create table billing_setup_versions (
  id bigint generated always as identity primary key,
  setup_id bigint not null,
  builder_id bigint not null,
  version_number integer not null check (version_number > 0),
  status setup_version_status not null default 'DRAFT',
  separate_hardware_price boolean not null default false,
  options_billing_draw_number smallint
    check (options_billing_draw_number between 1 and 5),
  hardware_billing_draw_number smallint
    check (hardware_billing_draw_number between 1 and 5),
  frequency billing_frequency not null,
  cutoff_day smallint check (cutoff_day between 1 and 31),
  submission_day smallint check (submission_day between 1 and 31),
  cutoff_days smallint[] not null default '{}'::smallint[],
  cutoff_weekday smallint check (cutoff_weekday between 0 and 6),
  submission_offset_days smallint
    check (submission_offset_days between 0 and 30),
  work_accepted_through work_accepted_through not null default 'CUTOFF',
  invoice_date_rule invoice_date_rule not null default 'SUBMISSION',
  payment_terms_days smallint not null default 30
    check (payment_terms_days between 0 and 180),
  retention_enabled boolean not null default false,
  retention_percentage percentage not null default 0,
  wrap_enabled boolean not null default false,
  wrap_percentage percentage not null default 0,
  invoice_line_format invoice_line_format not null default 'LOT_SCOPE',
  portal_name varchar(80),
  notes varchar(500),
  activated_by uuid,
  activated_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (setup_id, builder_id)
    references billing_setups(id, builder_id) on delete cascade,
  unique (setup_id, version_number),
  unique (id, builder_id),
  check (
    (status = 'DRAFT' and activated_at is null)
    or (status in ('ACTIVE', 'SUPERSEDED') and activated_at is not null)
  ),
  check (
    (separate_hardware_price and hardware_billing_draw_number is not null)
    or (not separate_hardware_price and hardware_billing_draw_number is null)
  ),
  check (
    retention_percentage + wrap_percentage <= 100
    and (
      (retention_enabled and retention_percentage between 1 and 100)
      or (not retention_enabled and retention_percentage = 0)
    )
    and (
      (wrap_enabled and wrap_percentage between 1 and 100)
      or (not wrap_enabled and wrap_percentage = 0)
    )
  ),
  check (
    (
      frequency = 'MONTHLY'
      and cutoff_day is not null
      and submission_day is not null
      and cardinality(cutoff_days) = 0
      and cutoff_weekday is null
      and submission_offset_days is null
    )
    or (
      frequency = 'SEMIMONTHLY'
      and cutoff_day is null
      and submission_day is null
      and cardinality(cutoff_days) = 2
      and cutoff_days[1] between 1 and 31
      and cutoff_days[2] between 1 and 31
      and cutoff_days[1] <> cutoff_days[2]
      and cutoff_weekday is null
      and submission_offset_days is not null
    )
    or (
      frequency = 'WEEKLY'
      and cutoff_day is null
      and submission_day is null
      and cardinality(cutoff_days) = 0
      and cutoff_weekday is not null
      and submission_offset_days is not null
    )
  )
);

create unique index billing_setup_versions_one_active_uq
  on billing_setup_versions (setup_id)
  where status = 'ACTIVE';

create table billing_draws (
  id bigint generated always as identity primary key,
  setup_version_id bigint not null
    references billing_setup_versions(id) on delete cascade,
  draw_number smallint not null check (draw_number between 1 and 5),
  name varchar(80),
  percentage percentage not null check (percentage > 0 and percentage < 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (setup_version_id, draw_number),
  unique (id, setup_version_id)
);

create table billing_required_documents (
  id bigint generated always as identity primary key,
  setup_version_id bigint not null
    references billing_setup_versions(id) on delete cascade,
  document_type billing_document_type not null,
  label varchar(100) not null check (btrim(label) <> ''),
  is_required boolean not null default true,
  display_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (setup_version_id, document_type, label)
);

create unique index billing_required_documents_fixed_type_uq
  on billing_required_documents (setup_version_id, document_type)
  where document_type <> 'CUSTOM';

create table jobs (
  id bigint generated always as identity primary key,
  code varchar(40) not null unique
    check (code = upper(btrim(code)) and code <> ''),
  name varchar(120) not null check (btrim(name) <> ''),
  builder_id bigint not null references builders(id) on delete restrict,
  community_id bigint not null,
  supervisor_id bigint not null references people(id) on delete restrict,
  superintendent_id bigint not null,
  superintendent_type contact_type generated always as
    ('JOBSITE_SUPERINTENDENT'::contact_type) stored,
  ap_contact_id bigint not null,
  ap_contact_type contact_type generated always as
    ('AP_CONTACT'::contact_type) stored,
  billing_setup_version_id bigint not null,
  sequence_sheet_name varchar(120),
  status varchar(16) not null default 'ACTIVE'
    check (status in ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED')),
  notes varchar(500),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (community_id, builder_id)
    references communities(id, builder_id) on delete restrict,
  foreign key (superintendent_id, builder_id, superintendent_type)
    references builder_contacts(id, builder_id, type) on delete restrict,
  foreign key (ap_contact_id, builder_id, ap_contact_type)
    references builder_contacts(id, builder_id, type) on delete restrict,
  foreign key (billing_setup_version_id, builder_id)
    references billing_setup_versions(id, builder_id) on delete restrict,
  unique (id, builder_id),
  unique (id, community_id)
);

create unique index jobs_builder_name_uq
  on jobs (builder_id, lower(btrim(name)));

create table plans (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs(id) on delete restrict,
  code varchar(40) not null check (btrim(code) <> ''),
  name varchar(100) not null check (btrim(name) <> ''),
  description varchar(300),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, code),
  unique (id, job_id)
);

create table plan_prices (
  id bigint generated always as identity primary key,
  plan_id bigint not null references plans(id) on delete restrict,
  base_price amount not null,
  hardware_price amount not null default 0,
  effective_from date not null,
  effective_to date,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, plan_id),
  check (effective_to is null or effective_to >= effective_from),
  check (hardware_price <= base_price)
);

create unique index plan_prices_one_open_uq
  on plan_prices (plan_id)
  where effective_to is null;

create table plan_options (
  id bigint generated always as identity primary key,
  plan_id bigint not null references plans(id) on delete restrict,
  code varchar(40) not null check (btrim(code) <> ''),
  name varchar(120) not null check (btrim(name) <> ''),
  description varchar(300),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, code),
  unique (id, plan_id)
);

create table option_prices (
  id bigint generated always as identity primary key,
  option_id bigint not null references plan_options(id) on delete restrict,
  price amount not null,
  effective_from date not null,
  effective_to date,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (id, option_id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index option_prices_one_open_uq
  on option_prices (option_id)
  where effective_to is null;

create table phases (
  id bigint generated always as identity primary key,
  job_id bigint not null references jobs(id) on delete restrict,
  code varchar(40) not null check (btrim(code) <> ''),
  building varchar(80),
  notes varchar(500),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, code),
  unique (id, job_id)
);

create table lots (
  id bigint generated always as identity primary key,
  phase_id bigint not null,
  job_id bigint not null,
  plan_id bigint not null,
  lot_number varchar(40) not null check (btrim(lot_number) <> ''),
  is_reverse boolean not null default false,
  display_order integer not null default 0,
  notes varchar(300),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (phase_id, job_id)
    references phases(id, job_id) on delete cascade,
  foreign key (plan_id, job_id)
    references plans(id, job_id) on delete restrict,
  unique (phase_id, lot_number),
  unique (id, phase_id),
  unique (id, plan_id)
);

create table lot_options (
  lot_id bigint not null,
  plan_id bigint not null,
  option_id bigint not null,
  selected_by uuid,
  selected_at timestamptz not null default now(),
  primary key (lot_id, option_id),
  foreign key (lot_id, plan_id)
    references lots(id, plan_id) on delete cascade,
  foreign key (option_id, plan_id)
    references plan_options(id, plan_id) on delete restrict
);

create table production_activities (
  id bigint generated always as identity primary key,
  phase_id bigint not null,
  job_id bigint not null,
  status production_activity_status not null default 'ACTIVE',
  supervisor_id bigint not null references people(id) on delete restrict,
  superintendent_id bigint not null references builder_contacts(id) on delete restrict,
  supervisor_name varchar(100) not null,
  superintendent_name varchar(100) not null,
  notes varchar(500),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (phase_id, job_id)
    references phases(id, job_id) on delete restrict,
  unique (id, phase_id),
  check (
    (status = 'ACTIVE' and completed_at is null and cancelled_at is null)
    or (status = 'COMPLETED' and completed_at is not null and cancelled_at is null)
    or (status = 'CANCELLED' and completed_at is null and cancelled_at is not null)
  )
);

create table production_activity_lots (
  activity_id bigint not null,
  phase_id bigint not null,
  lot_id bigint not null,
  primary key (activity_id, lot_id),
  foreign key (activity_id, phase_id)
    references production_activities(id, phase_id) on delete cascade,
  foreign key (lot_id, phase_id)
    references lots(id, phase_id) on delete restrict
);

create table production_stages (
  id bigint generated always as identity primary key,
  activity_id bigint not null references production_activities(id) on delete cascade,
  stage_type production_stage_type not null,
  is_enabled boolean not null default true,
  order_material boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, stage_type),
  unique (id, activity_id)
);

create table production_schedules (
  id bigint generated always as identity primary key,
  stage_id bigint not null,
  activity_id bigint not null,
  variant production_schedule_variant not null,
  scheduled_date date not null,
  date_owner date_owner not null default 'TENTATIVE',
  note varchar(500),
  lot_start_label varchar(40),
  lot_end_label varchar(40),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (stage_id, activity_id)
    references production_stages(id, activity_id) on delete cascade,
  unique (id, activity_id)
);

create table production_schedule_lots (
  schedule_id bigint not null references production_schedules(id) on delete cascade,
  lot_id bigint not null references lots(id) on delete restrict,
  primary key (schedule_id, lot_id)
);

create table production_date_history (
  id bigint generated always as identity primary key,
  schedule_id bigint not null references production_schedules(id) on delete cascade,
  previous_date date not null,
  new_date date not null,
  previous_owner date_owner not null,
  new_owner date_owner not null,
  reason varchar(500),
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table stored_files (
  id bigint generated always as identity primary key,
  bucket_id text not null default 'valtrim-documents',
  object_path text not null check (btrim(object_path) <> ''),
  original_filename varchar(255) not null check (btrim(original_filename) <> ''),
  mime_type varchar(120),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  sha256 char(64) check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create table draw_packages (
  id bigint generated always as identity primary key,
  package_number varchar(24) not null unique default
    ('DP-' || lpad(nextval('draw_package_number_seq')::text, 8, '0')),
  builder_id bigint not null references builders(id) on delete restrict,
  job_id bigint not null,
  phase_id bigint not null,
  setup_version_id bigint not null,
  package_date date not null default current_date,
  billing_period_start date,
  billing_period_end date,
  payment_terms_days smallint not null check (payment_terms_days between 0 and 180),
  invoice_line_format invoice_line_format not null,
  portal_name varchar(80),
  status package_status not null default 'DRAFT',
  quickbooks_status quickbooks_status not null default 'NOT_CREATED',
  quickbooks_reference varchar(120),
  submission_status submission_status not null default 'NOT_SUBMITTED',
  submitted_at timestamptz,
  submitted_by uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason varchar(500),
  notes varchar(500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, builder_id)
    references jobs(id, builder_id) on delete restrict,
  foreign key (phase_id, job_id)
    references phases(id, job_id) on delete restrict,
  foreign key (setup_version_id, builder_id)
    references billing_setup_versions(id, builder_id) on delete restrict,
  unique (id, builder_id),
  unique (id, phase_id),
  check (
    billing_period_start is null
    or billing_period_end is null
    or billing_period_end >= billing_period_start
  ),
  check (
    (status = 'VOIDED' and voided_at is not null and btrim(void_reason) <> '')
    or (status <> 'VOIDED' and voided_at is null and void_reason is null)
  )
);

create table invoices (
  id bigint generated always as identity primary key,
  package_id bigint not null unique references draw_packages(id) on delete restrict,
  invoice_number varchar(60) unique,
  invoice_date date,
  due_date date,
  gross_amount amount not null default 0,
  retention_amount amount not null default 0,
  wrap_amount amount not null default 0,
  net_amount amount not null default 0,
  paid_amount amount not null default 0,
  status invoice_status not null default 'DRAFT',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid_amount <= net_amount),
  check (
    (status = 'DRAFT' and invoice_date is null and due_date is null)
    or (status <> 'DRAFT' and invoice_date is not null and due_date is not null)
  )
);

create table package_draws (
  package_id bigint not null,
  lot_id bigint not null,
  draw_id bigint not null,
  phase_id bigint not null,
  builder_id bigint not null,
  setup_version_id bigint not null,
  plan_id bigint not null,
  plan_price_id bigint not null,
  lot_number varchar(40) not null,
  phase_code varchar(40) not null,
  building varchar(80),
  plan_code varchar(40) not null,
  plan_name varchar(100) not null,
  is_reverse boolean not null,
  base_price amount not null,
  hardware_price amount not null,
  draw_base amount not null,
  draw_number smallint not null,
  draw_name varchar(80),
  draw_percentage percentage not null,
  base_draw_amount amount not null,
  hardware_amount amount not null default 0,
  options_amount amount not null default 0,
  gross_amount amount not null,
  retention_percentage percentage not null default 0,
  retention_amount amount not null default 0,
  wrap_percentage percentage not null default 0,
  wrap_amount amount not null default 0,
  net_amount amount not null,
  created_at timestamptz not null default now(),
  primary key (lot_id, draw_id),
  unique (package_id, lot_id, draw_id),
  foreign key (package_id, builder_id)
    references draw_packages(id, builder_id) on delete restrict,
  foreign key (package_id, phase_id)
    references draw_packages(id, phase_id) on delete restrict,
  foreign key (lot_id, phase_id)
    references lots(id, phase_id) on delete restrict,
  foreign key (lot_id, plan_id)
    references lots(id, plan_id) on delete restrict,
  foreign key (draw_id, setup_version_id)
    references billing_draws(id, setup_version_id) on delete restrict,
  foreign key (plan_price_id, plan_id)
    references plan_prices(id, plan_id) on delete restrict,
  check (draw_base + hardware_price = base_price),
  check (gross_amount = base_draw_amount + hardware_amount + options_amount),
  check (net_amount = gross_amount - retention_amount - wrap_amount)
);

create table package_options (
  package_id bigint not null references draw_packages(id) on delete restrict,
  lot_id bigint not null,
  option_id bigint not null,
  draw_id bigint not null,
  option_price_id bigint not null,
  option_code varchar(40) not null,
  option_name varchar(120) not null,
  option_price amount not null,
  created_at timestamptz not null default now(),
  primary key (lot_id, option_id),
  foreign key (package_id, lot_id, draw_id)
    references package_draws(package_id, lot_id, draw_id) on delete restrict,
  foreign key (lot_id, option_id)
    references lot_options(lot_id, option_id) on delete restrict,
  foreign key (option_price_id, option_id)
    references option_prices(id, option_id) on delete restrict
);

create table package_documents (
  id bigint generated always as identity primary key,
  package_id bigint not null references draw_packages(id) on delete restrict,
  document_type billing_document_type not null,
  label varchar(100) not null check (btrim(label) <> ''),
  is_required boolean not null default true,
  status document_status not null default 'MISSING',
  file_id bigint references stored_files(id) on delete restrict,
  completed_at timestamptz,
  completed_by uuid,
  notes varchar(300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, document_type, label),
  check (
    (status = 'COMPLETE' and file_id is not null and completed_at is not null)
    or (status = 'WAIVED' and completed_at is not null)
    or (status in ('MISSING', 'PENDING') and completed_at is null and completed_by is null)
  )
);

create unique index package_documents_fixed_type_uq
  on package_documents (package_id, document_type)
  where document_type <> 'CUSTOM';

create table invoice_payments (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references invoices(id) on delete restrict,
  amount amount not null check (amount > 0),
  received_on date not null,
  reference varchar(120),
  status payment_status not null default 'CLEARED',
  notes varchar(300),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table service_properties (
  id bigint generated always as identity primary key,
  community_id bigint references communities(id) on delete restrict,
  lot_number varchar(40),
  address varchar(240) not null check (btrim(address) <> ''),
  city varchar(80),
  state varchar(2) check (state is null or state ~ '^[A-Z]{2}$'),
  postal_code varchar(10),
  plan_label varchar(100),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table service_requests (
  id bigint generated always as identity primary key,
  folio varchar(24) not null unique default
    ('SR-' || lpad(nextval('service_request_folio_seq')::text, 8, '0')),
  property_id bigint not null references service_properties(id) on delete restrict,
  reported_on date not null default current_date,
  created_by uuid,
  coordinator_user_id uuid,
  homeowner_name varchar(100) not null check (btrim(homeowner_name) <> ''),
  homeowner_email email_address,
  homeowner_phone phone_number,
  request_type service_request_type not null,
  priority service_priority not null default 'MEDIUM',
  status service_status not null default 'NEW',
  tag service_tag not null default 'NEW',
  status_note varchar(300),
  description varchar(2000) not null check (btrim(description) <> ''),
  internal_notes varchar(2000),
  status_before_close service_status,
  closed_at timestamptz,
  closed_by uuid,
  close_reason varchar(500),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'CLOSED' and closed_at is not null and btrim(close_reason) <> '')
    or (status <> 'CLOSED' and closed_at is null and close_reason is null)
  )
);

create table service_request_status_history (
  id bigint generated always as identity primary key,
  request_id bigint not null references service_requests(id) on delete cascade,
  previous_status service_status,
  new_status service_status not null,
  note varchar(500),
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create table service_appointments (
  id bigint generated always as identity primary key,
  request_id bigint not null references service_requests(id) on delete restrict,
  technician_id bigint references people(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  state service_appointment_state not null default 'SCHEDULED',
  is_current boolean not null default true,
  notes varchar(500),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (
    (state = 'COMPLETED' and completed_at is not null and cancelled_at is null)
    or (state = 'CANCELLED' and completed_at is null and cancelled_at is not null)
    or (state in ('NOT_SCHEDULED', 'SCHEDULED', 'OVERDUE')
      and completed_at is null and cancelled_at is null)
  )
);

create unique index service_appointments_one_current_uq
  on service_appointments (request_id)
  where is_current;

create table service_request_notes (
  id bigint generated always as identity primary key,
  request_id bigint not null references service_requests(id) on delete cascade,
  body varchar(2000) not null check (btrim(body) <> ''),
  is_internal boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table service_request_parts (
  id bigint generated always as identity primary key,
  request_id bigint not null references service_requests(id) on delete restrict,
  description varchar(240) not null check (btrim(description) <> ''),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  status service_part_status not null default 'NEEDED',
  vendor varchar(120),
  purchase_order varchar(80),
  expected_on date,
  installed_at timestamptz,
  notes varchar(500),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'INSTALLED' and installed_at is not null)
    or (status <> 'INSTALLED' and installed_at is null)
  )
);

create table service_request_attachments (
  request_id bigint not null references service_requests(id) on delete cascade,
  file_id bigint not null references stored_files(id) on delete restrict,
  category varchar(30) not null default 'GENERAL'
    check (category in ('GENERAL', 'PHOTO', 'DOCUMENT', 'COMPLETION')),
  description varchar(300),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (request_id, file_id)
);

-- ---------------------------------------------------------------------------
-- Funciones de integridad y escritura transaccional
-- ---------------------------------------------------------------------------

create function set_updated_at()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function validate_person_role()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_territory text;
begin
  if new.role = 'SUPERVISOR' then
    select territory into v_territory
    from people
    where id = new.person_id and is_active;

    if v_territory is null or btrim(v_territory) = '' then
      raise exception 'A supervisor activo debe tener territorio';
    end if;
  end if;
  return new;
end;
$$;

create function validate_person_update()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if exists (
    select 1 from person_roles
    where person_id = new.id and role = 'SUPERVISOR'
  ) and (not new.is_active or new.territory is null or btrim(new.territory) = '') then
    raise exception 'Una persona con rol SUPERVISOR debe permanecer activa y tener territorio';
  end if;
  return new;
end;
$$;

create function initialize_builder_billing()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  insert into billing_setups (builder_id, created_by)
  values (new.id, new.created_by);
  return new;
end;
$$;

create function validate_setup_version(p_version_id bigint)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_count integer;
  v_min smallint;
  v_max smallint;
  v_total numeric;
  v_options_draw smallint;
  v_hardware_draw smallint;
begin
  select count(*), min(draw_number), max(draw_number), sum(percentage)
  into v_count, v_min, v_max, v_total
  from billing_draws
  where setup_version_id = p_version_id;

  if v_count < 2 or v_count > 5 then
    raise exception 'La configuracion debe tener entre 2 y 5 draws';
  end if;
  if v_min <> 1 or v_max <> v_count then
    raise exception 'Los draws deben ser consecutivos y comenzar en 1';
  end if;
  if v_total <> 100 then
    raise exception 'Los porcentajes de los draws deben sumar 100';
  end if;

  select options_billing_draw_number, hardware_billing_draw_number
  into v_options_draw, v_hardware_draw
  from billing_setup_versions
  where id = p_version_id;

  if v_options_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_options_draw
  ) then
    raise exception 'El draw configurado para options no existe';
  end if;
  if v_hardware_draw is not null and not exists (
    select 1 from billing_draws
    where setup_version_id = p_version_id and draw_number = v_hardware_draw
  ) then
    raise exception 'El draw configurado para hardware no existe';
  end if;
end;
$$;

create function protect_billing_setup_version()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if old.status <> 'DRAFT' then
    if not (
      old.status = 'ACTIVE'
      and new.status = 'SUPERSEDED'
      and (to_jsonb(new) - array['status', 'updated_at']) =
          (to_jsonb(old) - array['status', 'updated_at'])
    ) then
      raise exception 'Una version activa o reemplazada de billing es inmutable';
    end if;
  end if;

  if old.status = 'DRAFT' and new.status = 'ACTIVE' then
    perform validate_setup_version(new.id);
  end if;
  return new;
end;
$$;

create function protect_billing_version_child()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_version_id bigint;
  v_status setup_version_status;
begin
  v_version_id := case when tg_op = 'DELETE' then old.setup_version_id else new.setup_version_id end;
  select status into v_status
  from billing_setup_versions
  where id = v_version_id;

  if v_status <> 'DRAFT' then
    raise exception 'Los draws y documentos de una version activa son inmutables';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- p_config usa claves camelCase: separateHardwarePrice,
-- optionsBillingDrawNumber, hardwareBillingDrawNumber, frequency, cutoffDay,
-- submissionDay, cutoffDays, cutoffWeekday, submissionOffsetDays,
-- workAcceptedThrough, invoiceDateRule, paymentTermsDays, retentionEnabled,
-- retentionPercentage, wrapEnabled, wrapPercentage, invoiceLineFormat,
-- portalName y notes.
-- p_draws: [{"drawNumber":1,"name":"Start","percentage":10}, ...]
-- p_required_documents: [{"type":"PURCHASE_ORDER","label":"PO",
--                         "required":true,"displayOrder":1}, ...]
create function save_billing_setup_version(
  p_builder_id bigint,
  p_config jsonb,
  p_draws jsonb,
  p_required_documents jsonb default '[]'::jsonb,
  p_version_id bigint default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_setup_id bigint;
  v_version_id bigint;
  v_version_number integer;
begin
  if jsonb_typeof(p_config) <> 'object'
     or jsonb_typeof(p_draws) <> 'array'
     or jsonb_typeof(p_required_documents) <> 'array' then
    raise exception 'Config, draws y required documents deben ser JSON validos';
  end if;

  select id into v_setup_id
  from billing_setups
  where builder_id = p_builder_id
  for update;

  if v_setup_id is null then
    raise exception 'Builder % no existe o no tiene billing setup', p_builder_id;
  end if;

  if p_version_id is null then
    select coalesce(max(version_number), 0) + 1
    into v_version_number
    from billing_setup_versions
    where setup_id = v_setup_id;

    insert into billing_setup_versions (
      setup_id, builder_id, version_number, separate_hardware_price,
      options_billing_draw_number, hardware_billing_draw_number,
      frequency, cutoff_day, submission_day, cutoff_days, cutoff_weekday,
      submission_offset_days, work_accepted_through, invoice_date_rule,
      payment_terms_days, retention_enabled, retention_percentage,
      wrap_enabled, wrap_percentage, invoice_line_format, portal_name, notes,
      created_by
    ) values (
      v_setup_id, p_builder_id, v_version_number,
      coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      case when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,
      (p_config->>'frequency')::billing_frequency,
      nullif(p_config->>'cutoffDay', '')::smallint,
      nullif(p_config->>'submissionDay', '')::smallint,
      coalesce(array(
        select value::smallint
        from jsonb_array_elements_text(coalesce(p_config->'cutoffDays', '[]'::jsonb))
      ), '{}'::smallint[]),
      nullif(p_config->>'cutoffWeekday', '')::smallint,
      nullif(p_config->>'submissionOffsetDays', '')::smallint,
      coalesce((p_config->>'workAcceptedThrough')::work_accepted_through, 'CUTOFF'),
      coalesce((p_config->>'invoiceDateRule')::invoice_date_rule, 'SUBMISSION'),
      coalesce((p_config->>'paymentTermsDays')::smallint, 30),
      coalesce((p_config->>'retentionEnabled')::boolean, false),
      case when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      coalesce((p_config->>'wrapEnabled')::boolean, false),
      case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::percentage, 0) else 0 end,
      coalesce((p_config->>'invoiceLineFormat')::invoice_line_format, 'LOT_SCOPE'),
      nullif(btrim(p_config->>'portalName'), ''),
      nullif(btrim(p_config->>'notes'), ''),
      p_actor_id
    ) returning id into v_version_id;
  else
    select id into v_version_id
    from billing_setup_versions
    where id = p_version_id and setup_id = v_setup_id and status = 'DRAFT'
    for update;

    if v_version_id is null then
      raise exception 'La version no existe, no pertenece al builder o ya no es DRAFT';
    end if;

    update billing_setup_versions set
      separate_hardware_price = coalesce((p_config->>'separateHardwarePrice')::boolean, false),
      options_billing_draw_number = nullif(p_config->>'optionsBillingDrawNumber', '')::smallint,
      hardware_billing_draw_number = case
        when coalesce((p_config->>'separateHardwarePrice')::boolean, false)
        then nullif(p_config->>'hardwareBillingDrawNumber', '')::smallint end,
      frequency = (p_config->>'frequency')::billing_frequency,
      cutoff_day = nullif(p_config->>'cutoffDay', '')::smallint,
      submission_day = nullif(p_config->>'submissionDay', '')::smallint,
      cutoff_days = coalesce(array(
        select value::smallint
        from jsonb_array_elements_text(coalesce(p_config->'cutoffDays', '[]'::jsonb))
      ), '{}'::smallint[]),
      cutoff_weekday = nullif(p_config->>'cutoffWeekday', '')::smallint,
      submission_offset_days = nullif(p_config->>'submissionOffsetDays', '')::smallint,
      work_accepted_through = coalesce(
        (p_config->>'workAcceptedThrough')::work_accepted_through, 'CUTOFF'),
      invoice_date_rule = coalesce(
        (p_config->>'invoiceDateRule')::invoice_date_rule, 'SUBMISSION'),
      payment_terms_days = coalesce((p_config->>'paymentTermsDays')::smallint, 30),
      retention_enabled = coalesce((p_config->>'retentionEnabled')::boolean, false),
      retention_percentage = case
        when coalesce((p_config->>'retentionEnabled')::boolean, false)
        then coalesce((p_config->>'retentionPercentage')::percentage, 0) else 0 end,
      wrap_enabled = coalesce((p_config->>'wrapEnabled')::boolean, false),
      wrap_percentage = case when coalesce((p_config->>'wrapEnabled')::boolean, false)
        then coalesce((p_config->>'wrapPercentage')::percentage, 0) else 0 end,
      invoice_line_format = coalesce(
        (p_config->>'invoiceLineFormat')::invoice_line_format, 'LOT_SCOPE'),
      portal_name = nullif(btrim(p_config->>'portalName'), ''),
      notes = nullif(btrim(p_config->>'notes'), ''),
      updated_at = now()
    where id = v_version_id;

    delete from billing_draws where setup_version_id = v_version_id;
    delete from billing_required_documents where setup_version_id = v_version_id;
  end if;

  insert into billing_draws (setup_version_id, draw_number, name, percentage)
  select v_version_id, (d.value->>'drawNumber')::smallint,
         nullif(btrim(d.value->>'name'), ''),
         (d.value->>'percentage')::percentage
  from jsonb_array_elements(p_draws) as d(value);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  ) values (v_version_id, 'INVOICE', 'Invoice', true, 0);

  insert into billing_required_documents (
    setup_version_id, document_type, label, is_required, display_order
  )
  select v_version_id, (d.value->>'type')::billing_document_type,
         btrim(d.value->>'label'),
         coalesce((d.value->>'required')::boolean, true),
         coalesce((d.value->>'displayOrder')::smallint, 0)
  from jsonb_array_elements(p_required_documents) as d(value)
  where (d.value->>'type')::billing_document_type <> 'INVOICE';

  perform validate_setup_version(v_version_id);
  return v_version_id;
end;
$$;

create function activate_billing_setup_version(
  p_version_id bigint,
  p_actor_id uuid default null
)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_setup_id bigint;
  v_status setup_version_status;
begin
  select setup_id, status into v_setup_id, v_status
  from billing_setup_versions
  where id = p_version_id
  for update;

  if v_status is null then
    raise exception 'La version de billing no existe';
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'Solo una version DRAFT puede activarse';
  end if;

  perform validate_setup_version(p_version_id);

  update billing_setup_versions
  set status = 'SUPERSEDED', updated_at = now()
  where setup_id = v_setup_id and status = 'ACTIVE';

  update billing_setup_versions
  set status = 'ACTIVE', activated_by = p_actor_id,
      activated_at = now(), updated_at = now()
  where id = p_version_id;
end;
$$;

create function validate_job()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if not exists (
    select 1
    from people p
    join person_roles r on r.person_id = p.id and r.role = 'SUPERVISOR'
    where p.id = new.supervisor_id and p.is_active
  ) then
    raise exception 'El supervisor debe estar activo y tener rol SUPERVISOR';
  end if;
  if not exists (
    select 1 from builders where id = new.builder_id and is_active
  ) then
    raise exception 'El builder debe estar activo';
  end if;
  if not exists (
    select 1 from communities
    where id = new.community_id and builder_id = new.builder_id and is_active
  ) then
    raise exception 'La comunidad debe estar activa y pertenecer al builder';
  end if;
  if not exists (
    select 1 from builder_contacts
    where id in (new.superintendent_id, new.ap_contact_id)
      and builder_id = new.builder_id and is_active
    group by builder_id
    having count(*) = 2
  ) then
    raise exception 'Superintendent y AP Contact deben estar activos y pertenecer al builder';
  end if;
  if not exists (
    select 1 from billing_setup_versions
    where id = new.billing_setup_version_id
      and builder_id = new.builder_id and status = 'ACTIVE'
  ) then
    raise exception 'El job debe usar una version ACTIVE de billing del builder';
  end if;
  return new;
end;
$$;

-- p_lots: [{"lotNumber":"101","planId":1,"isReverse":false,
--           "optionIds":[1,2]}, ...]
create function save_job_phase(
  p_job_id bigint,
  p_code text,
  p_building text,
  p_lots jsonb,
  p_phase_id bigint default null,
  p_notes text default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_phase_id bigint;
  v_lot_id bigint;
  v_lot jsonb;
begin
  if jsonb_typeof(p_lots) <> 'array' or jsonb_array_length(p_lots) = 0 then
    raise exception 'La phase debe contener al menos un lot';
  end if;

  if p_phase_id is null then
    insert into phases (job_id, code, building, notes, created_by, updated_by)
    values (p_job_id, btrim(p_code), nullif(btrim(p_building), ''),
            nullif(btrim(p_notes), ''), p_actor_id, p_actor_id)
    returning id into v_phase_id;
  else
    select id into v_phase_id
    from phases
    where id = p_phase_id and job_id = p_job_id
    for update;

    if v_phase_id is null then
      raise exception 'La phase no existe o no pertenece al job';
    end if;

    update phases
    set code = btrim(p_code), building = nullif(btrim(p_building), ''),
        notes = nullif(btrim(p_notes), ''), updated_by = p_actor_id
    where id = v_phase_id;

    delete from lots where phase_id = v_phase_id;
  end if;

  for v_lot in select value from jsonb_array_elements(p_lots)
  loop
    insert into lots (
      phase_id, job_id, plan_id, lot_number, is_reverse, display_order,
      notes, created_by, updated_by
    ) values (
      v_phase_id, p_job_id, (v_lot->>'planId')::bigint,
      btrim(v_lot->>'lotNumber'),
      coalesce((v_lot->>'isReverse')::boolean, false),
      coalesce((v_lot->>'displayOrder')::integer, 0),
      nullif(btrim(v_lot->>'notes'), ''), p_actor_id, p_actor_id
    ) returning id into v_lot_id;

    insert into lot_options (lot_id, plan_id, option_id, selected_by)
    select v_lot_id, (v_lot->>'planId')::bigint, value::bigint, p_actor_id
    from jsonb_array_elements_text(coalesce(v_lot->'optionIds', '[]'::jsonb));
  end loop;

  return v_phase_id;
end;
$$;

create function record_production_date_change()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if new.scheduled_date is distinct from old.scheduled_date
     or new.date_owner is distinct from old.date_owner then
    insert into production_date_history (
      schedule_id, previous_date, new_date, previous_owner, new_owner,
      reason, changed_by
    ) values (
      old.id, old.scheduled_date, new.scheduled_date,
      old.date_owner, new.date_owner, new.note, new.updated_by
    );
  end if;
  return new;
end;
$$;

-- p_stages:
-- [{"type":"EXT","orderMaterial":false,"schedules":[
--   {"variant":"BASE","date":"2026-09-10","dateOwner":"TENTATIVE",
--    "note":null,"lotIds":[1,2]}]}]
create function create_production_activity(
  p_phase_id bigint,
  p_stages jsonb,
  p_lot_ids bigint[] default null,
  p_notes text default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_activity_id bigint;
  v_job_id bigint;
  v_supervisor_id bigint;
  v_superintendent_id bigint;
  v_supervisor_name text;
  v_superintendent_name text;
  v_stage jsonb;
  v_schedule jsonb;
  v_stage_id bigint;
  v_schedule_id bigint;
  v_schedule_lots bigint[];
  v_expected integer;
  v_inserted integer;
begin
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) = 0 then
    raise exception 'Debe enviar al menos un production stage';
  end if;

  select p.job_id, j.supervisor_id, j.superintendent_id,
         supervisor.name, superintendent.name
  into v_job_id, v_supervisor_id, v_superintendent_id,
       v_supervisor_name, v_superintendent_name
  from phases p
  join jobs j on j.id = p.job_id
  join people supervisor on supervisor.id = j.supervisor_id
  join builder_contacts superintendent on superintendent.id = j.superintendent_id
  where p.id = p_phase_id and p.is_active and j.is_active;

  if v_job_id is null then
    raise exception 'La phase o su job no estan activos';
  end if;

  insert into production_activities (
    phase_id, job_id, supervisor_id, superintendent_id,
    supervisor_name, superintendent_name, notes, created_by, updated_by
  ) values (
    p_phase_id, v_job_id, v_supervisor_id, v_superintendent_id,
    v_supervisor_name, v_superintendent_name, nullif(btrim(p_notes), ''),
    p_actor_id, p_actor_id
  ) returning id into v_activity_id;

  if p_lot_ids is null then
    insert into production_activity_lots (activity_id, phase_id, lot_id)
    select v_activity_id, p_phase_id, id
    from lots where phase_id = p_phase_id;
  else
    select count(distinct x) into v_expected from unnest(p_lot_ids) as x;
    insert into production_activity_lots (activity_id, phase_id, lot_id)
    select v_activity_id, p_phase_id, l.id
    from lots l
    join (select distinct x from unnest(p_lot_ids) as x) selected on selected.x = l.id
    where l.phase_id = p_phase_id;
    get diagnostics v_inserted = row_count;
    if v_inserted <> v_expected then
      raise exception 'Uno o mas lots no pertenecen a la phase';
    end if;
  end if;

  if not exists (
    select 1 from production_activity_lots where activity_id = v_activity_id
  ) then
    raise exception 'La actividad debe tener al menos un lot';
  end if;

  for v_stage in select value from jsonb_array_elements(p_stages)
  loop
    insert into production_stages (
      activity_id, stage_type, is_enabled, order_material
    ) values (
      v_activity_id, (v_stage->>'type')::production_stage_type,
      coalesce((v_stage->>'enabled')::boolean, true),
      coalesce((v_stage->>'orderMaterial')::boolean, false)
    ) returning id into v_stage_id;

    for v_schedule in
      select value
      from jsonb_array_elements(coalesce(v_stage->'schedules', '[]'::jsonb))
    loop
      select array_agg(value::bigint)
      into v_schedule_lots
      from jsonb_array_elements_text(coalesce(v_schedule->'lotIds', '[]'::jsonb));

      if v_schedule_lots is null or cardinality(v_schedule_lots) = 0 then
        raise exception 'Cada schedule debe incluir al menos un lot';
      end if;

      if exists (
        select 1 from unnest(v_schedule_lots) requested(id)
        where not exists (
          select 1 from production_activity_lots al
          where al.activity_id = v_activity_id and al.lot_id = requested.id
        )
      ) then
        raise exception 'Un schedule contiene lots fuera de la actividad';
      end if;

      insert into production_schedules (
        stage_id, activity_id, variant, scheduled_date, date_owner, note,
        lot_start_label, lot_end_label, created_by, updated_by
      )
      select v_stage_id, v_activity_id,
             (v_schedule->>'variant')::production_schedule_variant,
             (v_schedule->>'date')::date,
             coalesce((v_schedule->>'dateOwner')::date_owner, 'TENTATIVE'),
             nullif(btrim(v_schedule->>'note'), ''),
             min(l.lot_number), max(l.lot_number), p_actor_id, p_actor_id
      from lots l
      where l.id = any(v_schedule_lots)
      returning id into v_schedule_id;

      insert into production_schedule_lots (schedule_id, lot_id)
      select v_schedule_id, id from unnest(v_schedule_lots) as id;
    end loop;
  end loop;

  if not exists (
    select 1 from production_stages
    where activity_id = v_activity_id and stage_type = 'EXT'
  ) or not exists (
    select 1 from production_stages
    where activity_id = v_activity_id and stage_type = 'DM'
  ) or not exists (
    select 1 from production_stages
    where activity_id = v_activity_id and stage_type = 'HW'
  ) then
    raise exception 'La actividad debe incluir EXT, DM y HW';
  end if;

  return v_activity_id;
end;
$$;

create function prevent_price_overlap()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_overlap boolean;
begin
  if tg_table_name = 'plan_prices' then
    select exists (
      select 1 from plan_prices p
      where p.plan_id = new.plan_id
        and p.id <> coalesce(new.id, 0)
        and daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]')
            && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
    ) into v_overlap;
  else
    select exists (
      select 1 from option_prices p
      where p.option_id = new.option_id
        and p.id <> coalesce(new.id, 0)
        and daterange(p.effective_from, coalesce(p.effective_to, 'infinity'::date), '[]')
            && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
    ) into v_overlap;
  end if;

  if v_overlap then
    raise exception 'El periodo de precio se traslapa con otro precio';
  end if;
  return new;
end;
$$;

create function prepare_draw_package()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_terms smallint;
  v_line_format invoice_line_format;
  v_portal varchar(80);
begin
  if tg_op = 'UPDATE' then
    if new.builder_id <> old.builder_id
       or new.job_id <> old.job_id
       or new.phase_id <> old.phase_id
       or new.setup_version_id <> old.setup_version_id
       or new.package_date <> old.package_date
       or new.payment_terms_days <> old.payment_terms_days
       or new.invoice_line_format <> old.invoice_line_format
       or new.portal_name is distinct from old.portal_name then
      raise exception 'La configuracion y alcance de un package son inmutables';
    end if;
    return new;
  end if;

  select v.payment_terms_days, v.invoice_line_format, v.portal_name
  into v_terms, v_line_format, v_portal
  from jobs j
  join phases p on p.job_id = j.id
  join billing_setup_versions v
    on v.id = j.billing_setup_version_id and v.builder_id = j.builder_id
  where j.id = new.job_id
    and j.builder_id = new.builder_id
    and p.id = new.phase_id
    and new.setup_version_id = j.billing_setup_version_id
    and j.is_active and p.is_active
    and v.status in ('ACTIVE', 'SUPERSEDED');

  if v_terms is null then
    raise exception 'Job, phase y billing setup no forman un package valido';
  end if;

  new.payment_terms_days := v_terms;
  new.invoice_line_format := v_line_format;
  new.portal_name := v_portal;
  return new;
end;
$$;

create function prepare_package_draw()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_record record;
  v_options_count integer;
  v_priced_options_count integer;
  v_prior_amount numeric(14,2);
begin
  select
    dp.phase_id, dp.builder_id, dp.setup_version_id, dp.package_date,
    p.code as phase_code, p.building,
    l.plan_id, l.lot_number, l.is_reverse,
    pl.code as plan_code, pl.name as plan_name,
    pp.id as plan_price_id, pp.base_price, pp.hardware_price as configured_hardware,
    d.draw_number, d.name as draw_name, d.percentage as draw_percentage,
    v.separate_hardware_price, v.hardware_billing_draw_number,
    v.options_billing_draw_number,
    v.retention_percentage, v.wrap_percentage
  into v_record
  from draw_packages dp
  join phases p on p.id = dp.phase_id and p.job_id = dp.job_id
  join lots l on l.id = new.lot_id and l.phase_id = dp.phase_id
  join plans pl on pl.id = l.plan_id and pl.job_id = dp.job_id
  join billing_draws d
    on d.id = new.draw_id and d.setup_version_id = dp.setup_version_id
  join billing_setup_versions v on v.id = dp.setup_version_id
  join lateral (
    select candidate.*
    from plan_prices candidate
    where candidate.plan_id = l.plan_id
      and candidate.effective_from <= dp.package_date
      and (candidate.effective_to is null or candidate.effective_to >= dp.package_date)
    order by candidate.effective_from desc
    limit 1
  ) pp on true
  where dp.id = new.package_id and dp.status = 'DRAFT';

  if v_record.plan_id is null then
    raise exception 'No se pudo calcular el draw: revise package, lot, draw y precio vigente';
  end if;

  new.phase_id := v_record.phase_id;
  new.builder_id := v_record.builder_id;
  new.setup_version_id := v_record.setup_version_id;
  new.plan_id := v_record.plan_id;
  new.plan_price_id := v_record.plan_price_id;
  new.lot_number := v_record.lot_number;
  new.phase_code := v_record.phase_code;
  new.building := v_record.building;
  new.plan_code := v_record.plan_code;
  new.plan_name := v_record.plan_name;
  new.is_reverse := v_record.is_reverse;
  new.base_price := v_record.base_price;
  new.hardware_price := case when v_record.separate_hardware_price
    then v_record.configured_hardware else 0 end;
  new.draw_base := new.base_price - new.hardware_price;
  new.draw_number := v_record.draw_number;
  new.draw_name := v_record.draw_name;
  new.draw_percentage := v_record.draw_percentage;

  if v_record.draw_number = (
    select max(draw_number) from billing_draws
    where setup_version_id = v_record.setup_version_id
  ) then
    select coalesce(sum(round(new.draw_base * percentage / 100, 2)), 0)
    into v_prior_amount
    from billing_draws
    where setup_version_id = v_record.setup_version_id
      and draw_number < v_record.draw_number;
    new.base_draw_amount := new.draw_base - v_prior_amount;
  else
    new.base_draw_amount := round(
      new.draw_base * v_record.draw_percentage / 100, 2);
  end if;

  new.hardware_amount := case
    when v_record.separate_hardware_price
      and v_record.draw_number = v_record.hardware_billing_draw_number
    then new.hardware_price else 0 end;

  new.options_amount := 0;
  if v_record.draw_number = v_record.options_billing_draw_number then
    select count(*) into v_options_count
    from lot_options where lot_id = new.lot_id;

    select count(*), coalesce(sum(price.price), 0)
    into v_priced_options_count, new.options_amount
    from lot_options selected
    join lateral (
      select candidate.price
      from option_prices candidate
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= v_record.package_date
        and (candidate.effective_to is null or candidate.effective_to >= v_record.package_date)
      order by candidate.effective_from desc
      limit 1
    ) price on true
    where selected.lot_id = new.lot_id;

    if v_options_count <> v_priced_options_count then
      raise exception 'Una o mas options del lot no tienen precio vigente';
    end if;
  end if;

  new.gross_amount := new.base_draw_amount + new.hardware_amount + new.options_amount;
  new.retention_percentage := v_record.retention_percentage;
  new.retention_amount := round(new.gross_amount * new.retention_percentage / 100, 2);
  new.wrap_percentage := v_record.wrap_percentage;
  new.wrap_amount := round(new.gross_amount * new.wrap_percentage / 100, 2);
  new.net_amount := new.gross_amount - new.retention_amount - new.wrap_amount;
  return new;
end;
$$;

create function populate_package_options()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if new.draw_number = (
    select options_billing_draw_number
    from billing_setup_versions where id = new.setup_version_id
  ) then
    insert into package_options (
      package_id, lot_id, option_id, draw_id, option_price_id,
      option_code, option_name, option_price
    )
    select new.package_id, new.lot_id, selected.option_id, new.draw_id,
           price.id, option.code, option.name, price.price
    from lot_options selected
    join plan_options option on option.id = selected.option_id
    join draw_packages package on package.id = new.package_id
    join lateral (
      select candidate.* from option_prices candidate
      where candidate.option_id = selected.option_id
        and candidate.effective_from <= package.package_date
        and (candidate.effective_to is null
          or candidate.effective_to >= package.package_date)
      order by candidate.effective_from desc
      limit 1
    ) price on true
    where selected.lot_id = new.lot_id;
  end if;
  return new;
end;
$$;

create function reject_package_line_change()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  raise exception 'Las lineas calculadas de un draw package son inmutables; anule y recree el package';
end;
$$;

create function recalculate_invoice_totals()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_package_id bigint;
begin
  v_package_id := case when tg_op = 'DELETE' then old.package_id else new.package_id end;
  update invoices i
  set gross_amount = totals.gross_amount,
      retention_amount = totals.retention_amount,
      wrap_amount = totals.wrap_amount,
      net_amount = totals.net_amount,
      updated_at = now()
  from (
    select coalesce(sum(gross_amount), 0)::amount as gross_amount,
           coalesce(sum(retention_amount), 0)::amount as retention_amount,
           coalesce(sum(wrap_amount), 0)::amount as wrap_amount,
           coalesce(sum(net_amount), 0)::amount as net_amount
    from package_draws where package_id = v_package_id
  ) totals
  where i.package_id = v_package_id;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function validate_package_status_change()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_invoice_status invoice_status;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
    (old.status = 'DRAFT' and new.status in ('READY', 'VOIDED'))
    or (old.status = 'READY' and new.status in ('DRAFT', 'INVOICED', 'VOIDED'))
    or (old.status = 'INVOICED' and new.status in ('SUBMITTED', 'VOIDED'))
    or (old.status = 'SUBMITTED' and new.status in ('PAID', 'VOIDED'))
  ) then
    raise exception 'Transicion de package no permitida: % -> %', old.status, new.status;
  end if;

  if new.status = 'READY' and not exists (
    select 1 from package_draws where package_id = new.id
  ) then
    raise exception 'Un package sin lineas no puede marcarse READY';
  end if;

  select status into v_invoice_status from invoices where package_id = new.id;
  if new.status = 'INVOICED' and v_invoice_status = 'DRAFT' then
    raise exception 'Primero debe emitirse la invoice';
  end if;

  if new.status = 'SUBMITTED' then
    if new.submitted_at is null or new.submitted_by is null then
      raise exception 'Submitted date y user son obligatorios';
    end if;
    if exists (
      select 1 from package_documents
      where package_id = new.id and is_required
        and status not in ('COMPLETE', 'WAIVED')
    ) then
      raise exception 'Todos los documentos requeridos deben estar completos o waived';
    end if;
  end if;

  if new.status = 'PAID' and v_invoice_status <> 'PAID' then
    raise exception 'La invoice debe estar pagada antes de cerrar el package';
  end if;
  return new;
end;
$$;

create function prepare_invoice()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_terms smallint;
begin
  if new.invoice_date is not null then
    select payment_terms_days into v_terms
    from draw_packages where id = new.package_id;
    new.due_date := new.invoice_date + v_terms;
  else
    new.due_date := null;
  end if;
  return new;
end;
$$;

create function recalculate_invoice_payment()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_invoice_id bigint;
  v_paid amount;
  v_net amount;
  v_status invoice_status;
  v_package_id bigint;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;

  select coalesce(sum(amount) filter (where status = 'CLEARED'), 0)::amount
  into v_paid from invoice_payments where invoice_id = v_invoice_id;

  select net_amount, status, package_id into v_net, v_status, v_package_id
  from invoices where id = v_invoice_id for update;

  if v_paid > v_net then
    raise exception 'Los pagos no pueden exceder el total neto de la invoice';
  end if;

  update invoices
  set paid_amount = v_paid,
      status = case
        when v_net > 0 and v_paid = v_net then 'PAID'::invoice_status
        when v_paid > 0 then 'PARTIALLY_PAID'::invoice_status
        when status in ('PARTIALLY_PAID', 'PAID') then 'ISSUED'::invoice_status
        else status
      end,
      updated_at = now()
  where id = v_invoice_id;

  if v_net > 0 and v_paid = v_net then
    update draw_packages
    set status = 'PAID', updated_at = now()
    where id = v_package_id and status = 'SUBMITTED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function create_draw_package(
  p_phase_id bigint,
  p_draw_numbers smallint[],
  p_lot_ids bigint[] default null,
  p_package_date date default current_date,
  p_period_start date default null,
  p_period_end date default null,
  p_notes text default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_package_id bigint;
  v_builder_id bigint;
  v_job_id bigint;
  v_version_id bigint;
  v_terms smallint;
  v_line_format invoice_line_format;
  v_portal varchar(80);
  v_expected integer;
  v_found integer;
  v_inserted integer;
begin
  if p_draw_numbers is null or cardinality(p_draw_numbers) = 0 then
    raise exception 'Debe seleccionar al menos un draw';
  end if;

  select j.builder_id, j.id, j.billing_setup_version_id,
         v.payment_terms_days, v.invoice_line_format, v.portal_name
  into v_builder_id, v_job_id, v_version_id,
       v_terms, v_line_format, v_portal
  from phases p
  join jobs j on j.id = p.job_id
  join billing_setup_versions v on v.id = j.billing_setup_version_id
  where p.id = p_phase_id and p.is_active and j.is_active
    and v.status in ('ACTIVE', 'SUPERSEDED');

  if v_job_id is null then
    raise exception 'La phase, job o billing setup no estan disponibles';
  end if;

  select count(distinct requested) into v_expected
  from unnest(p_draw_numbers) requested;
  select count(*) into v_found from billing_draws
  where setup_version_id = v_version_id
    and draw_number = any(p_draw_numbers);
  if v_expected <> v_found then
    raise exception 'Uno o mas draw numbers no pertenecen al billing setup';
  end if;

  if p_lot_ids is not null then
    select count(distinct requested) into v_expected from unnest(p_lot_ids) requested;
    select count(*) into v_found from lots
    where phase_id = p_phase_id and id = any(p_lot_ids);
    if v_expected <> v_found then
      raise exception 'Uno o mas lots no pertenecen a la phase';
    end if;
  end if;

  insert into draw_packages (
    builder_id, job_id, phase_id, setup_version_id, package_date,
    billing_period_start, billing_period_end, payment_terms_days,
    invoice_line_format, portal_name, notes, created_by, updated_by
  ) values (
    v_builder_id, v_job_id, p_phase_id, v_version_id, p_package_date,
    p_period_start, p_period_end, v_terms, v_line_format, v_portal,
    nullif(btrim(p_notes), ''), p_actor_id, p_actor_id
  ) returning id into v_package_id;

  insert into invoices (package_id, created_by, updated_by)
  values (v_package_id, p_actor_id, p_actor_id);

  insert into package_documents (
    package_id, document_type, label, is_required
  )
  select v_package_id, document_type, label, is_required
  from billing_required_documents
  where setup_version_id = v_version_id
  order by display_order, id;

  insert into package_draws (package_id, lot_id, draw_id)
  select v_package_id, l.id, d.id
  from lots l
  cross join billing_draws d
  where l.phase_id = p_phase_id
    and (p_lot_ids is null or l.id = any(p_lot_ids))
    and d.setup_version_id = v_version_id
    and d.draw_number = any(p_draw_numbers);
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    raise exception 'El package no genero lineas';
  end if;
  return v_package_id;
end;
$$;

create function issue_invoice(
  p_package_id bigint,
  p_invoice_number text,
  p_invoice_date date default current_date,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_invoice_id bigint;
begin
  update invoices
  set invoice_number = btrim(p_invoice_number), invoice_date = p_invoice_date,
      status = 'ISSUED', updated_by = p_actor_id
  where package_id = p_package_id and status = 'DRAFT'
  returning id into v_invoice_id;

  if v_invoice_id is null then
    raise exception 'La invoice no existe o ya fue emitida';
  end if;

  update draw_packages set status = 'INVOICED', updated_by = p_actor_id
  where id = p_package_id and status = 'READY';

  if not found then
    raise exception 'El package debe estar READY antes de emitir la invoice';
  end if;
  return v_invoice_id;
end;
$$;

create function submit_draw_package(
  p_package_id bigint,
  p_actor_id uuid
)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  update invoices
  set status = 'SUBMITTED', updated_by = p_actor_id
  where package_id = p_package_id and status = 'ISSUED';

  if not found then
    raise exception 'La invoice debe estar ISSUED';
  end if;

  update draw_packages
  set status = 'SUBMITTED', submission_status = 'SUBMITTED',
      submitted_at = now(), submitted_by = p_actor_id, updated_by = p_actor_id
  where id = p_package_id and status = 'INVOICED';

  if not found then
    raise exception 'El package debe estar INVOICED';
  end if;
end;
$$;

create function normalize_service_request()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  new.tag := case new.status
    when 'NEW' then 'NEW'::service_tag
    when 'AWAITING_PARTS' then 'PARTS_NEEDED'::service_tag
    when 'COMPLETED' then 'COMPLETED'::service_tag
    when 'CLOSED' then 'COMPLETED'::service_tag
    when 'OVERDUE' then 'OVERDUE'::service_tag
    else 'FOLLOW_UP'::service_tag
  end;
  return new;
end;
$$;

create function record_service_status_change()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into service_request_status_history (
      request_id, previous_status, new_status, note, changed_by
    ) values (
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status, new.status_note, new.updated_by
    );
  end if;
  return new;
end;
$$;

create function validate_service_appointment()
returns trigger
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if new.technician_id is not null and not exists (
    select 1
    from people p
    join person_roles r
      on r.person_id = p.id and r.role = 'SERVICE_TECHNICIAN'
    where p.id = new.technician_id and p.is_active
  ) then
    raise exception 'El tecnico debe estar activo y tener rol SERVICE_TECHNICIAN';
  end if;
  if exists (
    select 1 from service_requests
    where id = new.request_id and status = 'CLOSED'
  ) then
    raise exception 'No se puede agendar una solicitud cerrada';
  end if;
  return new;
end;
$$;

create function replace_current_service_appointment(
  p_request_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_technician_id bigint default null,
  p_notes text default null,
  p_actor_id uuid default null
)
returns bigint
language plpgsql
set search_path = valtrim, pg_catalog
as $$
declare
  v_appointment_id bigint;
begin
  perform 1 from service_requests
  where id = p_request_id and status <> 'CLOSED'
  for update;
  if not found then
    raise exception 'La solicitud no existe o esta cerrada';
  end if;

  update service_appointments
  set is_current = false,
      state = case when state in ('SCHEDULED', 'OVERDUE')
        then 'CANCELLED'::service_appointment_state else state end,
      cancelled_at = case when state in ('SCHEDULED', 'OVERDUE')
        then now() else cancelled_at end,
      updated_by = p_actor_id
  where request_id = p_request_id and is_current;

  insert into service_appointments (
    request_id, technician_id, starts_at, ends_at, notes,
    created_by, updated_by
  ) values (
    p_request_id, p_technician_id, p_starts_at, p_ends_at,
    nullif(btrim(p_notes), ''), p_actor_id, p_actor_id
  ) returning id into v_appointment_id;

  update service_requests
  set status = 'CONFIRMED', status_note = 'Appointment scheduled',
      updated_by = p_actor_id
  where id = p_request_id and status in ('NEW', 'CONTACT_NEEDED');

  return v_appointment_id;
end;
$$;

create function close_service_request(
  p_request_id bigint,
  p_reason text,
  p_actor_id uuid
)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo de cierre es obligatorio';
  end if;

  update service_requests
  set status_before_close = status, status = 'CLOSED',
      closed_at = now(), closed_by = p_actor_id,
      close_reason = btrim(p_reason), status_note = btrim(p_reason),
      updated_by = p_actor_id
  where id = p_request_id and status <> 'CLOSED';

  if not found then
    raise exception 'La solicitud no existe o ya esta cerrada';
  end if;
end;
$$;

create function reopen_service_request(
  p_request_id bigint,
  p_note text,
  p_actor_id uuid
)
returns void
language plpgsql
set search_path = valtrim, pg_catalog
as $$
begin
  update service_requests
  set status = coalesce(status_before_close, 'CONTACT_NEEDED'),
      status_before_close = null, closed_at = null, closed_by = null,
      close_reason = null, status_note = nullif(btrim(p_note), ''),
      updated_by = p_actor_id
  where id = p_request_id and status = 'CLOSED';

  if not found then
    raise exception 'La solicitud no existe o no esta cerrada';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger person_roles_validate
before insert or update on person_roles
for each row execute function validate_person_role();

create trigger people_validate_update
before update on people
for each row execute function validate_person_update();

create trigger builders_initialize_billing
after insert on builders
for each row execute function initialize_builder_billing();

create trigger billing_setup_versions_protect
before update on billing_setup_versions
for each row execute function protect_billing_setup_version();

create trigger billing_draws_protect
before insert or update or delete on billing_draws
for each row execute function protect_billing_version_child();

create trigger billing_required_documents_protect
before insert or update or delete on billing_required_documents
for each row execute function protect_billing_version_child();

create trigger jobs_validate
before insert or update on jobs
for each row execute function validate_job();

create trigger plan_prices_no_overlap
before insert or update on plan_prices
for each row execute function prevent_price_overlap();

create trigger option_prices_no_overlap
before insert or update on option_prices
for each row execute function prevent_price_overlap();

create trigger production_schedules_history
after update of scheduled_date, date_owner on production_schedules
for each row execute function record_production_date_change();

create trigger draw_packages_prepare
before insert or update on draw_packages
for each row execute function prepare_draw_package();

create trigger draw_packages_validate_status
before update of status on draw_packages
for each row execute function validate_package_status_change();

create trigger package_draws_prepare
before insert on package_draws
for each row execute function prepare_package_draw();

create trigger package_draws_populate_options
after insert on package_draws
for each row execute function populate_package_options();

create trigger package_draws_recalculate_invoice
after insert on package_draws
for each row execute function recalculate_invoice_totals();

create trigger package_draws_immutable
before update or delete on package_draws
for each row execute function reject_package_line_change();

create trigger package_options_immutable
before update or delete on package_options
for each row execute function reject_package_line_change();

create trigger invoices_prepare
before insert or update of invoice_date on invoices
for each row execute function prepare_invoice();

create trigger invoice_payments_recalculate
after insert or update or delete on invoice_payments
for each row execute function recalculate_invoice_payment();

create trigger service_requests_normalize
before insert or update of status on service_requests
for each row execute function normalize_service_request();

create trigger service_requests_history
after insert or update of status on service_requests
for each row execute function record_service_status_change();

create trigger service_appointments_validate
before insert or update on service_appointments
for each row execute function validate_service_appointment();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'builders', 'people', 'builder_contacts', 'communities',
    'billing_setup_versions', 'billing_draws', 'jobs', 'plans',
    'plan_options', 'phases', 'lots', 'production_activities',
    'production_stages', 'production_schedules', 'draw_packages',
    'invoices', 'package_documents', 'service_properties',
    'service_requests', 'service_appointments', 'service_request_parts'
  ]
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      v_table || '_set_updated_at', v_table
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Indices para FKs y consultas principales
-- ---------------------------------------------------------------------------

create index builder_contacts_builder_idx on builder_contacts (builder_id, type, is_active);
create index communities_builder_idx on communities (builder_id, is_active);
create index billing_setup_versions_builder_idx on billing_setup_versions (builder_id, status);
create index billing_setup_versions_setup_builder_idx on billing_setup_versions (setup_id, builder_id);
create index jobs_community_idx on jobs (community_id, builder_id);
create index jobs_supervisor_idx on jobs (supervisor_id);
create index jobs_superintendent_idx on jobs (superintendent_id, builder_id, superintendent_type);
create index jobs_ap_contact_idx on jobs (ap_contact_id, builder_id, ap_contact_type);
create index jobs_setup_version_idx on jobs (billing_setup_version_id, builder_id);
create index plans_job_active_idx on plans (job_id, is_active);
create index plan_prices_plan_period_idx on plan_prices (plan_id, effective_from, effective_to);
create index plan_options_plan_active_idx on plan_options (plan_id, is_active);
create index option_prices_option_period_idx on option_prices (option_id, effective_from, effective_to);
create index phases_job_active_idx on phases (job_id, is_active);
create index lots_job_idx on lots (job_id);
create index lots_phase_job_idx on lots (phase_id, job_id);
create index lots_plan_idx on lots (plan_id, job_id);
create index lot_options_lot_plan_idx on lot_options (lot_id, plan_id);
create index lot_options_option_idx on lot_options (option_id, plan_id);
create index production_activities_job_idx on production_activities (job_id, status);
create index production_activities_supervisor_idx on production_activities (supervisor_id);
create index production_activities_superintendent_idx on production_activities (superintendent_id);
create index production_activities_phase_job_idx on production_activities (phase_id, job_id);
create index production_activity_lots_activity_phase_idx on production_activity_lots (activity_id, phase_id);
create index production_activity_lots_lot_idx on production_activity_lots (lot_id, phase_id);
create index production_stages_activity_idx on production_stages (activity_id);
create index production_schedules_activity_date_idx on production_schedules (activity_id, scheduled_date);
create index production_schedules_stage_activity_idx on production_schedules (stage_id, activity_id);
create index production_schedule_lots_lot_idx on production_schedule_lots (lot_id);
create index production_date_history_schedule_idx on production_date_history (schedule_id, changed_at desc);
create index draw_packages_builder_idx on draw_packages (builder_id, status, package_date desc);
create index draw_packages_job_idx on draw_packages (job_id, builder_id, package_date desc);
create index draw_packages_phase_idx on draw_packages (phase_id, job_id, package_date desc);
create index draw_packages_setup_version_idx on draw_packages (setup_version_id, builder_id);
create index package_draws_package_idx on package_draws (package_id, builder_id);
create index package_draws_package_phase_idx on package_draws (package_id, phase_id);
create index package_draws_lot_phase_idx on package_draws (lot_id, phase_id);
create index package_draws_lot_plan_idx on package_draws (lot_id, plan_id);
create index package_draws_draw_idx on package_draws (draw_id, setup_version_id);
create index package_draws_plan_price_idx on package_draws (plan_price_id, plan_id);
create index package_options_package_idx on package_options (package_id, lot_id, draw_id);
create index package_options_option_idx on package_options (option_id);
create index package_options_price_idx on package_options (option_price_id, option_id);
create index package_documents_package_status_idx on package_documents (package_id, status);
create index package_documents_file_idx on package_documents (file_id);
create index invoice_payments_invoice_idx on invoice_payments (invoice_id, status);
create index service_properties_community_idx on service_properties (community_id);
create index service_requests_property_idx on service_requests (property_id);
create index service_requests_status_idx on service_requests (status, priority, reported_on desc);
create index service_requests_coordinator_idx on service_requests (coordinator_user_id);
create index service_request_history_idx on service_request_status_history (request_id, changed_at desc);
create index service_appointments_request_idx on service_appointments (request_id, starts_at desc);
create index service_appointments_technician_idx on service_appointments (technician_id, starts_at);
create index service_request_notes_request_idx on service_request_notes (request_id, created_at desc);
create index service_request_parts_request_idx on service_request_parts (request_id, status);
create index service_request_attachments_file_idx on service_request_attachments (file_id);

-- ---------------------------------------------------------------------------
-- Views de lectura. security_invoker permite que el RLS futuro se aplique
-- usando los permisos del usuario que consulta, no los del creador de la view.
-- ---------------------------------------------------------------------------

create view job_overview
with (security_invoker = true)
as
select
  j.id,
  j.code,
  j.name,
  j.status,
  j.is_active,
  j.builder_id,
  b.name as builder_name,
  j.community_id,
  c.name as community_name,
  j.supervisor_id,
  supervisor.name as supervisor_name,
  j.superintendent_id,
  superintendent.name as superintendent_name,
  j.ap_contact_id,
  ap.name as ap_contact_name,
  j.billing_setup_version_id,
  count(distinct p.id) as phase_count,
  count(distinct l.id) as lot_count
from jobs j
join builders b on b.id = j.builder_id
join communities c on c.id = j.community_id
join people supervisor on supervisor.id = j.supervisor_id
join builder_contacts superintendent on superintendent.id = j.superintendent_id
join builder_contacts ap on ap.id = j.ap_contact_id
left join phases p on p.job_id = j.id
left join lots l on l.phase_id = p.id
group by j.id, b.name, c.name, supervisor.name, superintendent.name, ap.name;

create view draw_package_overview
with (security_invoker = true)
as
select
  dp.id,
  dp.package_number,
  dp.package_date,
  dp.status,
  dp.builder_id,
  b.name as builder_name,
  dp.job_id,
  j.code as job_code,
  j.name as job_name,
  dp.phase_id,
  p.code as phase_code,
  i.id as invoice_id,
  i.invoice_number,
  i.status as invoice_status,
  i.gross_amount,
  i.retention_amount,
  i.wrap_amount,
  i.net_amount,
  i.paid_amount,
  count(distinct pd.lot_id) as lot_count,
  count(*) as line_count
from draw_packages dp
join builders b on b.id = dp.builder_id
join jobs j on j.id = dp.job_id
join phases p on p.id = dp.phase_id
join invoices i on i.package_id = dp.id
left join package_draws pd on pd.package_id = dp.id
group by dp.id, b.name, j.code, j.name, p.code, i.id;

create view service_request_overview
with (security_invoker = true)
as
select
  sr.id,
  sr.folio,
  sr.reported_on,
  sr.status,
  sr.tag,
  sr.priority,
  sr.request_type,
  sr.homeowner_name,
  sr.homeowner_email,
  sr.homeowner_phone,
  sr.description,
  sp.address,
  sp.lot_number,
  c.name as community_name,
  appointment.id as current_appointment_id,
  appointment.starts_at,
  appointment.ends_at,
  appointment.state as appointment_state,
  technician.name as technician_name,
  sr.created_at,
  sr.updated_at
from service_requests sr
join service_properties sp on sp.id = sr.property_id
left join communities c on c.id = sp.community_id
left join service_appointments appointment
  on appointment.request_id = sr.id and appointment.is_current
left join people technician on technician.id = appointment.technician_id;

-- El acceso queda deliberadamente cerrado. La migracion de Auth debe crear
-- perfiles/roles, grants y politicas RLS y despues habilitar RLS por tabla.
revoke all on schema valtrim from public;
revoke all on all tables in schema valtrim from public;
revoke all on all sequences in schema valtrim from public;
revoke execute on all functions in schema valtrim from public;

commit;
