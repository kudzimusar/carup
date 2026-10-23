import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { ensureActingForOrganisation } from './staging-helpers'

const PRODUCT_SHA = 'a8a89fc1fb12551513916dea6bb45c841dbc7a59'
const OWNER_ID = 'uat_ops01_owner_20261022a'
const OWNER_EMAIL = 'ops01.owner.20261022a@carup-staging.test'
const GARAGE_ID = '442c82c1-fc69-46ff-a138-712a6504ac98'
const EXPECTED_STAGING_PROJECT_REF = 'eoyenigwevnxwwhyhaer'
const FORBIDDEN_PRODUCTION_PROJECT_REF = 'vhmnajoeicasaigiophh'
const WEB = (process.env.STAGING_WEB_URL || 'https://staging.carup.dev').replace(/\/$/, '')
const API = (process.env.STAGING_API_URL || 'https://api-staging.carup.dev/api').replace(/\/$/, '')
const RESULTS_DIR = path.resolve(process.env.GARAGE_R4_RESULTS_DIR || 'test-results/garage-r4')
const PASSWORD_FILE = process.env.GARAGE_R4_PASSWORD_FILE || ''
const RUN_SUFFIX = String(process.env.GARAGE_R4_RUN_ID || process.env.GITHUB_RUN_ID || Date.now())
  .replace(/[^A-Za-z0-9]/g, '')
  .slice(-10)
  .toUpperCase()
const TEMP_SITE_CODE = `UAT-R4-${RUN_SUFFIX}`
const TEMP_SITE_NAME = `SYNTHETIC / UAT R4 AUDIT SITE ${RUN_SUFFIX}`
const TEMP_SITE_UPDATED_NAME = `SYNTHETIC / UAT R4 AUDIT SITE / UPDATED ${RUN_SUFFIX}`
const TEMP_DEPT_NAME = `SYNTHETIC / UAT R4 ${RUN_SUFFIX}`
const NOTE_MARKER = 'SYNTHETIC / UAT R4 AUDIT PROOF'
const R3_RESIDUE_ID = '071ef0e9-e1ff-4de9-8da4-50eaecf945e5'
const R3_RESIDUE_CODE = 'UAT-R3-9002802221'
const mutationFailures: Array<Record<string, unknown>> = []
let failureDetails: Record<string, unknown> | null = null
const RUN_STARTED_AT = new Date()

function requireStagingDbUrl(): string {
  const value = process.env.DIASPORA_STAGING_DATABASE_URL || ''
  if (!value) throw new Error('DIASPORA_STAGING_DATABASE_URL is required')
  if (value.includes(FORBIDDEN_PRODUCTION_PROJECT_REF) || !value.includes(EXPECTED_STAGING_PROJECT_REF)) {
    throw new Error('REFUSING GARAGE R4 CREDENTIAL OPERATION OUTSIDE APPROVED STAGING')
  }
  return value.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '')
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(RESULTS_DIR, name), JSON.stringify(value, null, 2) + '\n')
}

function readPassword(): string {
  if (!PASSWORD_FILE) throw new Error('GARAGE_R4_PASSWORD_FILE is not configured')
  const st = fs.lstatSync(PASSWORD_FILE)
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('R4 password file is not a regular runner-private file')
  if ((st.mode & 0o077) !== 0) throw new Error('R4 password file permissions are broader than 0600')
  const value = fs.readFileSync(PASSWORD_FILE, 'utf8').trim()
  if (!value) throw new Error('R4 temporary password is empty')
  return value
}


async function assertMutation(responsePromise: Promise<any>, label: string) {
  const response = await responsePromise
  if (response.status() >= 300) {
    let body = ''
    try { body = (await response.text()).slice(0, 1000).replace(/(password|token|secret|authorization|cookie)\s*[:=]\s*[^,\s}]+/gi, '$1=<redacted>') } catch { body = '<unreadable response body>' }
    let pathName = '<unknown>'
    try { pathName = new URL(response.url()).pathname } catch {}
    mutationFailures.push({
      label,
      method: response.request().method(),
      path: pathName,
      status: response.status(),
      response_body: body,
      timestamp: new Date().toISOString(),
    })
  }
  expect(response.status(), `${label} response`).toBeLessThan(300)
  return response
}
async function connectDb() {
  const client = new pg.Client({ connectionString: requireStagingDbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  return client
}

async function queryOne<T = any>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  const result = await client.query(sql, params)
  if (result.rowCount !== 1) throw new Error(`Expected exactly one row, got ${result.rowCount}`)
  return result.rows[0] as T
}

async function ownerProfileCount(client: pg.Client): Promise<number> {
  const row = await queryOne<{ count: number }>(client, `
    select count(*)::int as count
      from public.garage_workforce_profiles
     where tenant_id=$1::uuid and user_id=$2
  `, [GARAGE_ID, OWNER_ID])
  return Number(row.count)
}

async function auditRows(client: pg.Client, since: Date) {
  const result = await client.query(`
    select id::text, event_type, actor_user_id, actor_role, actor_tenant_id,
           source_route, created_at, previous_value, new_value
      from public.trust_audit_events
     where actor_user_id=$1
       and actor_tenant_id=$2
       and created_at >= $3::timestamptz
     order by created_at asc, id asc
  `, [OWNER_ID, GARAGE_ID, since.toISOString()])
  return result.rows
}

async function requireAudit(
  client: pg.Client,
  eventType: string,
  since: Date,
  predicate?: (row: any) => boolean,
) {
  const rows = await auditRows(client, since)
  const row = [...rows].reverse().find((candidate) => candidate.event_type === eventType && (!predicate || predicate(candidate)))
  expect(row, `missing ${eventType}`).toBeTruthy()
  expect(row.actor_user_id).toBe(OWNER_ID)
  expect(row.actor_role).toBe('owner')
  expect(row.actor_tenant_id).toBe(GARAGE_ID)
  expect(row.source_route).toMatch(/^\/api\/garage\//)
  return row
}

async function login(page: Page) {
  const password = readPassword()
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' })
  await expect(page).toHaveTitle(/Sign In \| CarUp/i)
  await page.getByLabel('Email or Phone').fill(OWNER_EMAIL)
  await page.getByTestId('password-input').fill(password)
  const loginResponse = page.waitForResponse(
    (response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /sign in/i }).click()
  const response = await assertMutation(loginResponse, 'login')
  expect(response.status()).toBe(200)
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 })
}

