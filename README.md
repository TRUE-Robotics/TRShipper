# True Robotics FedEx Shipping

This project is a Vue + Vite shipping tool for creating FedEx shipments from a simple form.

It currently supports two workflows:

- the main shipping page, where a user reviews recipient details and creates a shipment
- a separate `/Button` intake page, where a line of pasted text is parsed and redirected into the main shipping form for review

The backend validates destination addresses with the FedEx Address Validation API before shipment creation, creates the shipment with the FedEx Ship API, and requests laser-printer PDF labels on letter stock for Ship API verification.

## What The Application Does

The application is designed to help True Robotics create FedEx labels with as little manual entry as possible while keeping the actual shipment flow inside FedEx.

Current behavior:

- collects recipient name, company, email, phone, and address details
- validates the destination address with FedEx before shipment creation
- creates shipments through the FedEx Ship API
- requests FedEx labels as `PDF`
- requests letter-sized laser label stock
- lets users preview and download a single PDF artifact for each shipment
- supports a `/Button` helper page that parses pasted text and pre-fills the normal shipping form

## Current Pages

Main page:

- URL: `http://localhost:5173/TrueRoboticsFedexShippingApp/`
- purpose: review/edit shipment fields and create the shipment

Button page:

- URL: `http://localhost:5173/TrueRoboticsFedexShippingApp/Button`
- purpose: paste one inventory-style line of text, parse it, and redirect into the normal shipping form with fields prefilled

Expected pasted format on `/Button`:

```text
Company Attn: Name Address City State ZIP Email Phone
```

Example:

```text
Apple Inc. Attn: John Doe 123 Main Street Worcester MA 01608 test@gmail.com 123-456-7890
```

## How Labels Work

This branch is temporarily configured for Ship API verification with a laser printer:

- FedEx label image type: `PDF`
- FedEx label stock: `PAPER_LETTER`
- preview artifact: `.pdf`
- download artifact: `.pdf`

For every shipment:

- the app uses the PDF returned by FedEx
- if FedEx returns more than one PDF label document, the app combines them into one PDF artifact
- `Preview Label` opens that PDF in one browser tab
- `Download Label` saves that PDF as one file

After Ship API verification, switch the normal production branch back to the thermal-label strategy.

## Architecture

Frontend:

- Vue 3 + Vite
- main app shell and shipping form
- `/Button` intake page for pasted IMS-style data

Backend:

- Node HTTP server in [`server/index.js`](/Users/diwakarsandhu/Documents/GitHub/TRShipper/server/index.js)
- FedEx OAuth token handling
- FedEx Address Validation API call
- FedEx Ship API call

## Routes

Frontend routes:

- `/TrueRoboticsFedexShippingApp/`
- `/TrueRoboticsFedexShippingApp/Button`

Backend routes:

- `GET /health`
- `POST /shipments`

## Configuration

Non-secret configuration lives in [`app.config.js`](/Users/diwakarsandhu/Documents/GitHub/TRShipper/app.config.js).

Frontend config includes:

- app title
- GitHub Pages base path
- backend API base URL
- logo path
- mock-mode flag

Server config includes:

- local server host/port
- path to the external secrets file
- FedEx API base URL
- shipper defaults
- package defaults
- label format defaults
- debug logging flag

## Secrets

Secrets are loaded by the backend from an external env file, not from inside the repository.

Current configured path:

`/Users/diwakarsandhu/Desktop/secrets/env`

Required values in that file:

```env
FEDEX_CLIENT_ID="..."
FEDEX_CLIENT_SECRET="..."
FEDEX_CHILD_KEY=""
FEDEX_CHILD_SECRET=""
FEDEX_ACCOUNT_NUMBER="..."
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

Start the backend:

```bash
npm run server:dev
```

Build the frontend:

```bash
npm run build
```

## Important Notes

- GitHub Pages cannot safely hold FedEx secrets, so this app must use a backend for real shipment creation.
- FedEx sandbox address validation can return `VIRTUAL.RESPONSE` data that is not trustworthy. The backend is currently set to ignore those sandbox-resolved addresses and keep the original submitted address instead.
- FedEx sandbox address validation can still return `VIRTUAL.RESPONSE` data that does not match the submitted country or region. The backend ignores those sandbox-resolved values and keeps the original submitted address instead.
- This branch intentionally requests FedEx `PDF` labels with `PAPER_LETTER` stock so the Ship API verification labels can be printed on laser sheets.

## Next Steps

To move this from a local prototype into a reliable production workflow, the main next steps are:

1. Get the FedEx Ship API properly validated and approved for the real production workflow.
   This includes making sure the project credentials are enabled for the exact APIs being used and confirming production behavior outside the sandbox.

2. Create and deploy a real server environment.
   Right now the backend runs locally. We need a deployed server or serverless backend that securely stores FedEx credentials, handles shipment creation, performs address validation, and generates label previews.

3. Route the `/Button` page into the inventory management system properly.
   The current `/Button` page works as a paste helper. The next step is to connect your IMS button so it opens this page with the inventory data in the expected format, or passes that payload directly in a cleaner structured way.

4. Improve the `/Button` parser for more address variations.
   The current parser is tuned to the provided example format. It should be hardened for more real-world company names, multi-word cities, apartment/suite cases, and inconsistent phone formatting.

5. Decide on the final production print strategy.
   The current PNG pipeline gives a stable browser preview and download path. For production thermal printing, we should still decide whether to stay on PNG or move to a dedicated thermal-label flow that matches the printer setup more closely.
