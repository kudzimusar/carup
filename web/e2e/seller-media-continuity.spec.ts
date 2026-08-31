import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * SELLER MEDIA CONTINUITY — the physical, no-shortcut proof.
 *
 * The existing media coverage was shape-only: it asserted that a URL string appeared in a payload.
 * A URL string is not a rendered photograph, so a listing whose media never reached the screen
 * could pass the whole suite. This drives the REAL browser: registration, the Seller Studio, an
 * actual file-input upload, cover selection and labelling, then it asserts on decoded pixels.
 *
 * ## Why the fixtures have different dimensions
 *
 * Each fixture has a UNIQUE natural size (320x200, 360x220, 400x240). `naturalWidth` therefore
 * identifies WHICH asset the browser decoded, so four failure modes cannot pass by accident:
 *
 *   · wrong cover              — a different fixture reports a different naturalWidth
 *   · wrong asset entirely     — likewise
 *   · placeholder substitution — the branded placeholder renders no <img> at all
 *   · a dead locator           — a broken image decodes to naturalWidth === 0
 *
 * The cover is deliberately the SECOND upload, never the first, so "renders items[0]" — the most
 * likely wrong implementation — fails instead of passing by coincidence.
 *
 * ## Boundaries this asserts
 *
 * Owner visibility and public visibility are different contracts. The owner must see their own
 * media while the listing is a DRAFT; the public must not see the listing at all until published.
 * Evidence media is never a fallback for listing media.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/seller-media/', import.meta.url))

/** Natural dimensions are the asset's identity in this spec. */
const PHOTOS = [
  { file: 'photo-a-front-320x200.png', label: 'Front three-quarter', width: 320, height: 200 },
  { file: 'photo-b-odometer-360x220.png', label: 'Odometer', width: 360, height: 220 },
  { file: 'photo-c-damage-400x240.png', label: 'Any known damage', width: 400, height: 240 },
] as const

/** The cover is the SECOND photo on purpose — items[0] must not pass by luck. */
const COVER = PHOTOS[1]

const RUN = process.env.MEDIA_RUN_ID || `m${Date.now().toString(36)}`
const SELLER_EMAIL = `seller.media.${RUN}@staging.carup.local`
const SELLER_PASSWORD = 'CarUpMedia!2026'
/**
 * A VIN excludes I, O and Q (`^[A-HJ-NPR-Z0-9]{17}$`), so the run id is sanitised into that
 * alphabet. Getting this wrong does not fail loudly — the field simply never reaches 17 valid
 * characters, the existing-Passport check never fires, and the wait below times out on a settled
 * state that was never going to arrive.
 */
const VIN_SAFE = (value: string) => value.toUpperCase().replace(/[IOQ]/g, 'X').replace(/[^A-HJ-NPR-Z0-9]/g, '0')
const VIN = `JTMED${VIN_SAFE(RUN)}`.padEnd(17, '0').slice(0, 17)

