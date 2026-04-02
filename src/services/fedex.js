import { frontendConfig } from '../../app.config.js';

export const boxOptions = [
  { value: '22x16x14', label: '22x16x14 Box' },
  { value: 'FEDEX_MEDIUM_BOX', label: 'FedEx Medium Box' },
  { value: 'FEDEX_LARGE_BOX', label: 'FedEx Large Box' },
  { value: 'FEDEX_LARGE_PAK', label: 'FedEx Large Pak' },
];

export async function createShipmentRequest(payload) {
  const apiBaseUrl = frontendConfig.apiBaseUrl;
  const mockEnabled = frontendConfig.enableMockSubmission;

  if (mockEnabled) {
    await new Promise((resolve) => window.setTimeout(resolve, 700));

    return {
      ok: true,
      message: `Mock shipment created for ${payload.recipientEmail}.`,
      payload,
    };
  }

  if (!apiBaseUrl) {
    throw new Error('Missing frontendConfig.apiBaseUrl. Point it at your FedEx proxy/backend.');
  }

  const response = await fetch(`${apiBaseUrl}/shipments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return response.json();
}

async function readErrorMessage(response) {
  try {
    const body = await response.json();
    return body.message || 'FedEx shipment request failed.';
  } catch {
    return 'FedEx shipment request failed.';
  }
}