async function openSites(page: Page) {
  await page.goto(`${WEB}/garage/sites`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/garage\/sites/)
  await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible()
  await expect(page.getByTestId('sites-error')).toHaveCount(0)
}

async function openWorkforce(page: Page) {
  await page.goto(`${WEB}/garage/workforce`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/garage\/workforce/)
  await expect(page.getByRole('heading', { name: 'Workforce' })).toBeVisible()
  await expect(page.getByTestId('workforce-error')).toHaveCount(0)
}

async function selectMember(page: Page, email: string) {
  const member = page.getByTestId('workforce-member').filter({ hasText: email })
  await expect(member).toHaveCount(1)
  await member.click()
  await expect(page.getByTestId('workforce-profile-form')).toBeVisible()
}

async function selectAdditionalSite(page: Page, siteCode: string, checked: boolean) {
  const label = page.locator('label').filter({ hasText: siteCode })
  const box = label.locator('input[type="checkbox"]')
  if (await box.count() !== 1) return
  if ((await box.isChecked()) !== checked) await box.click()
}

async function saveWorkforceProfile(page: Page) {
  const response = page.waitForResponse((r) =>
    r.url().includes('/api/garage/workforce/') && r.request().method() === 'PATCH' &&
    !r.url().includes('/status') && !r.url().includes('/branches'),
  )
  const branchResponse = page.waitForResponse(
    (r) => r.url().includes('/api/garage/workforce/') &&
      r.request().method() === 'PUT' && r.url().includes('/branches'),
    { timeout: 5_000 },
  ).catch(() => null)
  await page.getByRole('button', { name: /save workforce profile/i }).click()
  await assertMutation(response, 'save workforce profile')
  const assignmentResponse = await branchResponse
  if (assignmentResponse) await assertMutation(Promise.resolve(assignmentResponse), 'save workforce assignments')
  await expect(page.getByTestId('workforce-loading')).toHaveCount(0, { timeout: 20_000 })
}

test.describe.configure({ mode: 'serial' })

