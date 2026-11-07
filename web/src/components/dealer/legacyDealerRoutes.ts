/** R6 E: legacy global-role dealer bookmarks → canonical claim-first dealer workspace. */
const CANONICAL_TARGETS:Readonly<Record<string,string>>=Object.freeze({
  '/dealer':'/dealer/dashboard',
  '/dealer/inventory':'/dealers/stock',
  '/dealer/leads':'/dealers/inquiries',
  '/dealer/promotions':'/dealer/dashboard',
  '/dealer/analytics':'/dealer/dashboard',
  '/dealer/evidence':'/dealers/stock',
})
export function legacyDealerCanonicalTarget(pathname:string):string|null{
  const clean=pathname.length>1?pathname.replace(/\/+$/,''):pathname
  return Object.hasOwn(CANONICAL_TARGETS,clean)?CANONICAL_TARGETS[clean]:null
}
