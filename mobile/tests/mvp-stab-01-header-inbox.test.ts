import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CARUP-MVP-STAB-01 F-031 — the header control is the Inbox and says so truthfully.
 *
 * It looked like a notifications bell, its number summed `unread_count` (unread MESSAGES per thread)
 * while its label said "unread conversations", and a failed read showed no badge, which looks like
 * zero. Source-level contract (the header is a React Native component the node test runner cannot
 * render); each assertion was checked to fail against the previous header.
 */
const header = readFileSync(resolve('components/navigation/NativeSharedHeader.tsx'), 'utf8');

describe('header Inbox control', () => {
  it('is an Inbox control that opens the Inbox', () => {
    expect(header).toContain('icon="chatbubbles-outline"');
    expect(header).not.toContain('notifications-outline');
    expect(header).toContain('accessibilityLabel="Inbox and Profile"');
    expect(header).toContain("router.push('/(tabs)/inbox' as never)");
    expect(header).not.toMatch(/Notifications/);
  });

  it('counts conversations with something unread, never the sum of unread messages', () => {
    expect(header).toMatch(/\.filter\(\s*\(thread: any\) => Number\(thread\?\.unread_count \|\| 0\) > 0,\s*\)\.length/);
    expect(header).not.toMatch(/reduce\(\s*\(sum/);
    expect(header).not.toMatch(/sum \+ Math\.max\(0, Number\(thread\?\.unread_count/);
    expect(header).toContain('badge={!unreadUnavailable && unreadConversations > 0 ? unreadConversations : undefined}');
    // The badge keeps its 99+ cap.
    expect(header).toContain("badge > 99 ? '99+' : String(badge)");
  });

  it('labels the count in plain words, singular and plural, and says when it is unknown', () => {
    expect(header).toContain("'Inbox, unread count unavailable'");
    expect(header).toContain("`Inbox, ${unreadConversations} unread conversation${unreadConversations === 1 ? '' : 's'}`");
    expect(header).toContain(": 'Inbox';");
    expect(header).toContain('const unreadUnavailable = canReadInbox && threadsQuery.isError;');
  });
});
