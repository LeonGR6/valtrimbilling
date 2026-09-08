# ValtrimBilling

ValtrimBilling is organized as an npm-workspaces monorepo. The existing React
application lives in `apps/frontend`; `apps/backend` contains the Supabase
configuration, migrations, database tests, and Edge Functions.

## Repository structure

```text
valtrimbilling/
├── apps/
│   ├── frontend/          # React 19 + Vite application
│   │   ├── public/
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── vite.config.js
│   └── backend/           # Supabase migrations, tests, and Edge Functions
├── packages/              # Future packages shared by multiple applications
├── .openai/               # Repository-level hosting configuration
├── package.json           # Workspace scripts
└── package-lock.json      # Single lockfile for all workspaces
```

The `packages` directory does not need to be created until shared code is
introduced. The root workspace pattern is already configured for it.

## Requirements

- Node.js 20+
- npm

## Getting started

Run all commands from the repository root:

```bash
npm install
npm run dev
```

The frontend development server is available at `http://localhost:5173` by
default.

## Root scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the frontend development server |
| `npm run dev:frontend` | Starts the frontend explicitly |
| `npm run build` | Creates the production frontend build |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | Runs frontend lint checks |
| `npm test` | Runs frontend tests |
| `npm run db:test` | Runs the Supabase pgTAP database tests |

Commands can also be executed directly against the frontend workspace:

```bash
npm run test --workspace=@valtrimbilling/frontend
```

## Frontend

The frontend uses React, Vite, Material UI, Emotion, React Router, React Hook
Form, and Zod. Its source code is organized by domain under
`apps/frontend/src/features`.

Frontend environment variables belong in `apps/frontend/.env`. Use
`apps/frontend/.env.example` as the template and expose only browser-safe values
with the `VITE_` prefix.

## Backend

Supabase assets live under `apps/backend/supabase`. The Phase 0 rollout and the
safe procedure for reconciling the existing remote schema with migration
history are documented in [docs/supabase-phase-0.md](docs/supabase-phase-0.md).

Backend secrets must stay in Supabase secrets or backend-only environment
variables and must never use the frontend's `VITE_` prefix.

## Shared code

When frontend and backend need the same schemas, types, or constants, create a
package under `packages/` instead of importing backend internals directly into
the frontend.

## Build and hosting

The hosting configuration remains at `.openai/hosting.json`. Although the Vite
configuration lives inside the frontend workspace, production artifacts still
go to the repository-level `dist/client` and `dist/server` directories to
preserve the existing hosting contract.

Frontend and backend should remain independently deployable even though they
share one repository.
