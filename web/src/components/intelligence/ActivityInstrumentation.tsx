/**
 * CarUp Intelligence 1.0 — web instrumentation mount (I3b).
 *
 * Renders nothing. It exists so that instrumentation is wired in exactly ONE
 * place instead of being sprinkled through pages:
 *
 *  - registers the activity-context provider with the shared api client, so every
 *    request from every page carries the shopper's session and page-view context
 *    and a SERVER-emitted observation can be attributed and stage-linked;
 *  - rotates the page-view id on each route change, because the contract makes
 *    page_view_id the unit of "one view" — a soft navigation to another listing
 *    must be a new view, a data refetch within a screen must not;
 *  - starts the batched flush loop for client-emitted events;
 *  - keeps the identity headers used for the CSRF-bound flush in sync, and clears
 *    the pseudonymous session on logout so a shared device does not carry one
 *    person's behaviour into the next person's session.
 */
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { setActivityContextProvider } from '../../lib/apiClient'
import {
  activityContextHeaders,
  rotatePageView,
  startActivityClient,
  stopActivityClient,
  setActivityAuthHeaders,
  resetActivityIdentity,
  flush,
} from '../../lib/intelligenceActivity'
import { useAuth } from '../../context/AuthContext'

export default function ActivityInstrumentation() {
  const { pathname } = useLocation()
  const { user, token, isAuthenticated } = useAuth()

  useEffect(() => {
    setActivityContextProvider(activityContextHeaders)
    startActivityClient()
    return () => {
      setActivityContextProvider(null)
      stopActivityClient()
    }
  }, [])

  // A route change is a new page view. Pending client events are flushed first so
  // they are attributed to the view they actually happened in.
  useEffect(() => {
    void flush()
    rotatePageView()
  }, [pathname])

  // `isAuthenticated` is false for every GUEST, not only after a logout, so
  // resetting on the bare value would mint a new session key on every anonymous
  // page load — breaking anonymous unique counts and severing the view→inquiry
  // stage link that the whole funnel depends on. Only a true→false TRANSITION is
  // a logout.
  const wasAuthenticated = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      if (wasAuthenticated.current) {
        // A real logout: drop the pseudonymous session so the next person on this
        // shared device starts a genuinely new one.
        resetActivityIdentity()
        setActivityAuthHeaders(null)
        wasAuthenticated.current = false
      }
      return
    }
    wasAuthenticated.current = true
    const headers: Record<string, string> = {}
    if (token) headers['x-session-token'] = token
    if (user?.id) headers['x-user-id'] = user.id
    if (user?.role) headers['x-stakeholder-role'] = user.role
    if (user?.active_tenant_id) headers['x-tenant-id'] = user.active_tenant_id
    setActivityAuthHeaders(headers)
  }, [isAuthenticated, token, user?.id, user?.role, user?.active_tenant_id])

  return null
}
