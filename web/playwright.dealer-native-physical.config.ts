import {defineConfig,devices} from '@playwright/test'

/**
 * ISOLATED, real-backend/native-PostgreSQL partial dealership browser certification.
 * These tests do not borrow staging/production, mock responses, or claim full golden
 * lifecycle authorization. Every API call is resolved by CarUp Express/PostgREST.
 */
export default defineConfig({
  testDir:'./tests/dealer-native-physical',
  fullyParallel:false,
  forbidOnly:true,
  retries:0,
  workers:1,
  timeout:120000,
  reporter:[['list'],['json',{outputFile:'test-results/dealer-native-physical-results.json'}]],
  use:{
    ...devices['Desktop Chrome'],
    baseURL:'http://127.0.0.1:5173',
    trace:'on',
    screenshot:'on',
  },
  projects:[{name:'chromium-native-pg',use:{...devices['Desktop Chrome']}}],
});
