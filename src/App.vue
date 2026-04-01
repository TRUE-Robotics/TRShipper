<script setup>
import { ref } from 'vue';
import ShippingForm from './components/ShippingForm.vue';
import { frontendConfig } from '../app.config.js';

const appTitle = frontendConfig.appTitle;
const configuredLogoUrl = frontendConfig.logoUrl;
const logoUrl = resolveLogoUrl(configuredLogoUrl);
const logoVisible = ref(true);

function resolveLogoUrl(path) {
  if (!path) {
    return `${import.meta.env.BASE_URL}logo.png`;
  }

  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.replace(/^\/+/, '');
  return `${import.meta.env.BASE_URL}${normalizedPath}`;
}
</script>

<template>
  <div class="app-shell">
    <main class="layout">
      <section class="brand-card">
        <div class="brand-topline">Secure Shipping Access</div>
        <div class="brand-row">
          <div class="brand-mark">
            <img
              v-if="logoVisible"
              :src="logoUrl"
              alt="True Robotics logo"
              @error="logoVisible = false"
            />
            <div v-else class="brand-fallback">TR</div>
          </div>

          <div class="brand-copy">
            <h1>{{ appTitle }}</h1>
          </div>
        </div>
      </section>
      <ShippingForm />
    </main>
  </div>
</template>
