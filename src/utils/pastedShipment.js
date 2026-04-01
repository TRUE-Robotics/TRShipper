export const pastedShipmentStorageKey = 'tr-shipper-pasted-shipment';

export function parsePastedShipmentInput(rawInput) {
  const input = String(rawInput || '').trim().replace(/\s+/g, ' ');

  if (!input) {
    throw new Error('Paste the shipment text first.');
  }

  const phoneMatch = input.match(/(\+?[\d()\-\s]{10,})$/);

  if (!phoneMatch) {
    throw new Error('Could not find a phone number at the end of the pasted text.');
  }

  const phoneNumber = phoneMatch[1].trim();
  const withoutPhone = input.slice(0, phoneMatch.index).trim();
  const emailMatch = withoutPhone.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})$/i);

  if (!emailMatch) {
    throw new Error('Could not find an email address in the pasted text.');
  }

  const email = emailMatch[1].trim();
  const withoutEmail = withoutPhone.slice(0, emailMatch.index).trim();
  const attnMarker = ' Attn: ';
  const attnIndex = withoutEmail.indexOf(attnMarker);

  if (attnIndex === -1) {
    throw new Error('Could not find "Attn:" in the pasted text.');
  }

  const recipientCompany = withoutEmail.slice(0, attnIndex).trim();
  const afterAttn = withoutEmail.slice(attnIndex + attnMarker.length).trim();
  const zipMatch = afterAttn.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

  if (!zipMatch) {
    throw new Error('Could not find a trailing state and ZIP code.');
  }

  const stateOrProvinceCode = zipMatch[1];
  const postalCode = zipMatch[2];
  const beforeStateZip = afterAttn.slice(0, zipMatch.index).trim();
  const streetTypePattern =
    /\b\d+\s+.+?\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Parkway|Pkwy|Place|Pl|Trail|Trl|Terrace|Ter)\b\.?/i;
  const streetMatch = beforeStateZip.match(streetTypePattern);

  if (!streetMatch || streetMatch.index === undefined) {
    throw new Error('Could not identify the street address in the pasted text.');
  }

  const recipientName = beforeStateZip.slice(0, streetMatch.index).trim();
  const remainingAddress = beforeStateZip.slice(streetMatch.index).trim();
  const lastSpaceIndex = remainingAddress.lastIndexOf(' ');

  if (lastSpaceIndex === -1) {
    throw new Error('Could not identify the city in the pasted text.');
  }

  const addressLine1 = remainingAddress.slice(0, lastSpaceIndex).trim();
  const city = remainingAddress.slice(lastSpaceIndex + 1).trim();

  if (!recipientCompany || !recipientName || !addressLine1 || !city) {
    throw new Error('The pasted text is missing one or more required fields.');
  }

  return {
    recipientName,
    recipientCompany,
    email,
    phoneNumber,
    addressLine1,
    addressLine2: '',
    city,
    stateOrProvinceCode,
    postalCode,
    countryCode: 'US',
  };
}

export function savePastedShipmentDraft(payload) {
  window.sessionStorage.setItem(pastedShipmentStorageKey, JSON.stringify(payload));
}

export function consumePastedShipmentDraft() {
  const raw = window.sessionStorage.getItem(pastedShipmentStorageKey);

  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(pastedShipmentStorageKey);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
