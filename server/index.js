import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadLocalEnvFile();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const allowedPickupTypes = new Set([
  'CONTACT_FEDEX_TO_SCHEDULE',
  'DROPOFF_AT_FEDEX_LOCATION',
  'USE_SCHEDULED_PICKUP',
]);
const allowedWeightUnits = new Set(['KG', 'LB']);
const allowedLabelImageTypes = new Set(['ZPLII', 'EPL2', 'PDF', 'PNG']);
const allowedLabelStockTypes = new Set([
  'PAPER_4X6',
  'STOCK_4X675',
  'PAPER_4X675',
  'PAPER_4X8',
  'PAPER_4X9',
  'PAPER_7X475',
  'PAPER_85X11_BOTTOM_HALF_LABEL',
  'PAPER_85X11_TOP_HALF_LABEL',
  'PAPER_LETTER',
  'STOCK_4X675_LEADING_DOC_TAB',
  'STOCK_4X8',
  'STOCK_4X9_LEADING_DOC_TAB',
  'STOCK_4X6',
  'STOCK_4X675_TRAILING_DOC_TAB',
  'STOCK_4X9_TRAILING_DOC_TAB',
  'STOCK_4X9',
  'STOCK_4X85_TRAILING_DOC_TAB',
  'STOCK_4X105_TRAILING_DOC_TAB',
]);
const allowedLabelFormatTypes = new Set(['COMMON2D', 'LABEL_DATA_ONLY']);
const allowedLabelPrintingOrientations = new Set([
  'BOTTOM_EDGE_OF_TEXT_FIRST',
  'TOP_EDGE_OF_TEXT_FIRST',
]);
const allowedLabelRotations = new Set(['LEFT', 'RIGHT', 'UPSIDE_DOWN', 'NONE']);

let cachedToken;

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      mockMode: isMockEnabled(),
      provider: 'fedex',
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/shipments') {
    try {
      const payload = await readJsonBody(request);
      validateShipmentPayload(payload);

      if (isMockEnabled()) {
        sendJson(response, 200, buildMockResponse(payload));
        return;
      }

      const token = await getAccessToken();
      const fedexPayload = buildFedexShipmentPayload(payload);
      const fedexResponse = await fetch(`${getFedexBaseUrl()}/ship/v1/shipments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US',
        },
        body: JSON.stringify(fedexPayload),
      });

      const data = await fedexResponse.json();

      if (!fedexResponse.ok) {
        sendJson(response, fedexResponse.status, {
          message: extractFedexError(data),
          details: data,
        });
        return;
      }

      sendJson(response, 200, normalizeShipmentResponse(data));
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        message: error.message || 'Unexpected server error.',
      });
    }
    return;
  }

  sendJson(response, 404, { message: 'Route not found.' });
});

server.listen(port, host, () => {
  console.log(`FedEx proxy listening on http://${host}:${port}`);
});

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

function validateShipmentPayload(payload) {
  const required = [
    payload?.recipientName,
    payload?.recipientCompany,
    payload?.recipientEmail,
    payload?.recipientPhoneNumber,
    payload?.shippingAddress?.addressLine1,
    payload?.shippingAddress?.city,
    payload?.shippingAddress?.stateOrProvinceCode,
    payload?.shippingAddress?.postalCode,
    payload?.shippingAddress?.countryCode,
    payload?.packaging?.boxType,
    payload?.packaging?.quantity,
  ];

  if (required.some((value) => !value)) {
    const error = new Error('Missing required shipment fields.');
    error.statusCode = 400;
    throw error;
  }
}

function isMockEnabled() {
  return String(process.env.FEDEX_ENABLE_MOCK || 'true') === 'true';
}

