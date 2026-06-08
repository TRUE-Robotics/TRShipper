import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { serverConfig } from '../app.config.js';

const localEnvPath = serverConfig.env_path;

loadLocalEnvFile();

const port = serverConfig.port;
const host = serverConfig.host;
const allowedOrigin = serverConfig.allowedOrigin;
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
      const validatedShippingAddress = await validateShippingAddress(token, payload.shippingAddress);
      const fedexPayload = buildFedexShipmentPayload({
        ...payload,
        shippingAddress: validatedShippingAddress,
      });
      const fedexRequestBody = JSON.stringify(fedexPayload);

      maybeLogShipApiPayload(fedexRequestBody);

      const fedexResponse = await fetch(`${getFedexBaseUrl()}/ship/v1/shipments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_US',
        },
        body: fedexRequestBody,
      });

      const data = await fedexResponse.json();

      if (!fedexResponse.ok) {
        sendJson(response, fedexResponse.status, {
          message: extractFedexError(data),
          details: data,
        });
        return;
      }

      sendJson(response, 200, await normalizeShipmentResponse(data, fedexPayload));
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
  return serverConfig.fedexEnableMock;
}

function getFedexBaseUrl() {
  return serverConfig.fedexApiBaseUrl;
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

async function validateShippingAddress(token, address) {
  const requestPayload = {
    addressesToValidate: [
      {
        address: {
          streetLines: [address.addressLine1, address.addressLine2].filter(Boolean),
          city: address.city,
          stateOrProvinceCode: address.stateOrProvinceCode,
          postalCode: address.postalCode,
          countryCode: address.countryCode,
        },
      },
    ],
  };

  const response = await fetch(`${getFedexBaseUrl()}/address/v1/addresses/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-locale': 'en_US',
    },
    body: JSON.stringify(requestPayload),
  });

  const data = await response.json();
  maybeLogAddressValidationDiagnostics({
    requestAddress: address,
    requestPayload,
    responseStatus: response.status,
    responseOk: response.ok,
    responseBody: data,
  });

  if (!response.ok) {
    throw new Error(extractFedexError(data) || 'FedEx address validation failed.');
  }

  if (isVirtualAddressValidationResponse(data)) {
    return address;
  }

  const resolvedAddress = extractFedexValidatedAddress(data, address);

  if (!resolvedAddress) {
    throw new Error('FedEx could not validate the shipping address.');
  }

  return resolvedAddress;
}

