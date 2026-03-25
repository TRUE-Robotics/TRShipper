<script setup>
import { reactive, ref, watch } from 'vue';
import { boxOptions, createShipmentRequest } from '../services/fedex.js';
import { searchAddressSuggestions } from '../services/addressAutocomplete.js';

const form = reactive({
  recipientName: '',
  recipientCompany: '',
  email: '',
  phoneNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateOrProvinceCode: '',
  postalCode: '',
  countryCode: 'US',
  boxType: boxOptions[0].value,
  quantity: 1,
});

const addressQuery = ref('');
const suggestions = ref([]);
const isSearching = ref(false);
const isSubmitting = ref(false);
const status = ref({
  tone: '',
  message: '',
});
const shipmentResult = ref({
  trackingNumber: '',
  label: '',
  combinedLabelAvailable: false,
  labelCount: 0,
  labels: [],
  labelMimeType: 'application/pdf',
  labelFileExtension: 'pdf',
});
const fieldErrors = reactive({
  recipientName: '',
  recipientCompany: '',
  email: '',
  phoneNumber: '',
  addressLine1: '',
  city: '',
  stateOrProvinceCode: '',
  postalCode: '',
  countryCode: '',
  boxType: '',
  quantity: '',
});

let searchTimeoutId;
let skipNextAddressSearch = false;

watch(
  () => addressQuery.value,
  (value) => {
    clearTimeout(searchTimeoutId);

    if (skipNextAddressSearch) {
      skipNextAddressSearch = false;
      suggestions.value = [];
      return;
    }

    if (!value || value.trim().length < 5) {
      suggestions.value = [];
      return;
    }

    searchTimeoutId = window.setTimeout(async () => {
      isSearching.value = true;

      try {
        suggestions.value = await searchAddressSuggestions(value);
      } catch (error) {
        status.value = {
          tone: 'error',
          message: error.message || 'Address lookup failed.',
        };
      } finally {
        isSearching.value = false;
      }
    }, 350);
  }
);

const requiredFieldLabels = {
  recipientName: 'Recipient Name',
  recipientCompany: 'Recipient Company',
  email: 'Email',
  phoneNumber: 'Recipient Phone',
  addressLine1: 'Address Line 1',
  city: 'City',
  stateOrProvinceCode: 'State',
  postalCode: 'ZIP Code',
  countryCode: 'Country',
  boxType: 'Box Type',
  quantity: 'Quantity',
};

function applySuggestion(suggestion) {
  form.addressLine1 = suggestion.addressLine1;
  form.city = suggestion.city;
  form.stateOrProvinceCode = suggestion.stateOrProvinceCode;
  form.postalCode = suggestion.postalCode;
  form.countryCode = suggestion.countryCode || 'US';
  skipNextAddressSearch = true;
  addressQuery.value = suggestion.label;
  suggestions.value = [];
}

async function handleSubmit() {
  if (!validateRequiredFields()) {
    status.value = {
      tone: 'error',
      message: 'Please complete all required fields marked with an asterisk.',
    };
    return;
  }

  isSubmitting.value = true;
  status.value = {
    tone: '',
    message: '',
  };
  shipmentResult.value = {
    trackingNumber: '',
    label: '',
    combinedLabelAvailable: false,
    labelCount: 0,
    labels: [],
    labelMimeType: 'application/pdf',
    labelFileExtension: 'pdf',
  };

  try {
    const response = await createShipmentRequest({
      recipientName: form.recipientName,
      recipientCompany: form.recipientCompany,
      recipientEmail: form.email,
      recipientPhoneNumber: form.phoneNumber,
      shippingAddress: {
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        stateOrProvinceCode: form.stateOrProvinceCode,
        postalCode: form.postalCode,
        countryCode: form.countryCode,
      },
      packaging: {
        boxType: form.boxType,
        quantity: Number(form.quantity),
      },
    });

    status.value = {
      tone: 'success',
      message: response.message || 'Shipment request created successfully.',
    };
    shipmentResult.value = {
      trackingNumber: response.trackingNumber || '',
      label: response.label || '',
      combinedLabelAvailable: Boolean(response.combinedLabelAvailable),
      labelCount: response.labelCount || 0,
      labels: response.labels || [],
      labelMimeType: response.labelMimeType || 'application/pdf',
      labelFileExtension: response.labelFileExtension || 'pdf',
    };
  } catch (error) {
    status.value = {
      tone: 'error',
      message: error.message || 'Shipment request failed.',
    };
  } finally {
    isSubmitting.value = false;
  }
}

