const modeSettings = Object.freeze({
  development: {
    envPath: '/Users/diwakarsandhu/Desktop/secrets/env.development',
    fedexApiBaseUrl: 'https://apis-sandbox.fedex.com',
  },
  production: {
    envPath: '/Users/diwakarsandhu/Desktop/secrets/env.production',
    fedexApiBaseUrl: 'https://apis.fedex.com',
  },
});

// APP_ENV controls both the credential file and the FedEx host, keeping sandbox and production credentials separate.
const runtimeEnv = globalThis.process?.env || {};
const viteMode = import.meta.env?.MODE;
const appMode = normalizeAppMode(runtimeEnv.APP_ENV || runtimeEnv.NODE_ENV || viteMode);
const activeModeSettings = modeSettings[appMode];

export const frontendConfig = Object.freeze({
  appTitle: 'True Robotics FedEx Shipping',
  githubPagesBase: '/TrueRoboticsFedexShippingApp/',
  apiBaseUrl: 'http://localhost:8787',
  logoUrl: 'logo.png',
  appMode,
});

export const serverConfig = Object.freeze({
  appMode,
  port: 8787,
  host: '127.0.0.1',
  envPath: activeModeSettings.envPath,
  allowedOrigin: 'http://localhost:5173',
  fedexApiBaseUrl: activeModeSettings.fedexApiBaseUrl,
  shipperName: 'True Robotics',
  shipperEmail: 'info@truerobotics.org',
  shipperPhone: '7742769866',
  shipperAddress1: '49 Canterbury St',
  shipperAddress2: 'STE 700',
  shipperCity: 'Worcester',
  shipperState: 'MA',
  shipperPostalCode: '01610',
  shipperCountryCode: 'US',
  pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
  weightUnits: 'LB',
  packageWeightValue: 10,
  labelImageType: 'PNG',
  labelStockType: 'PAPER_4X6',
  labelFormatType: 'COMMON2D',
  logFedExTraffic: true,
});

export { appMode, modeSettings };

function normalizeAppMode(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();

  if (normalizedValue === 'prod') {
    return 'production';
  }

  if (normalizedValue === 'dev' || normalizedValue === 'test') {
    return 'development';
  }

  return Object.hasOwn(modeSettings, normalizedValue) ? normalizedValue : 'development';
}
