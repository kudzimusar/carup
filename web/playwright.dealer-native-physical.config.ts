import {defineConfig,devices} from '@playwright/test'

/**
 * ISOLATED, real-backend/native-PostgreSQL partial dealership browser certification.
 * These tests do not borrow staging/production, mock responses, or claim full golden
 * lifecycle authorization. Every API call is resolved by CarUp Express/PostgREST.
 */
const allowedPhases=new Set([
  'prelegal','synthetic-legal','synthetic-staff','synthetic-feedback',
])
const phase=process.env.DEALER_BROWSER_PHASE||'prelegal'
if(!allowedPhases.has(phase))
  throw Error('UNRECOGNIZED_DISPOSABLE_DEALER_BROWSER_PHASE')

export default defineConfig({
  // Four independent physical phases retain their own screenshots, traces
  // and JSON receipts. Reusing outputDir would silently erase prior evidence.
  outputDir:'test-results/'+phase,
  testDir:'./tests/dealer-native-physical',
  // Distinct browser-only filename prevents Vitest from loading this file
  // before its real PostgreSQL/Express/fixture setup exists.
  testMatch:/.*\.pw\.ts$/,

  fullyParallel:false,
  forbidOnly:true,
  retries:0,
  workers:1,
  timeout:120000,
  reporter:[['list'],['json',{outputFile:'test-results/'+phase+'-physical-results.json'}]],
  use:{
    ...devices['Desktop Chrome'],
    baseURL:'http://127.0.0.1:5173',
    trace:'on',
    screenshot:'on',
  },
  projects:[{name:'chromium-native-pg',use:{...devices['Desktop Chrome']}}],
});
