import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'

/**
 * GMO-4 (ported by OC-5E) — the founder's way into the garage CarUp created for them.
 *
 * Activation makes the applicant their garage's admin, but it does not select the garage for their
 * session: organisations are chosen, never guessed (OC-5D). This opens it by SELECTING it — the
 * server verifies the membership the activation created — then re-reads the session so the new
 * garage appears wherever organisations are listed, and only then goes to the Workshop.
 */
export default function GarageWorkspaceReady({ tenantId }: { tenantId: string }) {
  const { selectActiveTenant, refreshSession } = useAuth()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openWorkspace() {
    setOpening(true); setError(null)
    try {
      await selectActiveTenant(tenantId)
      // The selection answer carries no membership list; the session re-read does.
      await refreshSession()
      navigate('/garage')
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Your garage could not be opened just now. Try again.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <section className="rounded-xl border border-green-200 bg-green-50 p-5" data-testid="garage-workspace-ready">
      <h2 className="font-medium text-green-900">Your garage workspace is ready</h2>
      <p className="text-sm text-green-900 mt-1">
        CarUp approved your application and created your garage. You are its administrator.
        Approval is not verification: CarUp has not independently verified your business.
      </p>
      <Button
        className="min-h-11 mt-3 bg-orange-500 hover:bg-orange-600" data-testid="open-garage-workspace"
        disabled={opening} onClick={openWorkspace}
      >
        {opening ? 'Opening…' : 'Open your garage'}
      </Button>
      {error && <p className="text-sm text-red-700 mt-2" role="alert" data-testid="open-garage-error">{error}</p>}
    </section>
  )
}