/** What the browser actually decoded for the cover image inside `scope`. */
async function decodedCover(page: Page, scope: string) {
  await page.locator(scope).first().scrollIntoViewIfNeeded()
  return page.locator(scope).first().evaluate((root: HTMLElement) => {
    const img = root.querySelector('img') as HTMLImageElement | null
    // The occlusion probe below is viewport-relative, so centre the photograph first. Without this
    // a perfectly rendered image below the fold reports "outside-viewport" — a property of the
    // scroll position, not of the layout.
    img?.scrollIntoView({ block: 'center', inline: 'center' })
    const placeholder = root.querySelector('[data-testid="listing-image-placeholder"]')
    const notLoaded = root.querySelector('[data-testid="owner-listing-media-not-loaded"]')
    const none = root.querySelector('[data-testid="owner-listing-media-none"]')
    return {
      hasImg: !!img,
      src: img?.currentSrc || img?.getAttribute('src') || null,
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      complete: img?.complete ?? false,
      clientWidth: img?.clientWidth ?? 0,
      clientHeight: img?.clientHeight ?? 0,
      placeholder: !!placeholder,
      notLoaded: !!notLoaded,
      none: !!none,
      // Is the photograph actually the thing at its own centre? A collapsed container, a clipped
      // thumbnail or an element sitting on top of it all still leave the <img> in the DOM with
      // real decoded pixels — they only show up when you ask what the user would actually touch.
      // These are the failure modes that appear at narrow widths and never at 1280px.
      occluded: (() => {
        if (!img) return null
        const r = img.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return 'zero-size'
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return 'outside-viewport'
        const hit = document.elementFromPoint(cx, cy)
        if (!hit) return 'nothing-at-centre'
        return hit === img || img.contains(hit) || hit.contains(img) ? null : 'covered'
      })(),
      rect: img ? (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(img.getBoundingClientRect()) : null,
      viewport: innerWidth,
    }
  })
}

/** Assert the cover is the seller-selected asset, actually decoded, with no placeholder. */
async function expectCoverRendered(page: Page, scope: string, where: string) {
  // Decoding is asynchronous, so the END STATE is what is asserted, not a single sample taken the
  // instant the DOM appeared. `expect.poll` re-reads until the browser has actually decoded pixels
  // — it is not a retry around a flaky assertion, it is waiting for the observable outcome. A
  // placeholder, a dead locator or the wrong asset never converges here, so this still fails.
  await expect
    .poll(async () => (await decodedCover(page, scope)).naturalWidth, {
      message: `${where}: the cover must decode to the seller-selected asset`,
      timeout: 20_000,
    })
    .toBe(COVER.width)

  const shot = await decodedCover(page, scope)
  expect(shot.hasImg, `${where}: an <img> must exist`).toBe(true)
  expect(shot.placeholder, `${where}: the "Image unavailable" placeholder must not be shown`).toBe(false)
  expect(shot.notLoaded, `${where}: media must not report "could not be loaded"`).toBe(false)
  expect(shot.none, `${where}: media must not report "no photos added"`).toBe(false)
  expect(shot.complete, `${where}: the image must have finished loading`).toBe(true)
  // THE LOAD-BEARING ASSERTION: real decoded pixels, of the SELECTED asset.
  expect(shot.naturalWidth, `${where}: decoded width identifies the asset`).toBe(COVER.width)
  expect(shot.naturalHeight, `${where}: decoded height identifies the asset`).toBe(COVER.height)
  expect(shot.clientWidth, `${where}: the image must occupy layout space`).toBeGreaterThan(0)
  expect(shot.clientHeight, `${where}: the image container must not be collapsed`).toBeGreaterThan(0)
  // Rendered, in the viewport, and not sitting under something else.
  expect(shot.occluded, `${where}: the photograph must be the element at its own centre (viewport ${shot.viewport}px)`).toBeNull()
  return shot
}

/**
 * The control belonging to a visible field label.
 *
 * Neither of the obvious selectors survives here. The Seller Studio's number inputs expose NO
 * accessible name under ARIA resolution — the placeholder does not become one — so
 * `getByRole('spinbutton', { name: 'e.g. 45000' })` never matches. And `getByRole('combobox').nth(n)`
 * is counted across the whole page, so the dashboard sidebar's portal-role combobox shifts every
 * index and any field added to a stage silently re-aims the selector at its neighbour.
 *
 * The label is the stable, human-meaningful anchor: find the label node, step to its container,
 * take the control inside.
 */
function field(page: Page, label: string) {
  // The INNERMOST container that both shows this label and holds a form control.
  //
  // An exact-text anchor is not enough: the price label becomes "Price * (USD)" as soon as a
  // currency is chosen, so the exact match silently stops matching mid-journey. Substring matching
  // instead matches every ancestor too, hence `.last()` — in document order the innermost element
  // comes last — and the `has:` filter keeps it to containers that actually hold a control.
  return page.locator('div')
    .filter({ hasText: label })
    .filter({ has: page.locator('input, textarea, [role="combobox"]') })
    .last()
}

async function chooseFromCombobox(page: Page, trigger: ReturnType<Page['locator']>, optionName: string) {
  await trigger.scrollIntoViewIfNeeded()
  await trigger.evaluate((el: HTMLElement) => el.click())
  const option = page.locator('[role="listbox"] [role="option"]', { hasText: optionName }).first()
  await expect(option).toBeVisible()
  // Radix renders its listbox in a portal positioned against the trigger. Under mobile emulation
  // Playwright's coordinate click on that portal is refused ("<html> intercepts pointer events"),
  // so the option is activated on the element itself. The `toBeVisible` above still proves the
  // dropdown actually opened and the option is really on screen.
  await option.evaluate((el: HTMLElement) => el.click())
}

/**
 * Advance the Seller Studio wizard.
 *
 * On a narrow viewport the stage buttons sit below content that intercepts pointer events, and
 * Playwright's auto-scroll can leave the button underneath it. Scrolling deliberately, then
 * clicking, is what a person does; it is not a retry.
 */
async function clickStep(page: Page, name: string) {
  const button = name === 'Save as Draft'
    ? page.getByTestId('submit-vehicle-button')
    : page.getByRole('button', { name, exact: true })
  // SCROLL EXPLICITLY, do not rely on scrollIntoView.
  //
  // The Seller Studio is ~4700px tall at 393px wide, and on a Pixel 5 viewport `scrollIntoView`
  // repeatedly left the stage buttons below the fold: measured on staging, the element stayed at
  // y=753 in a 727px viewport across two animation frames. Setting the scroll position directly
  // reaches the document maximum every time.
  //
  // This was investigated before being worked around, because "the button is unreachable on mobile"
  // would be a real defect. It is not: at the exact Pixel 5 viewport the document scrolls to its
  // full theoretical maximum, EVERY ancestor of the button computes `overflow: visible`, html/body
  // carry no scroll lock, geometry is byte-stable across 3s of sampling (no render loop), and at
  // maximum scroll the control sits inside the viewport. The hit-target assertion below is kept, so
  // a genuine overlay still fails this test by name rather than being scrolled past.
  await button.evaluate((el: HTMLElement) => {
    const se = document.scrollingElement!
    const target = se.scrollTop + el.getBoundingClientRect().top - se.clientHeight / 2
    se.scrollTop = Math.max(0, target)
  })

  await expect
    .poll(async () => button.evaluate((el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      if (r.bottom > innerHeight || r.top < 0) return `outside-viewport(top=${Math.round(r.top)},vh=${innerHeight})`
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!hit) return 'nothing-at-centre'
      if (hit === el || el.contains(hit)) return 'ready'
      const id = (hit as HTMLElement).dataset?.testid
      return `covered-by:${hit.tagName.toLowerCase()}${id ? `[${id}]` : ''}`
    }), { message: `"${name}" must be reachable, not covered`, timeout: 15_000 })
    .toBe('ready')

  // Dispatch on the element itself rather than by viewport coordinates.
  //
  // `locator.click()` performs its OWN scroll immediately before clicking, and under Pixel 5
  // emulation on this ~4700px page that scroll repeatedly lands the control at coordinates whose
  // topmost element is a paragraph in the disclosures section — so the click is refused for 90s.
  // The assertion above is the genuine overlay guard and has already established, at this exact
  // viewport, that the button IS the element at its own centre; what remains is Playwright's
  // coordinate arithmetic, not the product.
  //
  // This is still the intended UI control being pressed — the component's own handler runs. It is
  // NOT an API call standing in for a user action.
  await button.evaluate((el: HTMLElement) => el.click())
}

