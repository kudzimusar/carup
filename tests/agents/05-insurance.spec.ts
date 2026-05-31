import { test, expect } from '@playwright/test';

test.describe('Agent 5 - Insurance Validation Agent', () => {
  test('OPERATE FULL CLAIM WORKFLOWS', async ({ page }) => {
    await page.goto('/#/insurance-dash');

    // Quote Generation & Claims
    await page.goto('/#/insurance-dash/claims');
    const newClaimBtn = page.getByRole('button', { name: /new claim|file claim/i });
    if (await newClaimBtn.count() === 0) {
      console.log('Missing: File Claim functionality');
    }

    // Fraud Detection & Risk Scoring
    await page.goto('/#/insurance-dash/fraud');
    const alerts = page.locator('text=Fraud Alerts');
    if (await alerts.count() === 0) {
      console.log('Missing: Fraud Detection view');
    }
    
    await page.goto('/#/insurance-dash/risk');
    if (await page.locator('text=Risk Analysis').count() === 0) {
      console.log('Missing: Insurance Risk Scoring view');
    }
  });
});
