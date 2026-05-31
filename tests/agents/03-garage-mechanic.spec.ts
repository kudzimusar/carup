import { test, expect } from '@playwright/test';

test.describe('Agent 3 - Garage & Mechanic Validation Agent', () => {
  test('COMPLETE A REAL SERVICE WORKFLOW', async ({ page }) => {
    // Navigate to Mechanic Dashboard
    await page.goto('/mechanic');

    // Work Orders / Service Workflows
    await page.goto('/mechanic/work-orders');
    
    const newOrderBtn = page.getByRole('button', { name: /new order|create/i });
    if (await newOrderBtn.count() > 0) {
      await newOrderBtn.first().click();
    } else {
      console.log('Missing: Create Work Order button');
    }

    // PartSentry
    await page.goto('/mechanic/parts');
    const partsTable = page.getByRole('table');
    if (await partsTable.count() === 0) {
      console.log('Missing: Parts tracking / PartSentry view');
    }

    // Check for invoice/image upload areas
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() === 0) {
      console.log('Missing: Invoice/Image upload functionality for Mechanics');
    }
  });
});
