# True Robotics FedEx Shipping App

Static Vue 3 + Vite starter for a GitHub Pages deployment that collects:

- recipient email
- shipping address
- box type
- quantity

The app includes:

- a Vite + Vue 3 scaffold
- a shipping form component
- address autocomplete wiring
- a FedEx service layer with mock local submission support
- a local backend proxy for secure FedEx calls
- `.env` handling for local development

## Important note about FedEx credentials

GitHub Pages is a static host, so you should **not** place FedEx API secrets directly in this frontend. The included service layer is designed to call a separate backend or serverless proxy through `VITE_API_BASE_URL`.

Recommended architecture:

1. GitHub Pages hosts this Vue app.
2. A small backend or serverless function stores FedEx secrets.
3. This frontend posts shipment requests to that backend.

## Getting started

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Start the local proxy:

```bash
npm run server:dev
```

4. Build for GitHub Pages:

```bash
npm run build
```

## Environment variables

Local `.env` is ignored by git.

- `VITE_APP_TITLE`: app title shown in the UI
- `VITE_GITHUB_PAGES_BASE`: Vite base path for GitHub Pages
- `VITE_API_BASE_URL`: backend URL that will handle secure FedEx calls
- `VITE_ADDRESS_AUTOCOMPLETE_URL`: address search endpoint
- `VITE_ENABLE_MOCK_SUBMISSION`: set to `true` for frontend-only testing
- `VITE_LOGO_URL`: logo path, defaults to `/logo.png`

## Backend environment

Create `.env.server` from `.env.server.example` and fill in your FedEx credentials plus shipper defaults.

The backend exposes:

- `GET /health`
- `POST /shipments`

## Suggested next step

For the real FedEx flow, you will still need to confirm the exact shipment inputs you want to support. FedEx's Ship API requires more than just recipient email and address for many shipment types, so this starter uses backend defaults for the sender and package configuration while keeping the frontend simple.
