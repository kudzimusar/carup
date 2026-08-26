from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected anchor once, found {count}')
    target.write_text(text.replace(old, new, 1))


replace_once(
    'web/src/pages/VehicleDetail.tsx',
    '          <div className="lg:col-span-2 space-y-6">',
    '          <div className="min-w-0 lg:col-span-2 space-y-6">',
)

replace_once(
    'web/e2e/marketplace-staging-certification.spec.ts',
    """  await expect(page.getByTestId('trust-score-badge')).toBeVisible()\n  expect(\n    (await page.getByTestId('identity-field-withheld').count())\n      + (await page.getByTestId('plate-advisory-withheld').count()),\n    'public identity redaction evidence',\n  ).toBeGreaterThan(0)\n  await expect(page.getByText('Not recorded').first()).toBeVisible()\n""",
    """  await expect(page.getByTestId('trust-score-badge')).toBeVisible()\n  // Public Marketplace detail deliberately renders before optional passport enrichment. Privacy\n  // certification therefore binds to the public response and the seller-redaction surface that are\n  // authoritative at first render, rather than racing a passport-only marker that may arrive later.\n  const sellerSummary = detailBody.seller_summary as {\n    display_label?: string | null\n    public_profile_enabled?: boolean\n  } | undefined\n  expect(sellerSummary?.public_profile_enabled, 'golden private seller public profile').toBe(false)\n  expect(sellerSummary?.display_label, 'golden private seller public display label').toBeNull()\n  await expect(page.getByTestId('seller-name')).toHaveText('Not shown publicly')\n  await expect(page.getByText('Not recorded').first()).toBeVisible()\n""",
)

replace_once(
    'web/e2e/marketplace-staging-certification.spec.ts',
    """  await expect(page.getByTestId('listing-media-block')).toBeVisible()\n  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {\n    message: 'mobile Vehicle Detail must not overflow horizontally',\n  }).toBe(true)\n\n  await page.screenshot({ path: testInfo.outputPath('mobile-vehicle-detail.png'), fullPage: true })\n""",
    """  await expect(page.getByTestId('listing-media-block')).toBeVisible()\n  try {\n    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), {\n      message: 'mobile Vehicle Detail must not overflow horizontally',\n    }).toBe(true)\n  } catch (error) {\n    const overflow = await page.evaluate(() => ({\n      viewportWidth: window.innerWidth,\n      documentScrollWidth: document.documentElement.scrollWidth,\n      elements: Array.from(document.querySelectorAll<HTMLElement>('body *'))\n        .map((element) => {\n          const rect = element.getBoundingClientRect()\n          return {\n            tag: element.tagName,\n            testId: element.dataset.testid || null,\n            className: typeof element.className === 'string' ? element.className : '',\n            text: (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),\n            left: rect.left,\n            right: rect.right,\n            width: rect.width,\n            clientWidth: element.clientWidth,\n            scrollWidth: element.scrollWidth,\n          }\n        })\n        .filter((entry) => entry.right > window.innerWidth + 1)\n        .slice(0, 40),\n    }))\n    await testInfo.attach('mobile-horizontal-overflow.json', {\n      body: Buffer.from(JSON.stringify(overflow, null, 2)),\n      contentType: 'application/json',\n    })\n    throw error\n  }\n\n  await page.screenshot({ path: testInfo.outputPath('mobile-vehicle-detail.png'), fullPage: true })\n""",
)
