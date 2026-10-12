export const NATIVE_SHELL_TABS = [
  { name: 'index', title: 'Home', icon: 'home-outline' },
  { name: 'marketplace', title: 'Market', icon: 'search-outline' },
  { name: 'inbox', title: 'Inbox', icon: 'chatbubbles-outline' },
  { name: 'account', title: 'Account', icon: 'person-circle-outline' },
] as const;

export type NativeShellTabName = (typeof NATIVE_SHELL_TABS)[number]['name'];

export const LEGACY_TAB_ROUTES = [
  'garage',
  'escrow',
  'referral',
  'communications',
  'more',
] as const;

export function nativeShellNames(): NativeShellTabName[] {
  return NATIVE_SHELL_TABS.map((tab) => tab.name);
}
