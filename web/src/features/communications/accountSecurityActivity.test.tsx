import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, relative), 'utf8');
const page = read('../../pages/dashboard/owner/Communications.tsx');
const api = read('../../hooks/useCarUpApi.ts');

describe('owner Account & security Email visibility', () => {
  it('keeps security Email out of conversations while restoring a safe delivery-status rail', () => {
    expect(page).toContain('Account & security');
    expect(page).toContain('fetchCommunicationAccountActivity');
    expect(page).toContain('Security Emails are visible here as delivery activity only');
    expect(page).toContain('resend-verification-email');
    expect(api).toContain("request('/communications/account-activity'");
    expect(api).toContain("request('/auth/resend-verification'");
  });
});
