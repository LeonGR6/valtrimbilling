# ValtrimBilling

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