test('GARAGE-1.0 OPS01 STG01 R4 physical application certification', async ({ page, request }) => {
  test.setTimeout(8 * 60_000)
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const client = await connectDb()

  const evidence: Record<string, unknown> = {
    product_sha: PRODUCT_SHA,
    run_started_at: RUN_STARTED_AT.toISOString(),
    owner_id: OWNER_ID,
    garage_id: GARAGE_ID,
    temporary_site_code: TEMP_SITE_CODE,
  }

  try {
    // Runtime custody: this is not an auth substitute; it proves the deployed application under test.
    const [provResponse, healthResponse] = await Promise.all([
      request.get(`${WEB}/carup-provenance.json?garage_r4=${encodeURIComponent(RUN_SUFFIX)}`),
      request.get(`${API}/health?garage_r4=${encodeURIComponent(RUN_SUFFIX)}`),
    ])
    expect(provResponse.ok()).toBeTruthy()
    expect(healthResponse.ok()).toBeTruthy()
    const provenance = await provResponse.json()
    const health = await healthResponse.json()
    expect(provenance.commit_sha).toBe(PRODUCT_SHA)
    expect(provenance.unpaired).toBe(false)
    expect(health?.build?.commit_sha).toBe(PRODUCT_SHA)
    evidence.runtime_custody = {
      frontend_sha: provenance.commit_sha,
      backend_sha: health?.build?.commit_sha,
      backend_deployment_id: health?.build?.deployment_id || null,
      web_url: WEB,
      api_url: API,
    }

    // Pre-mutation truth and safe mechanic snapshot.
    const starting = await queryOne<any>(client, `
      select jsonb_build_object(
        'active_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=true),
        'primary_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_primary=true),
        'mechanic_memberships',(select count(*) from public.tenant_users where tenant_id=$1::uuid and role='mechanic'),
        'active_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active'),
        'live_primary',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary=true),
        'historical_assignments',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is not null),
        'active_departments',(select count(*) from public.garage_departments where tenant_id=$1::uuid and is_active=true),
        'owner_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2)
      ) as state
    `, [GARAGE_ID, OWNER_ID])
    expect([3, 4]).toContain(Number(starting.state.active_sites))
    expect(Number(starting.state.primary_sites)).toBe(1)
    expect(Number(starting.state.mechanic_memberships)).toBe(10)
    expect(Number(starting.state.active_workforce)).toBe(10)
    expect(Number(starting.state.live_primary)).toBe(10)
    expect(Number(starting.state.active_departments)).toBe(4)
    expect(Number(starting.state.owner_workforce)).toBe(0)
    evidence.starting_fixture = starting.state

    const sitesResult = await client.query(`
      select id::text, branch_code, name, is_active, is_primary, manager_user_id
        from public.garage_branches
       where tenant_id=$1::uuid
         and branch_code in ('UAT-HRE-01','UAT-BYO-01','UAT-MSR-01')
       order by branch_code
    `, [GARAGE_ID])
    expect(sitesResult.rowCount).toBe(3)
    const retainedSites = sitesResult.rows
    const siteById = new Map(retainedSites.map((s) => [s.id, s]))

    const mechanicsResult = await client.query(`
      select
        p.id::text as profile_id,
        p.user_id,
        u.email,
        p.staff_code,
        p.employment_classification,
        p.start_date::text,
        p.employment_status,
        p.department_id::text,
        p.internal_notes,
        coalesce((
          select json_agg(json_build_object('branch_id',a.branch_id::text,'is_primary',a.is_primary) order by a.is_primary desc,a.branch_id::text)
            from public.garage_workforce_branch_assignments a
           where a.tenant_id=p.tenant_id and a.workforce_profile_id=p.id and a.ended_at is null
        ), '[]'::json) as assignments,
        coalesce((
          select json_agg(s.skill_name order by s.skill_name)
            from public.garage_workforce_skills s
           where s.tenant_id=p.tenant_id and s.workforce_profile_id=p.id and s.removed_at is null
        ), '[]'::json) as skills
      from public.garage_workforce_profiles p
      join public.users u on u.id=p.user_id
      join public.tenant_users tu on tu.tenant_id=p.tenant_id and tu.user_id=p.user_id
      where p.tenant_id=$1::uuid
        and p.employment_status='active'
        and tu.role='mechanic'
        and not exists (
          select 1 from public.garage_branches b
           where b.tenant_id=p.tenant_id and b.manager_user_id=p.user_id
        )
      order by p.user_id
    `, [GARAGE_ID])
    const safeMechanic = mechanicsResult.rows.find((row) =>
      Array.isArray(row.assignments) && row.assignments.filter((a: any) => a.is_primary).length === 1,
    )
    expect(safeMechanic, 'no reversible active mechanic was available').toBeTruthy()
    const originalPrimary = safeMechanic.assignments.find((a: any) => a.is_primary).branch_id
    const originalAdditional = safeMechanic.assignments.filter((a: any) => !a.is_primary).map((a: any) => a.branch_id)
    const alternate = retainedSites.find((site) => site.id !== originalPrimary)
    expect(alternate).toBeTruthy()
    evidence.safe_mechanic = {
      user_id: safeMechanic.user_id,
      staff_code: safeMechanic.staff_code,
      classification: safeMechanic.employment_classification,
      start_date: safeMechanic.start_date,
      status: safeMechanic.employment_status,
      department_id: safeMechanic.department_id,
      primary_site_id: originalPrimary,
      additional_site_ids: originalAdditional,
      original_notes_present: safeMechanic.internal_notes != null,
      skills: safeMechanic.skills,
    }

    const contractor = await queryOne<any>(client, `
      select p.user_id,u.email,p.employment_classification,p.start_date::text
        from public.garage_workforce_profiles p
        join public.users u on u.id=p.user_id
       where p.tenant_id=$1::uuid and p.employment_classification='contractor'
       order by p.user_id limit 1
    `, [GARAGE_ID])

    // Real UI login and authenticated Garage context.
    await login(page)
    const selection = await ensureActingForOrganisation(
      page,
      /SYNTHETIC \/ UAT OPS01 GARAGE 20261022A/,
    )
    expect(selection.outcome, 'the fresh Owner session must select the Garage through the real UI').toBe('selected')
    expect(selection.tenantId).toBe(GARAGE_ID)
    expect(selection.badge).toBe('Acting for SYNTHETIC / UAT OPS01 GARAGE 20261022A. Change organisation')
    const selectedSession = await queryOne<{
      active_role: string
      active_organization_id: string
    }>(client, `
      select active_role, active_organization_id
        from public.user_sessions
       where user_id=$1
         and created_at::timestamptz >= $2::timestamptz
         and is_valid=true
       order by created_at desc
       limit 1
    `, [OWNER_ID, RUN_STARTED_AT.toISOString()])
    expect(selectedSession.active_role).toBe('owner')
    expect(selectedSession.active_organization_id).toBe(GARAGE_ID)
    evidence.acting_for_garage = {
      organisation_name: 'SYNTHETIC / UAT OPS01 GARAGE 20261022A',
      badge: selection.badge,
      selected_tenant_id: selection.tenantId,
      active_role: selectedSession.active_role,
      active_organization_id: selectedSession.active_organization_id,
      active_tenant_put_observed: selection.outcome === 'selected',
    }
    await openSites(page)
    evidence.authenticated_sites_url = page.url()

    // First remove the known active R3 residue through the rendered application.
    const residueCard = page.getByTestId('site-card').filter({ hasText: R3_RESIDUE_CODE })
    await expect(residueCard).toHaveCount(1)
    const residueWasActive = (await residueCard.getByText('Active', { exact: true }).count()) > 0
    let residueDeactivateAudit: any = null
    if (residueWasActive) {
      const residueDeactivateResponse = page.waitForResponse((r) =>
        r.url().includes(`/api/garage/sites/${R3_RESIDUE_ID}/status`) && r.request().method() === 'PATCH',
      )
      await residueCard.getByRole('button', { name: 'Deactivate' }).click()
      await assertMutation(residueDeactivateResponse, 'R3 residue deactivation')
      await expect(residueCard).toContainText('Inactive')
      residueDeactivateAudit = await requireAudit(client, 'GARAGE_SITE_DEACTIVATED', RUN_STARTED_AT,
        (row) => row.previous_value?.id === R3_RESIDUE_ID ||
          row.new_value?.id === R3_RESIDUE_ID ||
          row.previous_value?.branch_code === R3_RESIDUE_CODE ||
          row.new_value?.branch_code === R3_RESIDUE_CODE)
    }

    // Remove any active R4 residue left by an earlier interrupted certification attempt.
    const priorR4Residues = await client.query(`
      select id::text, branch_code
        from public.garage_branches
       where tenant_id=$1::uuid and branch_code like 'UAT-R4-%' and is_active=true
       order by branch_code
    `, [GARAGE_ID])
    const priorR4Cleanup: Array<Record<string, unknown>> = []
    for (const residue of priorR4Residues.rows) {
      const priorCard = page.getByTestId('site-card').filter({ hasText: residue.branch_code })
      await expect(priorCard).toHaveCount(1)
      const priorDeactivateResponse = page.waitForResponse((r) =>
        r.url().includes(`/api/garage/sites/${residue.id}/status`) && r.request().method() === 'PATCH',
      )
      await priorCard.getByRole('button', { name: 'Deactivate' }).click()
      await assertMutation(priorDeactivateResponse, `prior R4 residue ${residue.branch_code} deactivation`)
      await expect(priorCard).toContainText('Inactive')
      const priorAudit = await requireAudit(client, 'GARAGE_SITE_DEACTIVATED', RUN_STARTED_AT,
        (row) => row.previous_value?.id === residue.id ||
          row.new_value?.id === residue.id ||
          row.previous_value?.branch_code === residue.branch_code ||
          row.new_value?.branch_code === residue.branch_code)
      priorR4Cleanup.push({ id: residue.id, branch_code: residue.branch_code, audit_event_id: priorAudit.id })
    }

    const postResidueCleanup = await queryOne<any>(client, `
      select jsonb_build_object(
        'active_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=true),
        'primary_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_primary=true),
        'mechanic_memberships',(select count(*) from public.tenant_users where tenant_id=$1::uuid and role='mechanic'),
        'active_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active'),
        'live_primary',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary=true),
        'active_departments',(select count(*) from public.garage_departments where tenant_id=$1::uuid and is_active=true),
        'owner_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2)
      ) as state
    `, [GARAGE_ID, OWNER_ID])
    expect(Number(postResidueCleanup.state.active_sites)).toBe(3)
    expect(Number(postResidueCleanup.state.primary_sites)).toBe(1)
    expect(Number(postResidueCleanup.state.mechanic_memberships)).toBe(10)
    expect(Number(postResidueCleanup.state.active_workforce)).toBe(10)
    expect(Number(postResidueCleanup.state.live_primary)).toBe(10)
    expect(Number(postResidueCleanup.state.active_departments)).toBe(4)
    expect(Number(postResidueCleanup.state.owner_workforce)).toBe(0)
    evidence.residue_cleanup = {
      residue_id: R3_RESIDUE_ID,
      residue_code: R3_RESIDUE_CODE,
      was_active: residueWasActive,
      deactivated_via_ui: residueWasActive,
      deactivation_audit_event_id: residueDeactivateAudit?.id || null,
      prior_r4_cleanup: priorR4Cleanup,
      post_cleanup_fixture: postResidueCleanup.state,
    }

    // Desktop Sites: retained operating truth.
    for (const code of ['UAT-HRE-01','UAT-BYO-01','UAT-MSR-01']) {
      const card = page.getByTestId('site-card').filter({ hasText: code })
      await expect(card).toHaveCount(1)
      await expect(card.getByText('Active', { exact: true })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Deactivate' })).toBeVisible()
      await expect(card).toContainText('Timezone:')
      await expect(card).toContainText('Manager:')
    }
    await expect(page.getByTestId('site-card').filter({ hasText: 'Primary' })).toHaveCount(1)
    await page.screenshot({ path: path.join(RESULTS_DIR, 'desktop-sites.png'), fullPage: true })

    // Desktop Workforce: retained facts and contractor truth.
    await openWorkforce(page)
    evidence.authenticated_workforce_url = page.url()
    await expect(page.getByTestId('workforce-member').filter({ hasText: 'mechanic' })).toHaveCount(10)
    await selectMember(page, contractor.email)
    await expect(page.getByLabel('Classification')).toHaveValue('contractor')
    await expect(page.getByLabel('Start date')).toHaveValue(contractor.start_date)
    await page.screenshot({ path: path.join(RESULTS_DIR, 'desktop-workforce.png'), fullPage: true })

    // Physical no-fabrication Owner form.
    await selectMember(page, OWNER_EMAIL)
    const classification = page.getByLabel('Classification')
    const startDate = page.getByLabel('Start date')
    await expect(classification).toHaveValue('')
    await expect(startDate).toHaveValue('')
    await expect(classification.locator('option[value=""]')).toHaveText(/Select classification/i)
    await page.screenshot({ path: path.join(RESULTS_DIR, 'desktop-owner-empty-profile.png'), fullPage: true })

    await page.getByTestId('staff-code').fill(`R4-${RUN_SUFFIX}`)
    let createRequests = 0
    const countCreate = (req: any) => {
      if (req.method() === 'POST' && req.url().includes('/api/garage/workforce')) createRequests += 1
    }
    page.on('request', countCreate)
    await page.getByRole('button', { name: /create workforce profile/i }).click()
    const classValidation = await classification.evaluate((el: HTMLSelectElement) => ({
      valid: el.validity.valid,
      message: el.validationMessage,
    }))
    expect(classValidation.valid).toBe(false)
    expect(classValidation.message.length).toBeGreaterThan(0)
    expect(createRequests).toBe(0)
    expect(await ownerProfileCount(client)).toBe(0)
    await page.screenshot({ path: path.join(RESULTS_DIR, 'desktop-classification-validation.png'), fullPage: true })

    await classification.selectOption('owner')
    await page.getByRole('button', { name: /create workforce profile/i }).click()
    const dateValidation = await startDate.evaluate((el: HTMLInputElement) => ({
      valid: el.validity.valid,
      message: el.validationMessage,
    }))
    expect(dateValidation.valid).toBe(false)
    expect(dateValidation.message.length).toBeGreaterThan(0)
    expect(createRequests).toBe(0)
    expect(await ownerProfileCount(client)).toBe(0)
    await page.screenshot({ path: path.join(RESULTS_DIR, 'desktop-start-date-validation.png'), fullPage: true })
    page.off('request', countCreate)
    evidence.owner_no_fabrication = {
      classification_initial: '',
      start_date_initial: '',
      classification_validation_visible: true,
      start_date_validation_visible: true,
      profile_count_after_validation: 0,
    }

    // Create one temporary audit site through the rendered application.
    await openSites(page)
    await page.getByLabel('Branch code').fill(TEMP_SITE_CODE)
    await page.getByLabel('Name').fill(TEMP_SITE_NAME)
    await page.getByLabel('Address').fill('Synthetic R4 evidence address')
    await page.getByLabel('City').fill('Harare')
    await page.getByLabel('Province / state').fill('Harare')
    await page.getByLabel('Country code').fill('ZW')
    await page.getByLabel('Timezone').fill('Africa/Harare')
    await page.getByLabel('Manager').selectOption('')
    for (const day of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']) {
      await page.getByLabel(`${day} hours status`).selectOption('open')
      await page.getByLabel(`${day} opening time`).fill('08:00')
      await page.getByLabel(`${day} closing time`).fill('17:00')
    }
    const createSiteResponse = page.waitForResponse((r) =>
      r.url().endsWith('/api/garage/sites') && r.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Create site' }).click()
    await assertMutation(createSiteResponse, 'create site')
    await expect(page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })).toHaveCount(1)
    const tempSite = await queryOne<any>(client, `
      select id::text, branch_code, name, is_active, is_primary, is_public, manager_user_id
        from public.garage_branches
       where tenant_id=$1::uuid and branch_code=$2
    `, [GARAGE_ID, TEMP_SITE_CODE])
    expect(tempSite.is_active).toBe(true)
    expect(tempSite.is_primary).toBe(false)
    expect(tempSite.is_public).toBe(false)
    const siteCreateAudit = await requireAudit(client, 'GARAGE_SITE_CREATED', RUN_STARTED_AT,
      (row) => row.new_value?.id === tempSite.id || row.new_value?.branch_code === TEMP_SITE_CODE)

    // Site update.
    let tempCard = page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })
    await tempCard.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Name').fill(TEMP_SITE_UPDATED_NAME)
    const updateResponse = page.waitForResponse((r) =>
      r.url().includes(`/api/garage/sites/${tempSite.id}`) && r.request().method() === 'PATCH' &&
      !r.url().includes('/manager') && !r.url().includes('/status'),
    )
    await page.getByRole('button', { name: 'Save site' }).click()
    await assertMutation(updateResponse, 'update')
    const siteUpdateAudit = await requireAudit(client, 'GARAGE_SITE_UPDATED', RUN_STARTED_AT,
      (row) => row.previous_value?.name === TEMP_SITE_NAME && row.new_value?.name === TEMP_SITE_UPDATED_NAME)

    // Manager assignment and removal; role must stay mechanic.
    tempCard = page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })
    await tempCard.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Manager').selectOption(safeMechanic.user_id)
    const managerResponse = page.waitForResponse((r) =>
      r.url().includes(`/api/garage/sites/${tempSite.id}/manager`) && r.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Save site' }).click()
    await assertMutation(managerResponse, 'manager')
    const managerSetAudit = await requireAudit(client, 'GARAGE_SITE_MANAGER_CHANGED', RUN_STARTED_AT,
      (row) => row.new_value?.manager_user_id === safeMechanic.user_id)
    const roleCheck = await queryOne<any>(client,
      'select role from public.tenant_users where tenant_id=$1::uuid and user_id=$2',
      [GARAGE_ID, safeMechanic.user_id])
    expect(roleCheck.role).toBe('mechanic')

    tempCard = page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })
    await tempCard.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Manager').selectOption('')
    const managerRemoveResponse = page.waitForResponse((r) =>
      r.url().includes(`/api/garage/sites/${tempSite.id}/manager`) && r.request().method() === 'PATCH',
    )
    await page.getByRole('button', { name: 'Save site' }).click()
    await assertMutation(managerRemoveResponse, 'manager remove')
    const managerRemoveAudit = await requireAudit(client, 'GARAGE_SITE_MANAGER_CHANGED', RUN_STARTED_AT,
      (row) => row.new_value?.manager_user_id == null)

    // Temporary site lifecycle.
    tempCard = page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })
    const deactivateResponse = page.waitForResponse((r) =>
      r.url().includes(`/api/garage/sites/${tempSite.id}/status`) && r.request().method() === 'PATCH',
    )
    await tempCard.getByRole('button', { name: 'Deactivate' }).click()
    await assertMutation(deactivateResponse, 'deactivate')
    await expect(page.getByTestId('site-card').filter({ hasText: TEMP_SITE_CODE })).toContainText('Inactive')
    const siteDeactivateAudit = await requireAudit(client, 'GARAGE_SITE_DEACTIVATED', RUN_STARTED_AT)

    // Department rename and exact restoration.
    await openWorkforce(page)
    const originalDepartment = await queryOne<any>(client, `
      select id::text, name
        from public.garage_departments
       where tenant_id=$1::uuid and is_active=true
       order by case when name ilike '%administration%' then 0 else 1 end, name
       limit 1
    `, [GARAGE_ID])
    const originalDepartmentName = String(originalDepartment.name)
    const adminBadge = page.getByText(originalDepartmentName, { exact: true })
    await expect(adminBadge).toHaveCount(1)
    const adminRow = adminBadge.locator('..')
    await adminRow.getByRole('button', { name: 'Rename' }).click()
    await page.getByLabel('Rename department').fill(TEMP_DEPT_NAME)
    const deptUpdateResponse = page.waitForResponse((r) => r.url().includes('/api/garage/departments/') && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Save' }).click()
    await assertMutation(deptUpdateResponse, 'dept update')
    const deptChanged = await requireAudit(client, 'GARAGE_DEPARTMENT_UPDATED', RUN_STARTED_AT,
      (row) => row.new_value?.name === TEMP_DEPT_NAME)

    const tempDeptBadge = page.getByText(TEMP_DEPT_NAME, { exact: true })
    const tempDeptRow = tempDeptBadge.locator('..')
    await tempDeptRow.getByRole('button', { name: 'Rename' }).click()
    await page.getByLabel('Rename department').fill(originalDepartmentName)
    const deptRestoreResponse = page.waitForResponse((r) => r.url().includes('/api/garage/departments/') && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Save' }).click()
    await assertMutation(deptRestoreResponse, 'dept restore')
    const deptRestored = await requireAudit(client, 'GARAGE_DEPARTMENT_UPDATED', RUN_STARTED_AT,
      (row) => row.new_value?.name === originalDepartmentName)

    // Safe mechanic profile marker and restoration.
    await selectMember(page, safeMechanic.email)
    const notes = page.getByLabel('Internal operational notes')
    await notes.fill(NOTE_MARKER)
    await saveWorkforceProfile(page)
    const profileMarked = await requireAudit(client, 'GARAGE_WORKFORCE_PROFILE_UPDATED', RUN_STARTED_AT,
      (row) => row.new_value?.internal_notes === NOTE_MARKER)

    await selectMember(page, safeMechanic.email)
    await notes.fill(safeMechanic.internal_notes || '')
    await saveWorkforceProfile(page)
    const profileRestored = await requireAudit(client, 'GARAGE_WORKFORCE_PROFILE_UPDATED', RUN_STARTED_AT,
      (row) => (row.new_value?.internal_notes ?? null) === (safeMechanic.internal_notes ?? null))

    // Primary-site change through UI and exact restoration of additional assignments.
    await selectMember(page, safeMechanic.email)
    const primarySelect = page.getByTestId('primary-site')
    const alternateCode = siteById.get(alternate.id)?.branch_code
    expect(alternateCode).toBeTruthy()
    // If the alternate is currently an additional site, remove it before promoting it to primary.
    await selectAdditionalSite(page, alternateCode, false)
    await primarySelect.selectOption(alternate.id)
    await expect(primarySelect).toHaveValue(alternate.id)
    await saveWorkforceProfile(page)
    await expect.poll(async () => {
      const row = await queryOne<any>(client, `
        select a.branch_id::text as branch_id
          from public.garage_workforce_branch_assignments a
          join public.garage_workforce_profiles p on p.id=a.workforce_profile_id
         where p.tenant_id=$1::uuid and p.user_id=$2 and a.ended_at is null and a.is_primary=true
      `, [GARAGE_ID, safeMechanic.user_id])
      return row.branch_id
    }, { timeout: 15_000 }).toBe(alternate.id)
    const assignmentChanged = await requireAudit(client, 'GARAGE_WORKFORCE_BRANCH_ASSIGNMENT_CHANGED', RUN_STARTED_AT)
    const tempAssignments = await client.query(`
      select branch_id::text,is_primary,ended_at
        from public.garage_workforce_branch_assignments a
        join public.garage_workforce_profiles p on p.id=a.workforce_profile_id
       where p.tenant_id=$1::uuid and p.user_id=$2
       order by a.created_at asc
    `, [GARAGE_ID, safeMechanic.user_id])
    expect(tempAssignments.rows.filter((a) => a.ended_at == null && a.is_primary).length).toBe(1)
    expect(tempAssignments.rows.some((a) => a.branch_id === originalPrimary && a.ended_at != null)).toBe(true)

    await selectMember(page, safeMechanic.email)
    await primarySelect.selectOption(originalPrimary)
    for (const site of retainedSites) {
      if (site.id === originalPrimary) continue
      await selectAdditionalSite(page, site.branch_code, originalAdditional.includes(site.id))
    }
    await saveWorkforceProfile(page)
    await expect.poll(async () => {
      const row = await queryOne<any>(client, `
        select a.branch_id::text as branch_id
          from public.garage_workforce_branch_assignments a
          join public.garage_workforce_profiles p on p.id=a.workforce_profile_id
         where p.tenant_id=$1::uuid and p.user_id=$2 and a.ended_at is null and a.is_primary=true
      `, [GARAGE_ID, safeMechanic.user_id])
      return row.branch_id
    }, { timeout: 15_000 }).toBe(originalPrimary)
    const assignmentRestored = await requireAudit(client, 'GARAGE_WORKFORCE_BRANCH_ASSIGNMENT_CHANGED', RUN_STARTED_AT)

    // Lifecycle: active -> inactive -> pending -> exact primary/additional -> active via accepted save flow.
    await selectMember(page, safeMechanic.email)
    const inactiveResponse = page.waitForResponse((r) => r.url().includes(`/api/garage/workforce/${safeMechanic.user_id}/status`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Mark inactive' }).click()
    await assertMutation(inactiveResponse, 'inactive')
    const inactiveAudit = await requireAudit(client, 'GARAGE_WORKFORCE_STATUS_CHANGED', RUN_STARTED_AT,
      (row) => row.new_value?.employment_status === 'inactive')

    const pendingResponse = page.waitForResponse((r) => r.url().includes(`/api/garage/workforce/${safeMechanic.user_id}/status`) && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Prepare reactivation' }).click()
    await assertMutation(pendingResponse, 'pending')
    const pendingAudit = await requireAudit(client, 'GARAGE_WORKFORCE_STATUS_CHANGED', RUN_STARTED_AT,
      (row) => row.new_value?.employment_status === 'pending')

    await selectMember(page, safeMechanic.email)
    await primarySelect.selectOption(originalPrimary)
    for (const site of retainedSites) {
      if (site.id === originalPrimary) continue
      await selectAdditionalSite(page, site.branch_code, originalAdditional.includes(site.id))
    }
    await saveWorkforceProfile(page)
    await expect(page.getByTestId('workforce-profile-form')).toContainText('active', { timeout: 20_000 })
    const activeAudit = await requireAudit(client, 'GARAGE_WORKFORCE_STATUS_CHANGED', RUN_STARTED_AT,
      (row) => row.new_value?.employment_status === 'active')
    const activationAssignmentAudit = assignmentRestored

    // Exact mechanic truth restoration.
    const finalMechanic = await queryOne<any>(client, `
      select
        p.user_id,p.staff_code,p.employment_classification,p.start_date::text,p.employment_status,
        p.department_id::text,p.internal_notes,
        coalesce((select json_agg(json_build_object('branch_id',a.branch_id::text,'is_primary',a.is_primary) order by a.is_primary desc,a.branch_id::text)
                    from public.garage_workforce_branch_assignments a
                   where a.tenant_id=p.tenant_id and a.workforce_profile_id=p.id and a.ended_at is null), '[]'::json) as assignments,
        coalesce((select json_agg(s.skill_name order by s.skill_name)
                    from public.garage_workforce_skills s
                   where s.tenant_id=p.tenant_id and s.workforce_profile_id=p.id and s.removed_at is null), '[]'::json) as skills
      from public.garage_workforce_profiles p
      where p.tenant_id=$1::uuid and p.user_id=$2
    `, [GARAGE_ID, safeMechanic.user_id])
    expect(finalMechanic.staff_code).toBe(safeMechanic.staff_code)
    expect(finalMechanic.employment_classification).toBe(safeMechanic.employment_classification)
    expect(finalMechanic.start_date).toBe(safeMechanic.start_date)
    expect(finalMechanic.employment_status).toBe('active')
    expect(finalMechanic.department_id).toBe(safeMechanic.department_id)
    expect(finalMechanic.internal_notes ?? null).toBe(safeMechanic.internal_notes ?? null)
    expect(finalMechanic.skills).toEqual(safeMechanic.skills)
    expect(finalMechanic.assignments.filter((a: any) => a.is_primary).map((a: any) => a.branch_id)).toEqual([originalPrimary])
    expect(finalMechanic.assignments.filter((a: any) => !a.is_primary).map((a: any) => a.branch_id).sort()).toEqual([...originalAdditional].sort())

    // Compact/mobile UAT reuses the same real authenticated browser session.
    await page.setViewportSize({ width: 390, height: 844 })
    await openSites(page)
    for (const code of ['UAT-HRE-01','UAT-BYO-01','UAT-MSR-01']) {
      const card = page.getByTestId('site-card').filter({ hasText: code })
      await expect(card).toBeVisible()
      await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible()
    }
    await expect(page.getByTestId('site-form')).toBeVisible()
    await page.screenshot({ path: path.join(RESULTS_DIR, 'mobile-sites.png'), fullPage: true })

    await openWorkforce(page)
    await selectMember(page, safeMechanic.email)
    await expect(page.getByLabel('Classification')).toBeVisible()
    await expect(page.getByLabel('Start date')).toBeVisible()
    await expect(page.getByTestId('primary-site')).toBeVisible()
    await expect(page.getByRole('button', { name: /save workforce profile/i })).toBeVisible()
    await page.screenshot({ path: path.join(RESULTS_DIR, 'mobile-workforce.png'), fullPage: true })

    // Final reconciliation and mandatory event coverage.
    const finalState = await queryOne<any>(client, `
      select jsonb_build_object(
        'active_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=true),
        'inactive_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=false),
        'primary_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_primary=true),
        'mechanic_memberships',(select count(*) from public.tenant_users where tenant_id=$1::uuid and role='mechanic'),
        'active_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active'),
        'pending_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending'),
        'inactive_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive'),
        'live_primary',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary=true),
        'historical_assignments',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is not null),
        'active_departments',(select count(*) from public.garage_departments where tenant_id=$1::uuid and is_active=true),
        'owner_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2),
        'garage_audit_events',(select count(*) from public.trust_audit_events where actor_tenant_id=$1 and actor_user_id=$2 and created_at >= $3::timestamptz)
      ) as state
    `, [GARAGE_ID, OWNER_ID, RUN_STARTED_AT.toISOString()])
    expect(Number(finalState.state.active_sites)).toBe(3)
    expect(Number(finalState.state.primary_sites)).toBe(1)
    expect(Number(finalState.state.mechanic_memberships)).toBe(10)
    expect(Number(finalState.state.active_workforce)).toBe(10)
    expect(Number(finalState.state.pending_workforce)).toBe(0)
    expect(Number(finalState.state.inactive_workforce)).toBe(0)
    expect(Number(finalState.state.live_primary)).toBe(10)
    expect(Number(finalState.state.active_departments)).toBe(4)
    expect(Number(finalState.state.owner_workforce)).toBe(0)
    expect(Number(finalState.state.garage_audit_events)).toBeGreaterThan(0)

    const allAudits = await auditRows(client, RUN_STARTED_AT)
    const requiredTypes = [
      'GARAGE_SITE_CREATED',
      'GARAGE_SITE_UPDATED',
      'GARAGE_SITE_MANAGER_CHANGED',
      'GARAGE_SITE_DEACTIVATED',
      'GARAGE_DEPARTMENT_UPDATED',
      'GARAGE_WORKFORCE_PROFILE_UPDATED',
      'GARAGE_WORKFORCE_BRANCH_ASSIGNMENT_CHANGED',
      'GARAGE_WORKFORCE_STATUS_CHANGED',
    ]
    for (const type of requiredTypes) expect(allAudits.some((row) => row.event_type === type), `missing ${type}`).toBe(true)

    const sanitizedAudits = allAudits.map((row) => ({
      event_id: row.id,
      event_type: row.event_type,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      actor_tenant_id: row.actor_tenant_id,
      source_route: row.source_route,
      created_at: row.created_at,
      previous_value_present: row.previous_value != null,
      new_value_present: row.new_value != null,
    }))
    writeJson('garage-r4-audit-events.json', {
      product_sha: PRODUCT_SHA,
      run_started_at: RUN_STARTED_AT.toISOString(),
      required_event_types: requiredTypes,
      events: sanitizedAudits,
      representative_event_ids: {
        site_created: siteCreateAudit.id,
        site_updated: siteUpdateAudit.id,
        manager_set: managerSetAudit.id,
        manager_removed: managerRemoveAudit.id,
        site_deactivated: siteDeactivateAudit.id,
        department_changed: deptChanged.id,
        department_restored: deptRestored.id,
        profile_marked: profileMarked.id,
        profile_restored: profileRestored.id,
        assignment_changed: assignmentChanged.id,
        assignment_restored: assignmentRestored.id,
        workforce_inactive: inactiveAudit.id,
        workforce_pending: pendingAudit.id,
        workforce_active: activeAudit.id,
        activation_assignment: activationAssignmentAudit.id,
      },
    })
    writeJson('garage-r4-final-state.json', {
      product_sha: PRODUCT_SHA,
      temporary_site: { id: tempSite.id, branch_code: TEMP_SITE_CODE, final_status: 'inactive', is_primary: false },
      mechanic_restored: {
        user_id: finalMechanic.user_id,
        staff_code: finalMechanic.staff_code,
        employment_classification: finalMechanic.employment_classification,
        start_date: finalMechanic.start_date,
        employment_status: finalMechanic.employment_status,
        department_id: finalMechanic.department_id,
        primary_site_id: originalPrimary,
        additional_site_ids: originalAdditional,
        internal_notes_restored: (finalMechanic.internal_notes ?? null) === (safeMechanic.internal_notes ?? null),
      },
      final_state: finalState.state,
      run_finished_at: new Date().toISOString(),
    })
    evidence.final_state = finalState.state
    evidence.required_event_coverage = requiredTypes
    writeJson('garage-r4-browser-summary.json', evidence)
  } catch (error) {
    const err = error as any
    failureDetails = {
      message: String(err?.message || err),
      stack: typeof err?.stack === 'string' ? err.stack.slice(0, 4000) : null,
      timestamp: new Date().toISOString(),
    }
    throw error
  } finally {
    const stateAtExit = await queryOne<any>(client, `
      select jsonb_build_object(
        'active_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=true),
        'inactive_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_active=false),
        'primary_sites',(select count(*) from public.garage_branches where tenant_id=$1::uuid and is_primary=true),
        'mechanic_memberships',(select count(*) from public.tenant_users where tenant_id=$1::uuid and role='mechanic'),
        'active_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='active'),
        'pending_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='pending'),
        'inactive_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and employment_status='inactive'),
        'live_primary',(select count(*) from public.garage_workforce_branch_assignments a join public.garage_workforce_profiles p on p.id=a.workforce_profile_id where p.tenant_id=$1::uuid and a.ended_at is null and a.is_primary=true),
        'active_departments',(select count(*) from public.garage_departments where tenant_id=$1::uuid and is_active=true),
        'owner_workforce',(select count(*) from public.garage_workforce_profiles where tenant_id=$1::uuid and user_id=$2)
      ) as state
    `, [GARAGE_ID, OWNER_ID]).catch((error) => ({ state: null, error: String((error as any)?.message || error) }))
    const auditsAtExit = await auditRows(client, RUN_STARTED_AT).catch(() => [])
    const sanitizedExitAudits = auditsAtExit.map((row) => ({
      event_id: row.id,
      event_type: row.event_type,
      actor_user_id: row.actor_user_id,
      actor_role: row.actor_role,
      actor_tenant_id: row.actor_tenant_id,
      source_route: row.source_route,
      created_at: row.created_at,
      previous_value_present: row.previous_value != null,
      new_value_present: row.new_value != null,
    }))
    writeJson('garage-r4-state-at-exit.json', {
      product_sha: PRODUCT_SHA,
      run_started_at: RUN_STARTED_AT.toISOString(),
      state: stateAtExit.state || null,
      query_error: stateAtExit.error || null,
      failure: failureDetails,
    })
    writeJson('garage-r4-audit-events-so-far.json', {
      product_sha: PRODUCT_SHA,
      run_started_at: RUN_STARTED_AT.toISOString(),
      events: sanitizedExitAudits,
    })
    writeJson('garage-r4-browser-failure.json', {
      product_sha: PRODUCT_SHA,
      failed: Boolean(failureDetails),
      failure: failureDetails,
      mutation_failures: mutationFailures,
    })
    await client.end().catch(() => {})
  }
})
