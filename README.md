# ValtrimBilling

Frontend for ValtrimBilling — a billing / construction-draw management app.
This repository currently contains the **app shell**: navigation, theming, and
routing. Feature screens are placeholders to be built out.

## Tech stack

- **React 19** + **Vite** (build tooling / dev server)
- **Material UI (MUI)** + **Emotion** (components & styling)
- **React Router 7** (routing)
- **ESLint** (linting)

## Requirements

- **Node.js 20+** and npm

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (http://localhost:5173)
npm run dev
```

## Scripts

| Command           | What it does                              |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start the Vite dev server with HMR        |
| `npm run build`   | Production build into `dist/`             |
| `npm run preview` | Serve the production build locally        |
| `npm run lint`    | Run ESLint over the project               |

## Project structure

```
src/
├── main.jsx                 # Bootstrap: mounts <App> + ThemeProvider / CssBaseline
├── App.jsx                  # Composition root: <RouterProvider> (global providers go here)
├── theme.js                 # MUI theme: light + dark color schemes and tokens
├── index.css                # Minimal global CSS (height chain only)
├── routes/
│   ├── nav.jsx              # Single source of truth for navigable routes
│   └── index.jsx            # Builds the router (redirect, 404, error boundary)
├── components/
│   ├── layout/              # App shell: Layout (Outlet), Sidebar
│   └── ui/                  # Reusable UI controls (e.g. ColorModeToggle)
└── pages/                   # One component per route
    └── errors/              # NotFound (404) and ErrorPage (route error boundary)
```

## Conventions

- **Add a route**: create the page in `src/pages/`, then register it in
  `src/routes/nav.jsx`. The sidebar picks it up automatically.
- **`pages/`** = anything mapped to a route (a full screen).
- **`components/layout/`** = structural shell shared across routes.
- **`components/ui/`** = reusable presentational / interactive controls.
- **Styling**: use the MUI theme via `sx` with theme paths (e.g. `text.primary`,
  `sidebar.bg`). Avoid hardcoded colors so light/dark mode keep working.
- **Features that grow** beyond a single page: move them into
  `src/features/<name>/` (with their own `components/`) once a section has
  several views — not before.

## Theming

Light and dark color schemes are defined in `src/theme.js`. The mode follows the
system preference by default and can be toggled from the sidebar; the choice is
persisted in `localStorage`.

Frontend de ValtrimBilling construido con React, Vite, React Router y MUI.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Estructura

```text
src/
├── assets/           # Imágenes, fuentes e iconos estáticos
├── components/
│   ├── common/       # Componentes compartidos por toda la app
│   └── layout/       # Estructura visual y navegación principal
├── config/           # Configuración global de la aplicación
├── context/          # Context providers compartidos
├── features/         # Módulos de dominio autocontenidos
│   ├── builders/
│   └── plan-types/
├── hooks/            # Hooks globales compartidos
├── pages/            # Componentes de nivel ruta, sin lógica de dominio pesada
├── routes/           # Registro de navegación y configuración del router
├── services/         # Clientes API e integraciones externas
├── store/            # Estado global cuando sea necesario
├── styles/           # Estilos globales y tema MUI
└── utils/            # Funciones puras y validadores compartidos
```

Cada carpeta de página o componente compartido expone un `index.js` para mantener imports estables. Las rutas se cargan de forma diferida para no incluir todos los módulos en el bundle inicial.

Los catálogos de Builders y Plan Types todavía utilizan datos locales en memoria. Sus datos temporales viven dentro de cada `feature`; la futura conexión con Supabase debe implementarse mediante `services/` o servicios propios de cada feature.

> En Vite, `index.html` permanece en la raíz del proyecto porque funciona como punto de entrada durante desarrollo y compilación.

