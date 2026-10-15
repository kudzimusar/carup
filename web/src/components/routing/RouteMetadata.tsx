import { useLocation } from 'react-router-dom'
import { pageMetadata } from '@/config/publicPageMetadata'
import { usePageMetadata } from '@/lib/usePageMetadata'
/** Client navigation mirrors server document indexing policy; private routes never retain public metadata. */
export function RouteMetadata() {
  const { pathname } = useLocation()
  usePageMetadata(pageMetadata(pathname, import.meta.env.VITE_SEARCH_INDEXABLE !== 'true'))
  return null
}
