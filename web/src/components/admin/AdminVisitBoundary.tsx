/**
 * CA-OWNER-02-R3 (D6) — the edge of an operational Admin visit. Rendered once for every route (App.tsx, beside RouteMetadata):
 * when a page outside the operational Admin renders — Corporate Admin, the public site, any other portal — the remembered
 * "You came from Corporate Admin" arrival is forgotten, so a later direct visit to /admin never claims it.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { forgetCorporateArrival, isOperationalAdminPath } from './adminArrival'

export function AdminVisitBoundary() {
  const { pathname } = useLocation()
  const inside = isOperationalAdminPath(pathname)
  useEffect(() => { if (!inside) forgetCorporateArrival() }, [inside])
  return null
}
