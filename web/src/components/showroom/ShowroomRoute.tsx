/**
 * RX03 — chooses the page composition inside an already-guarded route.
 *
 * Order of authority is unchanged: UnifiedRouteShell → MainLayout → RegistryRouteBoundary (feature
 * lifecycle) → THIS switch → page. The switch therefore cannot admit anything the guards refused;
 * it only decides which composition renders once they have admitted the route.
 *
 * With the showroom presentation OFF (the default, and the only possible state in a production
 * build without VITE_CARUP_SHOWROOM_PAGES=on) the accepted page renders and the showroom code is
 * never downloaded: it lives in a lazy chunk that is requested only when this switch selects it.
 */
import { Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { LazyRouteBoundary } from '@/components/routing/LazyRouteBoundary'
import { isShowroomPagesEnabled } from '@/lib/presentationFlags'

function ShowroomRouteLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite" data-testid="showroom-route-loading">
      <span className="text-sm text-slate-500">Loading…</span>
    </div>
  )
}

export function ShowroomRoute({
  accepted,
  showroom: Showroom,
}: {
  accepted: ReactNode
  showroom: LazyExoticComponent<ComponentType> | ComponentType
}) {
  if (!isShowroomPagesEnabled()) return <>{accepted}</>
  return (
    <LazyRouteBoundary>
      <Suspense fallback={<ShowroomRouteLoading />}>
        <div data-presentation="showroom" className="contents">
          <Showroom />
        </div>
      </Suspense>
    </LazyRouteBoundary>
  )
}
