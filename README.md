# True Robotics FedEx Shipping

A Vue and Node application for validating shipping addresses, creating FedEx shipments, and generating printable shipping labels.

## Current Workflow

1. The user enters recipient and package information.
2. The backend validates the destination through the FedEx Address Validation API.
3. If FedEx suggests a different address, the user chooses between the original and resolved addresses.
4. The backend creates the shipment through the FedEx Ship API.
5. FedEx sends tracking notifications to the configured sender email and, when provided, the recipient email.
6. FedEx PNG labels are combined into a single 4x6 PDF for preview or download.

Recipient company and email are optional. All other fields marked in the form are required.

## Environment Configuration

Environment selection controls both the FedEx API and credential file:

| Mode | Credential file | FedEx API |
| --- | --- | --- |
| Development | `/Users/diwakarsandhu/Desktop/secrets/env.development` | `https://apis-sandbox.fedex.com` |
| Production | `/Users/diwakarsandhu/Desktop/secrets/env.production` | `https://apis.fedex.com` |

Each credential file requires:

```env
FEDEX_CLIENT_ID="..."
FEDEX_CLIENT_SECRET="..."
FEDEX_ACCOUNT_NUMBER="..."
```

`FEDEX_CHILD_KEY` and `FEDEX_CHILD_SECRET` are optional.

Non-secret application, shipper, package, and label settings are in `app.config.js`.

## Local Development

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

Start the backend with FedEx sandbox credentials:

```bash
npm run server:dev
```

Start the backend with FedEx production credentials:

```bash
npm run server:prod
```

Build the frontend:

```bash
npm run build
```

## Routes

Frontend:

- `/TrueRoboticsFedexShippingApp/`

Backend:

- `GET /health`
- `POST /addresses/validate`
- `POST /shipments`

## Next Steps

1. Integrate this repository into the IMS codebase so it can receive context from the IMS shipment page.
2. Create a `/button` endpoint that reads the currently open shipment context, populates the FedEx API payload, and generates the shipping label or labels.
3. Automatically print generated labels to the connected printer.
4. Complete final workflow review, testing, and bug fixes.
