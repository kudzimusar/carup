import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CARUP-MVP-STAB-01 F-011 (Native) — the words a customer reads on these screens are CarUp's words, not
 * the implementation's. Every string literal and JSX text in the listed files is checked (comments,
 * identifiers and query keys are not shown to anyone, so they are not checked). The Home banner after
 * Send, the purchase / SafePay screen, check-car, the selfie notice, the filter sheet and the inquiry
 * error are the surfaces the client dry run walks through.
 */
const FILES = [
  'app/(tabs)/index.tsx',
  'app/vehicle/[vin]/transaction.tsx',
  'app/check-car.tsx',
  'app/(auth)/verification/selfie.tsx',
  'components/marketplace/MarketplaceFilterSheet.tsx',
  'utils/communicationApi.ts',
];
const IMPLEMENTATION_TERMS = /\b(governed|canonical|provenance|authoritative|state machine|participant-scoped)\b/i;

function customerStrings(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const literals = code.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
  const jsxText = (code.match(/>[^<>{}]+</g) || []).map((t) => t.slice(1, -1));
  return [...literals, ...jsxText]
    .map((text) => text.replace(/\$\{[^}]*\}/g, ''))
    .filter((text) => !/^['"`](?:[a-z0-9_-]+|@?[./][^'"`]*)['"`]$/i.test(text.trim()));
}

describe('Native customer copy speaks plainly (CARUP-MVP-STAB-01 F-011)', () => {
  for (const file of FILES) {
    it(`${file} shows no implementation terms`, () => {
      const found = customerStrings(readFileSync(resolve(__dirname, '..', file), 'utf8')).filter((text) => IMPLEMENTATION_TERMS.test(text));
      expect(found).toEqual([]);
    });
  }

  it('the Home banner after Send says the message was sent and no second conversation is started', () => {
    const home = readFileSync(resolve(__dirname, '..', 'app/(tabs)/index.tsx'), 'utf8');
    expect(home).toContain('Your message was sent. CarUp is still preparing the conversation — it will appear in your Inbox, and CarUp will not start a second one.');
  });

  it('the scanner sees planted implementation language, so the checks above are not measuring nothing', () => {
    expect(customerStrings("const a = 'Checked by the canonical authority';").some((text) => IMPLEMENTATION_TERMS.test(text))).toBe(true);
    expect(customerStrings('<Text>governed record</Text>').some((text) => IMPLEMENTATION_TERMS.test(text))).toBe(true);
  });
});