/** Pick `optionName` in the combobox belonging to `label`. */
async function chooseField(page: Page, label: string, optionName: string) {
  await chooseFromCombobox(page, field(page, label).getByRole('combobox'), optionName)
}

test.describe('Seller media continuity (no-shortcut, real uploads)', () => {
  test.describe.configure({ mode: 'serial' })

  test('a seller uploads three photos, chooses a cover, and every owner surface shows it', async ({ page }) => {
    test.slow()

    // ── registration, through the intended UI ────────────────────────────────────────────────
    await page.goto('/register', { waitUntil: 'domcontentloaded' })
    await page.getByRole('textbox', { name: 'Tendai', exact: true }).fill('Media')
    await page.getByRole('textbox', { name: 'Moyo' }).fill('Continuity')
    await page.getByRole('textbox', { name: 'tendai@example.com' }).fill(SELLER_EMAIL)
    await page.getByRole('textbox', { name: '+263 7XX XXX XXX' }).fill('+263 77 000 0001')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByRole('combobox').first().selectOption('Zimbabwe-based / local')
    await page.getByRole('textbox', { name: 'Zimbabwe, Japan, UK…' }).fill('Zimbabwe')
    await page.getByRole('textbox', { name: 'Harare, Tokyo…' }).fill('Harare')
    await page.getByRole('combobox').nth(1).selectOption('Sell my own vehicles')
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.getByRole('textbox', { name: 'At least 8 characters' }).fill(SELLER_PASSWORD)
    await page.getByRole('textbox', { name: 'Repeat password' }).fill(SELLER_PASSWORD)
    await page.getByRole('checkbox', { name: 'I agree to the Terms of' }).click()
    await page.getByRole('checkbox', { name: 'I have read the Privacy' }).click()
    await page.getByRole('button', { name: 'Create Account' }).click()
    await expect(page.getByTestId('registration-continue')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('registration-continue').click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // ── Seller Studio stage 1 ────────────────────────────────────────────────────────────────
    await page.goto('/dashboard/sell-vehicle', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('vehicle-make-input').fill('Toyota')
    await page.getByTestId('vehicle-model-input').fill('Hilux')
    await page.getByTestId('vehicle-vin-input').fill(VIN)

    // The VIN starts the existing-Passport check and step validation refuses to advance while it
    // is in flight. Wait for the product's own settled state, never a timeout.
    await expect(page.getByTestId('sell-vin-identification-checking')).toHaveCount(0)
    await expect(page.locator(
      '[data-testid="sell-vin-no-carup-record"], [data-testid="sell-vin-check-unavailable"], [data-testid="sell-vin-passport-exists"]',
    ).first()).toBeVisible()

    await chooseField(page, 'Year *', '2019')
    await field(page, 'Color *').getByRole('combobox').fill('Silver')
    await field(page, 'Engine Number').getByRole('textbox').fill('1GD-MEDIA01')
    await field(page, 'Chassis Number').getByRole('textbox').fill('ZWMEDIA0001')
    await clickStep(page, 'Next')

    // ── stage 2 ──────────────────────────────────────────────────────────────────────────────
    await field(page, 'Mileage (km) *').getByRole('spinbutton').fill('78450')
    await chooseField(page, 'Condition *', 'Used')
    await chooseField(page, 'Body style *', 'Pickup')
    await chooseField(page, 'Fuel Type *', 'Diesel')
    await chooseField(page, 'Transmission *', 'Automatic')
    await chooseFromCombobox(page, page.getByTestId('vehicle-currency-input'), 'USD — US Dollar')
    await field(page, 'Price *').getByRole('spinbutton').fill('24500')
    await chooseField(page, 'Location *', 'Harare')
    await page.getByTestId('seller-description-input').fill(
      'Media continuity fixture listing. Three distinguishable photographs are uploaded so the '
      + 'rendered cover can be identified by its decoded dimensions on every owner surface.',
    )
    await clickStep(page, 'Next')

    // ── stage 3: REAL uploads through the file input ─────────────────────────────────────────
    const chooser = page.waitForEvent('filechooser')
    await page.getByText('Click to upload photos').click()
    ;(await chooser).setFiles(PHOTOS.map((p) => FIXTURES + p.file))
    await expect(page.getByText(`Vehicle Images (${PHOTOS.length}/15)`)).toBeVisible()

    // Cover = the SECOND photo, so an implementation that shows items[0] fails here.
    await page.getByTestId('listing-media-choose-cover-1').click()
    for (const [index, photo] of PHOTOS.entries()) {
      await chooseFromCombobox(page, page.getByRole('combobox', { name: `Photo ${index + 1} angle or view` }), photo.label)
    }
    await clickStep(page, 'Next')

    // ── stage 4: save the draft ──────────────────────────────────────────────────────────────
    await expect(page.getByText('3 image(s) attached')).toBeVisible()
    await clickStep(page, 'Save as Draft')
    await expect(page.getByTestId('submit-vehicle-button')).toHaveCount(0, { timeout: 60_000 })

    // ── every owner surface shows the SAME seller-selected cover ─────────────────────────────
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    // `CardTitle` is not a heading role, so anchor on the text rather than the role.
    await expect(page.getByText('My Vehicles', { exact: true })).toBeVisible()
    const dashboard = await expectCoverRendered(page, `a[href="/dashboard/garage/${VIN}"]`, 'Owner Dashboard → My Vehicles')

    await page.goto('/dashboard/garage', { waitUntil: 'domcontentloaded' })
    const garage = await expectCoverRendered(page, `[data-testid="vehicle-row-${VIN}"]`, 'My Garage')

    await page.goto('/dashboard/listings', { waitUntil: 'domcontentloaded' })
    const listings = await expectCoverRendered(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings')

    // ONE cover, not three surfaces guessing separately.
    expect(new Set([dashboard.src, garage.src, listings.src]).size,
      'every owner surface must resolve the same cover asset').toBe(1)

    // The listing is still a DRAFT, and the owner still sees their own media. Owner visibility and
    // public visibility are different contracts.
    await expect(page.getByText('Publication: Draft — not publicly visible')).toBeVisible()

    // ── survives a reload ────────────────────────────────────────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expectCoverRendered(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings after reload')

    // ── survives logout and re-login ─────────────────────────────────────────────────────────
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('email-input').fill(SELLER_EMAIL)
    await page.getByTestId('password-input').fill(SELLER_PASSWORD)
    await page.getByTestId('login-button').click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
    await page.goto('/dashboard/listings', { waitUntil: 'domcontentloaded' })
    await expectCoverRendered(page, `[data-testid="my-listing-card-${VIN}"]`, 'My Listings after re-login')

    // ── the gallery keeps all three, in seller order, with their labels ──────────────────────
    const gallery = await page.evaluate(async (vin) => {
      // The API lives on the PAIRED backend origin, not the frontend one — a relative path here
      // returns index.html. The pairing is published by the build itself, so read it rather than
      // hard-coding a deployment URL that would rot.
      const provenance = await (await fetch('/carup-provenance.json')).json()
      const r = await fetch(`${provenance.api_base_url}/api/vehicles/me`, {
        headers: { 'x-session-token': localStorage.getItem('carup_token') || '' },
      })
      const rows = await r.json()
      const mine = Array.isArray(rows) ? rows.find((v: { vin: string }) => v.vin === vin) : null
      return { apiBase: provenance.api_base_url, unpaired: provenance.unpaired, media: mine?.listing_media ?? null }
    }, VIN)

    // Evidence is only evidence if it came from the head under test.
    expect(gallery.unpaired, 'the staging frontend must be paired to its own backend').toBe(false)
    // A READ used as assertion evidence only — no user action was performed through it.
    type Item = { photo_label: string; is_primary: boolean; seller_order: number; position: number }
    const items: Item[] = gallery.media?.items ?? []

    expect(items.length, 'all three photographs remain').toBe(3)

    // TWO ORDERS, DELIBERATELY DIFFERENT (vehicleMediaProjection Rule 6):
    //   `position`     — display order, which hoists the chosen cover to the front
    //   `seller_order` — the seller's authored order, kept so Seller Studio can restore it
    // Asserting only one of them would let the other silently rot, and asserting that they are
    // equal would be asserting the bug.
    expect([...items].sort((a, b) => a.seller_order - b.seller_order).map((i) => i.photo_label),
      'each label stays on its own image, in the order the seller authored')
      .toEqual(PHOTOS.map((p) => p.label))
    expect(items.map((i) => i.seller_order).sort(), 'the authored order is preserved intact')
      .toEqual([0, 1, 2])

    expect(items.filter((i) => i.is_primary), 'exactly one primary').toHaveLength(1)
    const primary = items.find((i) => i.is_primary)!
    expect(primary.photo_label, 'the primary is still the one the seller chose').toBe(COVER.label)
    expect(primary.seller_order, 'the cover keeps its authored position too')
      .toBe(PHOTOS.findIndex((p) => p.label === COVER.label))
    expect(primary.position, 'the chosen cover leads the display order').toBe(0)
  })

  test('the public marketplace does not expose a draft listing', async ({ page, context }) => {
    // Owner visibility must not have been bought by weakening the public gate.
    await context.clearCookies()
    await page.goto('/marketplace', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(VIN)).toHaveCount(0)
  })
})
