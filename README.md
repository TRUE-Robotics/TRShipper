# True Robotics FedEx Shipping App

Static Vue 3 + Vite starter for a GitHub Pages deployment that collects:

- recipient name
- recipient email
- recipient phone
- shipping address
- box type
- quantity

The app includes:

- a Vite + Vue 3 scaffold
- a shipping form component
- address autocomplete wiring
- a FedEx service layer with mock local submission support
- a local backend proxy for secure FedEx calls
- a shared config file for non-secret app defaults
- `.env` handling for local secrets

## Important note about FedEx credentials

GitHub Pages is a static host, so you should **not** place FedEx API secrets directly in this frontend. The included service layer is designed to call a separate backend or serverless proxy through the API base URL defined in `frontendConfig`.

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

## Configuration

Non-secret settings live in [`app.config.js`](/Users/diwakarsandhu/Documents/GitHub/TRShipper/app.config.js).

- `frontendConfig`: frontend title, base path, API URL, logo path, and address autocomplete settings
- `serverConfig`: backend defaults like host/port, shipper info, pickup type, label settings, and debug logging

## Secrets

Local [`.env`](/Users/diwakarsandhu/Documents/GitHub/TRShipper/.env) is ignored by git and should only contain FedEx secrets:

- `FEDEX_CLIENT_ID`
- `FEDEX_CLIENT_SECRET`
- `FEDEX_CHILD_KEY`
- `FEDEX_CHILD_SECRET`
- `FEDEX_ACCOUNT_NUMBER`

The backend exposes:

- `GET /health`
- `POST /shipments`

## Suggested next step

For the real FedEx flow, you will still need to confirm the exact shipment inputs you want to support. FedEx's Ship API requires more than just recipient address data for many shipment types, so this starter keeps those non-secret shipment defaults in `app.config.js` while isolating secrets in `.env`.
