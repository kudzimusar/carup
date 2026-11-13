/**
 * RX-02A S1-4B — shared path-matching utility (production-intent).
 */
export function isActivePath(currentPath: string, href: string): boolean {
  const base = href.split('?')[0]
  if (!base || base === '#') return false
  return currentPath === base || (base !== '/' && currentPath.startsWith(base + '/'))
}
