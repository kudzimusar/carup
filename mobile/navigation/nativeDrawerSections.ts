/**
 * Native drawer section resolver (Milestone C) — PURE governance logic.
 *
 * This is the testable core of `NativeDrawer.tsx`: it turns governed feature
 * truth (the same `NativeNavContext` the tabs consume) into the ordered list of
 * drawer sections + entries the panel renders. It is RN-runtime-free (no React /
 * react-native imports) so it can be unit-tested with `npx tsx`.
 *
 * Governance + anti-leakage rules enforced here (so the UI cannot break them):
 *  - Entries are driven by the manifest selectors (`getNativeDrawer`, plus the
 *    governed tab entries reused for Discover), so every link maps to a REAL,
 *    governed native screen. No fabricated screens, no web-only routes.
 *  - DEDUPE: an entry that is already a VISIBLE TAB for this context is dropped
 *    from the drawer (no duplication of the bottom tab bar).
 *  - NO EMPTY SECTIONS: a section with zero entries (and no account actions) is
 *    omitted entirely.
 *  - Account / Support hold non-navigation affordances (role label, role switch,
 *    sign in / sign out, static help) — they are gated by auth, not by a screen.
 */
import type { UserRole } from '@shared/types';
import type { NativeNavContext } from './types';
import {
  NATIVE_NAV,
  getNativeDrawer,
  getNativeTabs,
  resolveEntryOwner,
  type ResolvedNativeEntry,
} from './nativeNavigationManifest';

/** Stable ids for the non-navigation account/support affordances. */
export type DrawerActionId =
  | 'account.role'
  | 'account.switch-owner'
  | 'account.signin'
  | 'account.signout';

/** A navigable drawer row — always backed by a real, governed Expo route. */
export interface DrawerLinkItem {
  kind: 'link';
  /** Manifest entry id (stable, for keys/tests). */
  id: string;
  label: string;
  iconName: string;
  /** Real Expo Router route to navigate to (never a web-only path). */
  expoRoute: string;
  /** Owning governed feature id (for traceability/route boundaries). */
  featureId: string;
}

/** A non-navigation affordance (role switch, sign in/out, role label, help). */
export interface DrawerActionItem {
  kind: 'action';
  id: DrawerActionId;
  label: string;
  iconName: string;
  /** Purely informational (e.g. the role label) — not pressable. */
  readOnly?: boolean;
  /** Visually marks a destructive action (sign out). */
  destructive?: boolean;
}

export type DrawerItem = DrawerLinkItem | DrawerActionItem;

/** A rendered drawer section. Never emitted empty. */
export interface DrawerSection {
  id: string;
  title: string;
  items: DrawerItem[];
}

/** Section ids in render order. */
export const DRAWER_SECTION_ORDER = [
  'discover',
  'my-work',
  'trust',
  'account',
  'support',
] as const;

/** Human title per section id. */
const SECTION_TITLES: Record<(typeof DRAWER_SECTION_ORDER)[number], string> = {
  discover: 'Discover',
  'my-work': 'My Work',
  trust: 'Trust & Verification',
  account: 'Account',
  support: 'Support',
};

/**
 * Which manifest entry ids belong in the DISCOVER section when they survive
 * governance AND are not already a visible tab. Marketplace is normally a tab
 * (so it dedupes out), but if a role/governance state hides it as a tab it can
 * still surface here — always a real screen.
 */
const DISCOVER_ENTRY_IDS = new Set(['native.marketplace']);

/**
 * Which manifest entry ids belong in MY WORK (owner work area). SafePay/escrow
 * and Referrals are drawer-placed owner work items; Garage appears only if it
 * is NOT already a visible tab.
 */
const MY_WORK_ENTRY_IDS = new Set(['native.garage', 'native.referral', 'native.escrow']);

/**
 * TRUST & VERIFICATION links — ONLY real native screens. There is no native
 * verification/search screen, so this set is intentionally EMPTY: we omit the
 * section rather than leak a web-only route. Kept as a seam for when a real
 * native trust screen ships.
 */
const TRUST_ENTRY_IDS = new Set<string>([]);

