import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { rememberPendingReturnTo } from '@/lib/pendingReturnTo'

export default function ScrollToTop() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
    rememberPendingReturnTo(pathname, search)
  }, [pathname, search])

  return null
}