function validateRequiredFields() {
  let hasError = false;

  for (const [field, label] of Object.entries(requiredFieldLabels)) {
    const value = form[field];
    const isEmpty =
      typeof value === 'number'
        ? Number.isNaN(value) || value <= 0
        : !String(value ?? '').trim();

    fieldErrors[field] = isEmpty ? `${label} is required.` : '';

    if (fieldErrors[field]) {
      hasError = true;
    }
  }

  return !hasError;
}

function clearFieldError(field) {
  fieldErrors[field] = '';
}

function inputClasses(field) {
  return {
    'input-invalid': Boolean(fieldErrors[field]),
  };
}

function base64ToBlob(base64, mimeType) {
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

function downloadLabel() {
  if (!shipmentResult.value.label) {
    return;
  }

  const blob = base64ToBlob(shipmentResult.value.label, shipmentResult.value.labelMimeType);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `fedex-label-${shipmentResult.value.trackingNumber || 'shipment'}.${shipmentResult.value.labelFileExtension || 'bin'}`;
  link.click();

  URL.revokeObjectURL(url);
}

function openLabel() {
  if (!shipmentResult.value.label) {
    return;
  }

  const blob = base64ToBlob(shipmentResult.value.label, shipmentResult.value.labelMimeType);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

function triggerLabelDownload(label, index = 0) {
  const blob = base64ToBlob(label.label, label.labelMimeType);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const trackingNumber =
    label.trackingNumber || shipmentResult.value.trackingNumber || `shipment-${index + 1}`;

  link.href = url;
  link.download = `fedex-label-${trackingNumber}.${label.labelFileExtension || 'bin'}`;
  link.click();

  URL.revokeObjectURL(url);
}

function openLabelFile(label) {
  const blob = base64ToBlob(label.label, label.labelMimeType);
  const url = URL.createObjectURL(blob);

  window.open(url, '_blank', 'noopener,noreferrer');

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
}

function downloadAllLabels() {
  shipmentResult.value.labels.forEach((label, index) => {
    triggerLabelDownload(label, index);
  });
}

function openAllLabels() {
  shipmentResult.value.labels.forEach((label) => {
    openLabelFile(label);
  });
}

function multipleSeparateLabels() {
  return shipmentResult.value.labels.length > 1 && !shipmentResult.value.combinedLabelAvailable;
}
</script>

<template>
  <section class="form-card">
    <div class="section-heading">
      <div>
        <p class="section-label">Shipment Request</p>
        <h2>Recipient + Package Details</h2>
      </div>
      <span class="status-chip">Work In Progress</span>
    </div>

    <form class="shipping-form" @submit.prevent="handleSubmit">
      <label>
        <span class="field-label">Recipient Name <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.recipientName"
          :class="inputClasses('recipientName')"
          type="text"
          placeholder="Jane Doe"
          @input="clearFieldError('recipientName')"
        />
        <small v-if="fieldErrors.recipientName" class="field-error">{{ fieldErrors.recipientName }}</small>
      </label>

      <label>
        <span class="field-label">Recipient Company <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.recipientCompany"
          :class="inputClasses('recipientCompany')"
          type="text"
          placeholder="Acme Inc."
          @input="clearFieldError('recipientCompany')"
        />
        <small v-if="fieldErrors.recipientCompany" class="field-error">{{ fieldErrors.recipientCompany }}</small>
      </label>

      <label>
        <span class="field-label">Email <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.email"
          :class="inputClasses('email')"
          type="email"
          placeholder="name@example.com"
          @input="clearFieldError('email')"
        />
        <small v-if="fieldErrors.email" class="field-error">{{ fieldErrors.email }}</small>
      </label>

      <label>
        <span class="field-label">Recipient Phone <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.phoneNumber"
          :class="inputClasses('phoneNumber')"
          type="tel"
          placeholder="9015550123"
          @input="clearFieldError('phoneNumber')"
        />
        <small v-if="fieldErrors.phoneNumber" class="field-error">{{ fieldErrors.phoneNumber }}</small>
      </label>

      <label class="full-width autocomplete-field">
        Shipping Address Search
        <input
          v-model.trim="addressQuery"
          type="text"
          placeholder="Start typing an address"
          autocomplete="off"
        />
        <small>Typing 5+ characters will fetch suggestions and fill the address fields.</small>

        <ul v-if="suggestions.length" class="suggestions-list">
          <li v-for="suggestion in suggestions" :key="suggestion.label">
            <button type="button" @click="applySuggestion(suggestion)">
              {{ suggestion.label }}
            </button>
          </li>
        </ul>

        <small v-else-if="isSearching">Searching addresses…</small>
      </label>

      <label class="full-width">
        <span class="field-label">Address Line 1 <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.addressLine1"
          :class="inputClasses('addressLine1')"
          type="text"
          placeholder="123 Main St"
          @input="clearFieldError('addressLine1')"
        />
        <small v-if="fieldErrors.addressLine1" class="field-error">{{ fieldErrors.addressLine1 }}</small>
      </label>

      <label class="full-width">
        <span class="field-label">Address Line 2</span>
        <input
          v-model.trim="form.addressLine2"
          type="text"
          placeholder="Suite, unit, etc."
        />
      </label>

      <label>
        <span class="field-label">City <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.city"
          :class="inputClasses('city')"
          type="text"
          placeholder="Memphis"
          @input="clearFieldError('city')"
        />
        <small v-if="fieldErrors.city" class="field-error">{{ fieldErrors.city }}</small>
      </label>

      <label>
        <span class="field-label">State <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.stateOrProvinceCode"
          :class="inputClasses('stateOrProvinceCode')"
          type="text"
          maxlength="2"
          placeholder="TN"
          @input="clearFieldError('stateOrProvinceCode')"
        />
        <small v-if="fieldErrors.stateOrProvinceCode" class="field-error">{{ fieldErrors.stateOrProvinceCode }}</small>
      </label>

      <label>
        <span class="field-label">ZIP Code <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.postalCode"
          :class="inputClasses('postalCode')"
          type="text"
          placeholder="38116"
          @input="clearFieldError('postalCode')"
        />
        <small v-if="fieldErrors.postalCode" class="field-error">{{ fieldErrors.postalCode }}</small>
      </label>

      <label>
        <span class="field-label">Country <span class="required-mark">*</span></span>
        <input
          v-model.trim="form.countryCode"
          :class="inputClasses('countryCode')"
          type="text"
          maxlength="2"
          placeholder="US"
          @input="clearFieldError('countryCode')"
        />
        <small v-if="fieldErrors.countryCode" class="field-error">{{ fieldErrors.countryCode }}</small>
      </label>

      <label>
        <span class="field-label">Box Type <span class="required-mark">*</span></span>
        <select v-model="form.boxType" :class="inputClasses('boxType')" @change="clearFieldError('boxType')">
          <option v-for="option in boxOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <small v-if="fieldErrors.boxType" class="field-error">{{ fieldErrors.boxType }}</small>
      </label>

      <label>
        <span class="field-label">Quantity <span class="required-mark">*</span></span>
        <input
          v-model="form.quantity"
          :class="inputClasses('quantity')"
          type="number"
          min="1"
          step="1"
          @input="clearFieldError('quantity')"
        />
        <small v-if="fieldErrors.quantity" class="field-error">{{ fieldErrors.quantity }}</small>
      </label>

      <div class="full-width form-actions">
        <button :disabled="isSubmitting" type="submit">
          {{ isSubmitting ? 'Submitting…' : 'Create Shipment' }}
        </button>

        <p v-if="status.message" :class="['form-status', status.tone]">
          {{ status.message }}
        </p>

        <div v-if="shipmentResult.trackingNumber" class="shipment-result">
          <p class="tracking-number">
            Tracking Number: <strong>{{ shipmentResult.trackingNumber }}</strong>
          </p>

          <p v-if="multipleSeparateLabels()" class="label-note">
            {{ shipmentResult.labels.length }} separate label files were returned for this shipment, so the buttons below will open or download every label instead of only the first one.
          </p>

          <div v-if="shipmentResult.label && !multipleSeparateLabels()" class="label-actions">
            <button type="button" class="secondary-button" @click="downloadLabel">
              Download Label
            </button>
            <button type="button" class="secondary-button" @click="openLabel">
              Open Label
            </button>
          </div>

          <div v-else-if="multipleSeparateLabels()" class="label-actions">
            <button type="button" class="secondary-button" @click="downloadAllLabels">
              Download All Labels
            </button>
            <button type="button" class="secondary-button" @click="openAllLabels">
              Open All Labels
            </button>
          </div>
        </div>
      </div>
    </form>
  </section>
</template>