function getFedexBaseUrl() {
  return process.env.FEDEX_API_BASE_URL || 'https://apis-sandbox.fedex.com';
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const body = new URLSearchParams({
    grant_type: getGrantType(),
    client_id: requiredEnv('FEDEX_CLIENT_ID'),
    client_secret: requiredEnv('FEDEX_CLIENT_SECRET'),
  });

  if (process.env.FEDEX_CHILD_KEY) {
    body.set('child_key', process.env.FEDEX_CHILD_KEY);
  }

  if (process.env.FEDEX_CHILD_SECRET) {
    body.set('child_secret', process.env.FEDEX_CHILD_SECRET);
  }

  const response = await fetch(`${getFedexBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(extractFedexError(data) || 'Unable to authenticate with FedEx.');
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
  };

  return cachedToken.value;
}

function getGrantType() {
  if (process.env.FEDEX_CHILD_KEY && process.env.FEDEX_CHILD_SECRET) {
    return 'csp_credentials';
  }

  return 'client_credentials';
}

function buildFedexShipmentPayload(payload) {
  const packageCount = Number(payload.packaging.quantity);
  const packageWeight = Number(process.env.FEDEX_PACKAGE_WEIGHT_VALUE || 1);
  const totalWeight = Number((packageCount * packageWeight).toFixed(1));
  const packagingSelection = payload.packaging.boxType;
  const packagingType = resolvePackagingType(packagingSelection);
  const serviceType = resolveServiceType(packagingSelection);
  const pickupType = readEnumEnv(
    'FEDEX_PICKUP_TYPE',
    'USE_SCHEDULED_PICKUP',
    allowedPickupTypes
  );
  const weightUnits = readEnumEnv('FEDEX_WEIGHT_UNITS', 'LB', allowedWeightUnits);
  const labelImageType = readEnumEnv('FEDEX_LABEL_IMAGE_TYPE', 'PDF', allowedLabelImageTypes);
  const labelStockType = readEnumEnv(
    'FEDEX_LABEL_STOCK_TYPE',
    'PAPER_85X11_TOP_HALF_LABEL',
    allowedLabelStockTypes
  );
  const labelFormatType = readEnumEnv(
    'FEDEX_LABEL_FORMAT_TYPE',
    'COMMON2D',
    allowedLabelFormatTypes
  );
  const labelPrintingOrientation = readEnumEnv(
    'FEDEX_LABEL_PRINTING_ORIENTATION',
    'TOP_EDGE_OF_TEXT_FIRST',
    allowedLabelPrintingOrientations
  );
  const labelRotation = readEnumEnv('FEDEX_LABEL_ROTATION', 'NONE', allowedLabelRotations);
  const streetLines = [
    payload.shippingAddress.addressLine1,
    payload.shippingAddress.addressLine2,
  ].filter(Boolean);

  return {
    labelResponseOptions: 'LABEL',
    requestedShipment: {
      shipDatestamp: new Date().toISOString().slice(0, 10),
      pickupType,
      serviceType,
      packagingType,
      totalWeight,
      totalPackageCount: packageCount,
      shipper: {
        contact: {
          personName: process.env.FEDEX_SHIPPER_NAME || 'True Robotics',
          emailAddress: requiredEnv('FEDEX_SHIPPER_EMAIL'),
          phoneNumber: process.env.FEDEX_SHIPPER_PHONE || '9015550100',
        },
        address: {
          streetLines: [
            requiredEnv('FEDEX_SHIPPER_ADDRESS_1'),
            process.env.FEDEX_SHIPPER_ADDRESS_2,
          ].filter(Boolean),
          city: requiredEnv('FEDEX_SHIPPER_CITY'),
          stateOrProvinceCode: requiredEnv('FEDEX_SHIPPER_STATE'),
          postalCode: requiredEnv('FEDEX_SHIPPER_POSTAL_CODE'),
          countryCode: requiredEnv('FEDEX_SHIPPER_COUNTRY_CODE'),
        },
      },
      recipients: [
        {
          contact: {
            personName: payload.recipientName,
            companyName: payload.recipientCompany,
            phoneNumber: payload.recipientPhoneNumber,
            emailAddress: payload.recipientEmail,
          },
          address: {
            streetLines,
            city: payload.shippingAddress.city,
            stateOrProvinceCode: payload.shippingAddress.stateOrProvinceCode,
            postalCode: payload.shippingAddress.postalCode,
            countryCode: payload.shippingAddress.countryCode,
          },
        },
      ],
      shippingChargesPayment: {
        paymentType: 'SENDER',
      },
      labelSpecification: {
        imageType: labelImageType,
        labelStockType,
        labelFormatType,
        ...(labelImageType === 'ZPLII' || labelImageType === 'EPL2'
          ? {
              labelPrintingOrientation,
              labelRotation,
            }
          : {}),
      },
      requestedPackageLineItems: Array.from({ length: packageCount }, (_, index) => ({
        sequenceNumber: index + 1,
        groupPackageCount: 1,
        ...(packagingSelection === '22x16x14'
          ? {
              dimensions: {
                length: 22,
                width: 16,
                height: 14,
                units: 'IN',
              },
            }
          : {}),
        weight: {
          units: weightUnits,
          value: packageWeight,
        },
      })),
    },
    accountNumber: {
      value: requiredEnv('FEDEX_ACCOUNT_NUMBER'),
    },
  };
}

function normalizeShipmentResponse(data) {
  const output = data?.output || {};
  const completedPackage =
    output?.transactionShipments?.[0]?.pieceResponses?.[0] ||
    output?.transactionShipments?.[0]?.completedPackageDetails?.[0];
  const labelDocument = completedPackage?.packageDocuments?.[0] || null;
  const labelDocType = labelDocument?.docType || null;

  return {
    ok: true,
    message: 'Shipment created successfully.',
    trackingNumber: completedPackage?.trackingNumber || null,
    label: labelDocument?.encodedLabel || null,
    labelDocType,
    labelMimeType: resolveLabelMimeType(labelDocType),
    labelFileExtension: resolveLabelFileExtension(labelDocType),
    raw: data,
  };
}

function buildMockResponse(payload) {
  return {
    ok: true,
    message: `Mock shipment created for ${payload.recipientEmail}.`,
    trackingNumber: 'MOCK123456789',
    labelDocType: 'PDF',
    labelMimeType: 'application/pdf',
    labelFileExtension: 'pdf',
    raw: payload,
  };
}

function resolveLabelMimeType(docType) {
  switch (docType) {
    case 'PNG':
      return 'image/png';
    case 'PDF':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function resolveLabelFileExtension(docType) {
  switch (docType) {
    case 'PNG':
      return 'png';
    case 'PDF':
      return 'pdf';
    default:
      return 'bin';
  }
}

function extractFedexError(data) {
  return (
    data?.errors?.map((item) => item.message).filter(Boolean).join(' ') ||
    data?.message ||
    'FedEx request failed.'
  );
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readEnumEnv(name, fallback, allowedValues) {
  const value = (process.env[name] || fallback || '').trim();

  if (!allowedValues.has(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return value;
}

function resolvePackagingType(boxType) {
  if (boxType === 'FEDEX_LARGE_PAK') {
    return 'FEDEX_PAK';
  }

  return 'YOUR_PACKAGING';
}

function resolveServiceType(boxType) {
  if (boxType === 'FEDEX_LARGE_PAK') {
    return 'FEDEX_EXPRESS_SAVER';
  }

  return 'FEDEX_GROUND';
}

function loadLocalEnvFile() {
  const envPath = resolve(process.cwd(), '.env.server');

  if (!existsSync(envPath)) {
    return;
  }

  const file = readFileSync(envPath, 'utf8');

  for (const line of file.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
