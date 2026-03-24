<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { boxOptions, createShipmentRequest } from '../services/fedex.js';
import { searchAddressSuggestions } from '../services/addressAutocomplete.js';

const form = reactive({
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

let searchTimeoutId;

watch(
  () => addressQuery.value,
  (value) => {
    clearTimeout(searchTimeoutId);

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

const canSubmit = computed(() => {
  return (
    form.email &&
    form.phoneNumber &&
    form.addressLine1 &&
    form.city &&
    form.stateOrProvinceCode &&
    form.postalCode &&
    form.boxType &&
    Number(form.quantity) > 0
  );
});

function applySuggestion(suggestion) {
  form.addressLine1 = suggestion.addressLine1;
  form.city = suggestion.city;
  form.stateOrProvinceCode = suggestion.stateOrProvinceCode;
  form.postalCode = suggestion.postalCode;
  form.countryCode = suggestion.countryCode || 'US';
  addressQuery.value = suggestion.label;
  suggestions.value = [];
}

async function handleSubmit() {
  if (!canSubmit.value) {
    status.value = {
      tone: 'error',
      message: 'Please complete all required fields before submitting.',
    };
    return;
  }

  isSubmitting.value = true;
  status.value = {
    tone: '',
    message: '',
  };

  try {
    const response = await createShipmentRequest({
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
  } catch (error) {
    status.value = {
      tone: 'error',
      message: error.message || 'Shipment request failed.',
    };
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <section class="form-card">
    <div class="section-heading">
      <div>
        <p class="section-label">Shipment Request</p>
        <h2>Recipient + Package Details</h2>
      </div>
      <span class="status-chip">FedEx Proxy Ready</span>
    </div>

    <form class="shipping-form" @submit.prevent="handleSubmit">
      <label>
        Recipient Email
        <input v-model.trim="form.email" type="email" placeholder="name@example.com" required />
      </label>

      <label>
        Recipient Phone
        <input
          v-model.trim="form.phoneNumber"
          type="tel"
          placeholder="9015550123"
          required
        />
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
        Address Line 1
        <input
          v-model.trim="form.addressLine1"
          type="text"
          placeholder="123 Main St"
          required
        />
      </label>

      <label class="full-width">
        Address Line 2
        <input v-model.trim="form.addressLine2" type="text" placeholder="Suite, unit, etc." />
      </label>

      <label>
        City
        <input v-model.trim="form.city" type="text" placeholder="Memphis" required />
      </label>

      <label>
        State
        <input
          v-model.trim="form.stateOrProvinceCode"
          type="text"
          maxlength="2"
          placeholder="TN"
          required
        />
      </label>

      <label>
        ZIP Code
        <input v-model.trim="form.postalCode" type="text" placeholder="38116" required />
      </label>

      <label>
        Country
        <input v-model.trim="form.countryCode" type="text" maxlength="2" placeholder="US" />
      </label>

      <label>
        Box Type
        <select v-model="form.boxType">
          <option v-for="option in boxOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label>
        Quantity
        <input v-model="form.quantity" type="number" min="1" step="1" required />
      </label>

      <div class="full-width form-actions">
        <button :disabled="isSubmitting || !canSubmit" type="submit">
          {{ isSubmitting ? 'Submitting…' : 'Create Shipment' }}
        </button>

        <p v-if="status.message" :class="['form-status', status.tone]">
          {{ status.message }}
        </p>
      </div>
    </form>
  </section>
</template>
