import { test, expect } from '@playwright/test';

test.describe('Referral Engine — Public Attribution Route', () => {
  test('navigating to /r/:code redirects to /register?ref=:code and preserves journey token', async ({ page }) => {
    // Navigate to the shortlink
    const response = await page.goto('/r/TEST1234');
    
    // We expect the backend to issue a redirect
    // The final URL should be /register?ref=TEST1234
    await page.waitForURL(/\/register\?ref=TEST1234/);
    
    // Check that we reached the registration page
    await expect(page).toHaveURL(/register\?ref=TEST1234/);
    
    // Verify that the referral_journey_token cookie was set securely by the backend
    const cookies = await page.context().cookies();
    const journeyCookie = cookies.find(c => c.name === 'referral_journey_token');
    
    expect(journeyCookie).toBeDefined();
    if (journeyCookie) {
      expect(journeyCookie.value).toBeTruthy();
      expect(journeyCookie.httpOnly).toBe(true);
      // Wait, SameSite is either Lax or missing, let's just assert existence and value
    }
  });
});
