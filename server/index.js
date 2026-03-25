import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { serverConfig } from '../app.config.js';

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

function getGrantType() {
  if (process.env.FEDEX_CHILD_KEY && process.env.FEDEX_CHILD_SECRET) {
    return 'csp_credentials';
  }

  return 'client_credentials';
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
  const normalizedLabel = await buildCombinedPdf(labelDocuments);

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
    label: normalizedLabel?.encodedLabel || null,
    labelDocType: 'PDF',
    labelMimeType: 'application/pdf',
    labelFileExtension: 'pdf',
    combinedLabelAvailable: Boolean(normalizedLabel),
    labelCount: normalizedLabel?.pageCount || labelDocuments.length,
    labelDiagnostics,
    labels: normalizedLabel
      ? [
          {
            trackingNumber: completedPackages[0]?.trackingNumber || null,
            label: normalizedLabel.encodedLabel,
            labelDocType: 'PDF',
            labelMimeType: 'application/pdf',
            labelFileExtension: 'pdf',
          },
        ]
      : [],
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

async function buildCombinedPdf(labelDocuments) {
  if (!labelDocuments.length) {
    return null;
  }

  if (labelDocuments.length === 1 && labelDocuments[0]?.docType === 'PDF') {
    const singlePdf = await PDFDocument.load(Buffer.from(labelDocuments[0].encodedLabel, 'base64'));

    return {
      encodedLabel: labelDocuments[0].encodedLabel,
      pageCount: singlePdf.getPageCount(),
    };
  }

  const combinedPdf = await PDFDocument.create();

  for (const document of labelDocuments) {
    if (!document?.encodedLabel) {
      continue;
    }

    if (document.docType === 'PDF') {
      await appendPdfPages(combinedPdf, document.encodedLabel);
      continue;
    }

    if (document.docType === 'PNG') {
      await appendPngPage(combinedPdf, document.encodedLabel);
    }
  }

  if (!combinedPdf.getPageCount()) {
    return null;
  }

  const pdfBytes = await combinedPdf.save();

  return {
    encodedLabel: Buffer.from(pdfBytes).toString('base64'),
    pageCount: combinedPdf.getPageCount(),
  };
}

async function appendPdfPages(targetPdf, encodedLabel) {
  const sourcePdf = await PDFDocument.load(Buffer.from(encodedLabel, 'base64'));
  const pageIndices = sourcePdf.getPageIndices();
  const copiedPages = await targetPdf.copyPages(sourcePdf, pageIndices);

  for (const copiedPage of copiedPages) {
    targetPdf.addPage(copiedPage);
  }
}

async function appendPngPage(targetPdf, encodedLabel) {
  const pngImage = await targetPdf.embedPng(Buffer.from(encodedLabel, 'base64'));
  const { width, height } = fitWithinThermalPage(pngImage.width, pngImage.height);
  const targetPage = targetPdf.addPage([4 * 72, 6 * 72]);

  targetPage.drawImage(pngImage, {
    x: ((4 * 72) - width) / 2,
    y: ((6 * 72) - height) / 2,
    width,
    height,
  });
}

function resolveFedexLabelImageType(requestedLabelImageType) {
  if (requestedLabelImageType === 'PDF') {
    return 'PNG';
  }

  return requestedLabelImageType;
}

function fitWithinThermalPage(sourceWidth, sourceHeight) {
  const pageWidth = 4 * 72;
  const pageHeight = 6 * 72;
  const scale = Math.min(pageWidth / sourceWidth, pageHeight / sourceHeight);

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  };
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

    if (document.docType === 'PDF') {
      try {
        const pdf = await PDFDocument.load(Buffer.from(document.encodedLabel, 'base64'));

        entry.pageCount = pdf.getPageCount();
        entry.pages = pdf.getPages().map((page, pageIndex) => {
          const { width, height } = page.getSize();
          return {
            pageIndex,
            width,
            height,
            widthInches: Number((width / 72).toFixed(3)),
            heightInches: Number((height / 72).toFixed(3)),
          };
        });
      } catch (error) {
        entry.inspectError = error.message;
      }
    } else if (document.docType === 'PNG') {
      entry.note = 'PNG label returned; page size derived at render time.';
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
  const envPath = resolve(process.cwd(), '.env');

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
