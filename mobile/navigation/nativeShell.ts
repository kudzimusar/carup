export const NATIVE_SHELL_TABS = [
  { name: 'index', title: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'marketplace', title: 'Buy', icon: 'search-outline', activeIcon: 'search' },
  { name: 'verify', title: 'Verify', icon: 'shield-checkmark-outline', activeIcon: 'shield-checkmark' },
  { name: 'sell', title: 'Sell', icon: 'pricetag-outline', activeIcon: 'pricetag' },
  { name: 'trade', title: 'Trade', icon: 'cube-outline', activeIcon: 'cube' },
] as const;

export type NativeShellTabName = (typeof NATIVE_SHELL_TABS)[number]['name'];

export const LEGACY_TAB_ROUTES = [
  'account',
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