function buildFedexShipmentPayload(payload) {
  const packageCount = Number(payload.packaging.quantity);
  const packageWeight = Number(serverConfig.packageWeightValue);
  const totalWeight = Number((packageCount * packageWeight).toFixed(1));
  const packagingSelection = payload.packaging.boxType;
  const packagingType = resolvePackagingType(packagingSelection);
  const serviceType = resolveServiceType(packagingSelection);
  const pickupType = readConfiguredEnum(serverConfig.pickupType, allowedPickupTypes, 'pickupType');
  const weightUnits = readConfiguredEnum(serverConfig.weightUnits, allowedWeightUnits, 'weightUnits');
  const requestedLabelImageType = readConfiguredEnum(
    serverConfig.labelImageType,
    allowedLabelImageTypes,
    'labelImageType'
  );
  const labelImageType = resolveFedexLabelImageType(requestedLabelImageType);
  const labelStockType = resolveLabelStockType(labelImageType);
  const labelFormatType = readConfiguredEnum(
    serverConfig.labelFormatType,
    allowedLabelFormatTypes,
    'labelFormatType'
  );
  const labelPrintingOrientation = readConfiguredEnum(
    'TOP_EDGE_OF_TEXT_FIRST',
    allowedLabelPrintingOrientations,
    'labelPrintingOrientation'
  );
  const labelRotation = readConfiguredEnum('NONE', allowedLabelRotations, 'labelRotation');
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
          personName: serverConfig.shipperName,
          emailAddress: serverConfig.shipperEmail,
          phoneNumber: serverConfig.shipperPhone,
        },
        address: {
          streetLines: [
            serverConfig.shipperAddress1,
            serverConfig.shipperAddress2,
          ].filter(Boolean),
          city: serverConfig.shipperCity,
          stateOrProvinceCode: serverConfig.shipperState,
          postalCode: serverConfig.shipperPostalCode,
          countryCode: serverConfig.shipperCountryCode,
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

async function normalizeShipmentResponse(data, fedexPayload = null) {
  const output = data?.output || {};
  const transactionShipments = output?.transactionShipments || [];
  const completedPackages = collectCompletedPackages(transactionShipments);
  const labelDocuments = collectLabelDocuments(transactionShipments, completedPackages);
  const labelDiagnostics = await inspectLabelDocuments(labelDocuments);
  const normalizedLabel = await buildCombinedLabelBuffer(labelDocuments);
  const hasCombinedLabel = Boolean(normalizedLabel?.encodedLabel);
  const normalizedLabelDocType = hasCombinedLabel ? normalizedLabel?.docType || null : null;
  const normalizedLabels = labelDocuments.map((document, index) => ({
    trackingNumber: document?.trackingNumber || completedPackages[index]?.trackingNumber || null,
    label: document?.encodedLabel || null,
    labelDocType: document?.docType || null,
    labelMimeType: resolveLabelMimeType(document?.docType || null),
    labelFileExtension: resolveLabelFileExtension(document?.docType || null),
  }));

  maybeLogLabelDiagnostics({
    requestLabelSpecification: fedexPayload?.requestedShipment?.labelSpecification || null,
    packageCount: completedPackages.length,
    labelDocumentCount: labelDocuments.length,
    labelDiagnostics,
  });

  return {
    ok: true,
    message: 'Shipment created successfully.',
    trackingNumber: completedPackages[0]?.trackingNumber || null,
    label: hasCombinedLabel ? normalizedLabel.encodedLabel : null,
    labelDocType: normalizedLabelDocType,
    labelMimeType: resolveLabelMimeType(normalizedLabelDocType),
    labelFileExtension: resolveLabelFileExtension(normalizedLabelDocType),
    combinedLabelAvailable: hasCombinedLabel,
    labelCount: hasCombinedLabel ? normalizedLabel?.pageCount || labelDocuments.length : labelDocuments.length,
    labelDiagnostics,
    labels: hasCombinedLabel
      ? [
          {
            trackingNumber: completedPackages[0]?.trackingNumber || null,
            label: normalizedLabel.encodedLabel,
            labelDocType: normalizedLabelDocType,
            labelMimeType: resolveLabelMimeType(normalizedLabelDocType),
            labelFileExtension: resolveLabelFileExtension(normalizedLabelDocType),
          },
        ]
      : normalizedLabels,
    raw: data,
  };
}

function buildMockResponse(payload) {
  const labelDocType = serverConfig.labelImageType;

  return {
    ok: true,
    message: `Mock shipment created for ${payload.recipientEmail}.`,
    trackingNumber: 'MOCK123456789',
    labelDocType,
    labelMimeType: resolveLabelMimeType(labelDocType),
    labelFileExtension: resolveLabelFileExtension(labelDocType),
    raw: payload,
  };
}

function getGrantType() {
  if (process.env.FEDEX_CHILD_KEY && process.env.FEDEX_CHILD_SECRET) {
    return 'csp_credentials';
  }

  return 'client_credentials';
}

function resolveLabelMimeType(docType) {
  switch (docType) {
    case 'PNG':
      return 'image/png';
    case 'PDF':
      return 'application/pdf';
    case 'ZPLII':
    case 'EPL2':
      return 'text/plain; charset=utf-8';
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
    case 'ZPLII':
      return 'zpl';
    case 'EPL2':
      return 'epl';
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

function extractFedexValidatedAddress(data, originalAddress = null) {
  const resolvedAddress =
    data?.output?.resolvedAddresses?.[0] ||
    data?.output?.resolvedAddresses?.[0]?.address ||
    data?.resolvedAddresses?.[0] ||
    null;

  const address =
    resolvedAddress?.address ||
    resolvedAddress?.resolvedAddress ||
    resolvedAddress;

  const streetLines =
    address?.streetLines ||
    address?.streetLinesToken ||
    address?.streetLine ||
    address?.deliveryPointAddress ||
    [];

  const normalizedStreetLines = Array.isArray(streetLines)
    ? streetLines.filter(Boolean)
    : [streetLines].filter(Boolean);

  const postalCode =
    address?.postalCode ||
    [address?.postalCode, address?.parsedPostalCode?.base, address?.parsedPostalCode?.addOn]
      .filter(Boolean)
      .join('-');

  if (!normalizedStreetLines.length || !address?.city || !address?.stateOrProvinceCode) {
    return null;
  }

  return {
    addressLine1: normalizedStreetLines[0],
    addressLine2:
      normalizedStreetLines.slice(1).join(', ') || originalAddress?.addressLine2 || '',
    city: address.city,
    stateOrProvinceCode: address.stateOrProvinceCode,
    postalCode: postalCode || '',
    countryCode: address.countryCode || 'US',
  };
}

function isVirtualAddressValidationResponse(data) {
  const alerts = data?.output?.alerts || [];

  return alerts.some(
    (alert) =>
      alert?.code === 'VIRTUAL.RESPONSE' ||
      String(alert?.message || '').includes('Virtual Response')
  );
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readConfiguredEnum(value, allowedValues, label) {
  const normalizedValue = String(value || '').trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`Invalid ${label}: ${normalizedValue}`);
  }

  return normalizedValue;
}

function resolveLabelStockType(labelImageType) {
  const configuredValue = String(serverConfig.labelStockType || '').trim();

  if (configuredValue) {
    return readConfiguredEnum(configuredValue, allowedLabelStockTypes, 'labelStockType');
  }

  if (labelImageType === 'PDF' || labelImageType === 'PNG') {
    return 'PAPER_4X6';
  }

  return 'STOCK_4X6';
}

function collectCompletedPackages(transactionShipments) {
  return transactionShipments.flatMap((shipment) => {
    return shipment?.pieceResponses?.length
      ? shipment.pieceResponses
      : shipment?.completedPackageDetails || [];
  });
}

function collectLabelDocuments(transactionShipments, completedPackages) {
  const shipmentDocuments = transactionShipments.flatMap((shipment) =>
    (shipment?.shipmentDocuments || [])
      .filter((document) => document?.encodedLabel)
      .map((document) => ({
        ...document,
        scope: 'shipment',
      }))
  );

  const packageDocuments = completedPackages.flatMap((pkg) =>
    (pkg?.packageDocuments || [])
      .filter((document) => document?.encodedLabel)
      .map((document) => ({
        ...document,
        trackingNumber: pkg?.trackingNumber || null,
        scope: 'package',
      }))
  );

  const uniqueDocuments = [];
  const seen = new Set();

  for (const document of [...shipmentDocuments, ...packageDocuments]) {
    const key = `${document.docType || ''}:${document.encodedLabel}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueDocuments.push(document);
  }

  return uniqueDocuments;
}

async function buildCombinedLabelBuffer(labelDocuments) {
  if (!labelDocuments.length) {
    return null;
  }

  const uniqueDocTypes = [...new Set(labelDocuments.map((document) => document?.docType).filter(Boolean))];

  if (uniqueDocTypes.length !== 1) {
    return labelDocuments[0]
      ? {
          encodedLabel: labelDocuments[0].encodedLabel,
          pageCount: 1,
          docType: labelDocuments[0].docType || null,
        }
      : null;
  }

  const docType = uniqueDocTypes[0];

  if (docType === 'PDF') {
    if (labelDocuments.length === 1) {
      return {
        encodedLabel: labelDocuments[0].encodedLabel,
        pageCount: 1,
        docType,
      };
    }

    const combinedPdf = await PDFDocument.create();

    for (const document of labelDocuments) {
      const sourcePdf = await PDFDocument.load(Buffer.from(document.encodedLabel, 'base64'));
      const copiedPages = await combinedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());

      copiedPages.forEach((page) => combinedPdf.addPage(page));
    }

    const pdfBytes = await combinedPdf.save();

    return {
      encodedLabel: Buffer.from(pdfBytes).toString('base64'),
      pageCount: labelDocuments.length,
      docType,
    };
  }

  if (docType === 'PNG') {
    const combinedPdf = await PDFDocument.create();

    for (const document of labelDocuments) {
      const pngBytes = Buffer.from(document.encodedLabel, 'base64');
      const embeddedPng = await combinedPdf.embedPng(pngBytes);
      const page = combinedPdf.addPage([4 * 72, 6 * 72]);
      const scale = Math.min(page.getWidth() / embeddedPng.width, page.getHeight() / embeddedPng.height);
      const drawWidth = embeddedPng.width * scale;
      const drawHeight = embeddedPng.height * scale;

      page.drawImage(embeddedPng, {
        x: (page.getWidth() - drawWidth) / 2,
        y: (page.getHeight() - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight,
      });
    }

    const pdfBytes = await combinedPdf.save();

    return {
      encodedLabel: Buffer.from(pdfBytes).toString('base64'),
      pageCount: labelDocuments.length,
      docType: 'PDF',
    };
  }

  if (labelDocuments.length === 1) {
    return {
      encodedLabel: labelDocuments[0].encodedLabel,
      pageCount: 1,
      docType,
    };
  }

  return {
    encodedLabel: null,
    pageCount: labelDocuments.length,
    docType: null,
  };
}

function resolveFedexLabelImageType(requestedLabelImageType) {
  return requestedLabelImageType;
}

async function inspectLabelDocuments(labelDocuments) {
  const diagnostics = [];

  for (const [index, document] of labelDocuments.entries()) {
    const entry = {
      index,
      docType: document?.docType || null,
      trackingNumber: document?.trackingNumber || null,
    };

    if (!document?.encodedLabel) {
      diagnostics.push(entry);
      continue;
    }

    if (document.docType === 'PNG') {
      entry.note = 'PNG label returned.';
    } else if (document.docType === 'PDF') {
      entry.note = 'PDF label returned.';
    } else if (document.docType === 'ZPLII' || document.docType === 'EPL2') {
      entry.preview = Buffer.from(document.encodedLabel, 'base64').toString('utf8').slice(0, 200);
    }

    diagnostics.push(entry);
  }

  return diagnostics;
}

function maybeLogLabelDiagnostics(payload) {
  if (!serverConfig.debugLabels) {
    return;
  }

  console.log('[FEDEX_LABEL_DEBUG]', JSON.stringify(payload, null, 2));
}

function maybeLogAddressValidationDiagnostics(payload) {
  if (!serverConfig.debugLabels) {
    return;
  }

  console.log('[FEDEX_ADDRESS_VALIDATION_DEBUG]', JSON.stringify(payload, null, 2));
}

function maybeLogShipApiPayload(requestBody) {
  if (!serverConfig.debugLabels) {
    return;
  }

  console.log('[FEDEX_SHIP_API_PAYLOAD]', JSON.stringify(JSON.parse(requestBody), null, 2));
}

function resolvePackagingType(boxType) {
  if (boxType === 'FEDEX_MEDIUM_BOX') {
    return 'FEDEX_MEDIUM_BOX';
  }

  if (boxType === 'FEDEX_LARGE_BOX') {
    return 'FEDEX_LARGE_BOX';
  }

  if (boxType === 'FEDEX_LARGE_PAK') {
    return 'FEDEX_PAK';
  }

  return 'YOUR_PACKAGING';
}

function resolveServiceType(boxType) {
  if (
    boxType === 'FEDEX_MEDIUM_BOX' ||
    boxType === 'FEDEX_LARGE_BOX' ||
    boxType === 'FEDEX_LARGE_PAK'
  ) {
    return 'FEDEX_EXPRESS_SAVER';
  }

  return 'FEDEX_GROUND';
}

function loadLocalEnvFile() {
  const envPath = localEnvPath;

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