/** Pretty, human label for a role. */
function roleLabel(role: UserRole | null): string {
  if (!role) return 'Guest';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function toLink(entry: ResolvedNativeEntry): DrawerLinkItem {
  return {
    kind: 'link',
    id: entry.id,
    label: entry.label,
    iconName: entry.iconName,
    expoRoute: entry.expoRoute,
    featureId: entry.resolvedFeatureId,
  };
}

/**
 * Build the governed drawer sections for a context.
 *
 * @param ctx governed navigation context (role/auth/effective states)
 * @returns ordered, non-empty sections; links are deduped against visible tabs.
 */
export function resolveDrawerSections(ctx: NativeNavContext): DrawerSection[] {
  // The set of entry ids already shown as a VISIBLE bottom tab — never duplicate.
  const visibleTabIds = new Set(getNativeTabs(ctx).map((e) => e.id));

  // The governed, drawer-placed entries (e.g. SafePay/escrow).
  const drawerEntries = getNativeDrawer(ctx);

  // Governed TAB entries are reused for Discover / My Work when they are NOT a
  // visible tab (e.g. a tab hidden by governance can still be reachable here).
  const tabEntries = NATIVE_NAV.filter((e) => e.placement === 'tab')
    // Re-run the same eligibility the tab selector uses, but WITHOUT the ≤5 cap,
    // by asking getNativeTabs for the full eligible set (cap is 5; we never have
    // >5 tab entries, so this is the eligible set). For correctness across
    // governance we compute eligibility through getNativeTabs of the FULL list.
    .map((e) => e.id);

  // Eligible (governed-visible) tab entries, resolved with owners.
  const eligibleTabEntries: ResolvedNativeEntry[] = getNativeTabs(ctx);

  // Index resolved entries by id for lookup.
  const byId = new Map<string, ResolvedNativeEntry>();
  for (const e of [...drawerEntries, ...eligibleTabEntries]) byId.set(e.id, e);
  void tabEntries; // (kept for readability; lookups use byId)

  /** Real, governed-visible, non-duplicated links for a set of entry ids. */
  function linksFor(entryIds: Set<string>): DrawerLinkItem[] {
    const out: DrawerLinkItem[] = [];
    for (const id of entryIds) {
      const entry = byId.get(id);
      if (!entry) continue; // not governed-visible for this context
      if (visibleTabIds.has(id)) continue; // already a visible tab ⇒ dedupe
      out.push(toLink(entry));
    }
    // Stable order by manifest `order`.
    const orderById = new Map(NATIVE_NAV.map((e) => [e.id, e.order]));
    return out.sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0));
  }

  const sections: DrawerSection[] = [];

  // ── Discover ────────────────────────────────────────────────────────────────
  const discover = linksFor(DISCOVER_ENTRY_IDS);
  if (discover.length > 0) {
    sections.push({ id: 'discover', title: SECTION_TITLES.discover, items: discover });
  }

  // ── My Work ─────────────────────────────────────────────────────────────────
  const myWork = linksFor(MY_WORK_ENTRY_IDS);
  if (myWork.length > 0) {
    sections.push({ id: 'my-work', title: SECTION_TITLES['my-work'], items: myWork });
  }

  // ── Trust & Verification (real native screens ONLY — currently none) ─────────
  const trust = linksFor(TRUST_ENTRY_IDS);
  if (trust.length > 0) {
    sections.push({ id: 'trust', title: SECTION_TITLES.trust, items: trust });
  }

  // ── Account (role label + role switch + sign in/out) ─────────────────────────
  const accountItems: DrawerItem[] = [];
  if (ctx.isAuthenticated) {
    accountItems.push({
      kind: 'action',
      id: 'account.role',
      label: `Signed in as ${roleLabel(ctx.role)}`,
      iconName: 'Home',
      readOnly: true,
    });
    // A role switch is only meaningful when not already the owner default.
    if (ctx.role && ctx.role !== 'owner') {
      accountItems.push({
        kind: 'action',
        id: 'account.switch-owner',
        label: 'Switch to Owner',
        iconName: 'Home',
      });
    }
    accountItems.push({
      kind: 'action',
      id: 'account.signout',
      label: 'Sign out',
      iconName: 'Home',
      destructive: true,
    });
  } else {
    accountItems.push({
      kind: 'action',
      id: 'account.signin',
      label: 'Sign in',
      iconName: 'Home',
    });
  }
  // Account always has ≥1 item (sign in OR role+sign out), so never empty.
  sections.push({ id: 'account', title: SECTION_TITLES.account, items: accountItems });

  // ── Support (static help — link only to real native screens or omit) ─────────
  // There is no native help/about screen, so Support currently surfaces nothing
  // navigable; we omit it rather than leak a web-only route. (Seam: add real
  // native support links here when they ship.)
  // (Intentionally no items ⇒ section omitted.)

  return sections;
}

/** True if any link in the resolved sections points at the given route. */
export function drawerHasRoute(sections: DrawerSection[], expoRoute: string): boolean {
  return sections.some((s) =>
    s.items.some((i) => i.kind === 'link' && i.expoRoute === expoRoute),
  );
}

/** The governed presentation of the 5th "More" tab. */
export interface MoreTabPlan {
  /** Tab label. */
  title: string;
  /** Abstract icon name (fed to `getNativeIcon`). */
  iconName: string;
  /**
   * What the tab does on press:
   *  - 'drawer' (authed): open the governed NativeDrawer (no navigation).
   *  - 'signin' (anon): route to login instead of opening an empty drawer.
   */
  action: 'drawer' | 'signin';
}

/**
 * The More tab is ALWAYS present (it is the predictable native navigation hub).
 * For authenticated users it opens the drawer; for anonymous users it offers a
 * sign-in affordance rather than an near-empty menu.
 */
export function resolveMoreTab(ctx: NativeNavContext): MoreTabPlan {
  if (ctx.isAuthenticated) {
    return { title: 'More', iconName: 'Menu', action: 'drawer' };
  }
  return { title: 'Sign in', iconName: 'Home', action: 'signin' };
}

/** Resolve the owning feature id for an entry under a role (re-export helper). */
export { resolveEntryOwner };
