export const NATIVE_SHELL_TABS = [
  { name: 'index', title: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'marketplace', title: 'Market', icon: 'search-outline', activeIcon: 'search' },
  { name: 'verify', title: 'Verify', icon: 'shield-checkmark-outline', activeIcon: 'shield-checkmark' },
  { name: 'sell', title: 'Sell', icon: 'pricetag-outline', activeIcon: 'pricetag' },
  { name: 'account', title: 'Account', icon: 'person-circle-outline', activeIcon: 'person-circle' },
] as const;

export type NativeShellTabName = (typeof NATIVE_SHELL_TABS)[number]['name'];

export const LEGACY_TAB_ROUTES = [
  'inbox',
  'garage',
  'escrow',
  'referral',
  'communications',
  'more',
] as const;

export function nativeShellNames(): NativeShellTabName[] {
  return NATIVE_SHELL_TABS.map((tab) => tab.name);
}
