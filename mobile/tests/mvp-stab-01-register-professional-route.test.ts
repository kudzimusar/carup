import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * CARUP-MVP-STAB-01 F-021 — Native registration creates a Car Owner account only and records no
 * business type, so a garage cannot apply from the app. The screen must say truthfully where a garage
 * or service centre registers (the CarUp website's business registration, then the garage application),
 * instead of "onboarded separately by the CarUp team". The app has no configured web origin, so it
 * names the route in words and invents no link.
 */

const root = resolve(__dirname, '..');
const register = readFileSync(join(root, 'app/(auth)/register.tsx'), 'utf8');
const flat = register.replace(/\s+/g, ' ');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === 'tests' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|json)$/.test(name) ? [path] : [];
  });
}

describe('CARUP-MVP-STAB-01 F-021 · Native registration states the real route for a garage', () => {
  it('names the website route a garage or service centre actually takes', () => {
    expect(flat).toContain('Registering a garage or service centre?');
    expect(flat).toContain(
      'Garage and service-centre accounts are created on the CarUp website: create an account there, choose Business / professional, pick Garage / service centre as the business type, then complete the garage application.',
    );
    expect(register).toMatch(/accessibilityRole="header"[^>]*>\s*Registering a garage or service centre\?/);
  });

  it('uses the web registration labels word for word', () => {
    const web = readFileSync(resolve(root, '../web/src/pages/auth/Register.tsx'), 'utf8');
    expect(web).toContain('title="Business / professional"');
    expect(web).toContain("['garage', 'Garage / service centre']");
  });

  it('no longer claims the CarUp team onboards businesses separately', () => {
    expect(flat).not.toMatch(/onboarded separately/i);
    expect(flat).toContain('Dealers and other automotive businesses also register on the website under Business / professional.');
  });

  it('still creates a Car Owner account only, and records no business type here', () => {
    expect(register).toContain("body: JSON.stringify({ ...data, role: 'owner' })");
    expect(register).not.toMatch(/registration_profile|business_type|organization_name/);
  });

  it('invents no web link while the app has no configured web origin', () => {
    const configured = sourceFiles(root).some((file) => /EXPO_PUBLIC_WEB(SITE)?_(URL|ORIGIN)/.test(readFileSync(file, 'utf8')));
    expect(configured, 'a web origin now exists: offer a button to <web>/register and update this test').toBe(false);
    expect(register).not.toMatch(/https?:\/\/|Linking|openURL|WebBrowser/);
  });
});
