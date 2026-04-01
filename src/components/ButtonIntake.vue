<script setup>
import { ref } from 'vue';
import { frontendConfig } from '../../app.config.js';
import {
  parsePastedShipmentInput,
  savePastedShipmentDraft,
} from '../utils/pastedShipment.js';

const pastedText = ref('');
const status = ref({
  tone: '',
  message: '',
});

function handleContinue() {
  try {
    const parsed = parsePastedShipmentInput(pastedText.value);
    savePastedShipmentDraft(parsed);

    const destination = new URL(frontendConfig.githubPagesBase || '/', window.location.origin);
    window.location.assign(destination.toString());
  } catch (error) {
    status.value = {
      tone: 'error',
      message: error.message || 'Could not parse the pasted shipment text.',
    };
  }
}
</script>

<template>
  <section class="form-card intake-card">
    <div class="section-heading">
      <div>
        <p class="section-label">Button Intake</p>
        <h2>Paste Inventory Data</h2>
      </div>
      <span class="status-chip">Redirects To Review</span>
    </div>

    <div class="intake-stack">
      <p class="intake-intro">
        Paste a single inventory line and we will route you to the standard shipping page with the fields filled in for review.
      </p>

      <label class="full-width">
        <span class="field-label">Shipment Text</span>
        <textarea
          v-model.trim="pastedText"
          class="intake-textarea"
          placeholder="Apple Inc. Attn: John Doe 123 Main Street Worcester MA 01608 test@gmail.com 123-456-7890"
        />
        <small class="intake-help">
          Format: Company Attn: Name Address City State ZIP Email Phone
        </small>
      </label>

      <button type="button" class="intake-button" @click="handleContinue">
        Fill Shipping Form
      </button>

      <p v-if="status.message" :class="['form-status', status.tone]">
        {{ status.message }}
      </p>
    </div>
  </section>
</template>
