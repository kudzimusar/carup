/**
 * Presentational pages/notices for non-active feature lifecycle states and
 * unknown routes (Milestone 5). Kept small and separate so each state is
 * auditable on its own.
 */
import { Link } from 'react-router-dom'
import { Clock, Ban, Compass, FlaskConical, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

function Shell({
  icon,
  title,
  description,
  testid,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  testid: string
  children?: React.ReactNode
}) {
  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-16"
      data-testid={testid}
      role="region"
      aria-label={title}
    >
      <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-5 text-gray-500">
        {icon}
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
      <p className="max-w-md text-gray-500 mb-6">{description}</p>
      {children ?? (
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
      )}
    </div>
  )
}

export function FeaturePlannedPage() {
  return (
    <Shell
      testid="feature-planned-page"
      icon={<Clock className="w-7 h-7" />}
      title="Coming soon"
      description="This feature is planned but not yet available. It is not active, so there's nothing to use here yet."
    />
  )
}

export function FeatureDisabledPage() {
  return (
    <Shell
      testid="feature-disabled-page"
      icon={<Ban className="w-7 h-7" />}
      title="Feature unavailable"
      description="This feature is currently turned off. Please check back later."
    />
  )
}

export function FeatureUnavailablePage() {
  return (
    <Shell
      testid="feature-unavailable-page"
      icon={<AlertTriangle className="w-7 h-7" />}
      title="Not available"
      description="This feature isn't available in your current context."
    />
  )
}

export function NotFoundPage() {
  return (
    <Shell
      testid="not-found-page"
      icon={<Compass className="w-7 h-7" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or may have moved."
    />
  )
}

/** Inline banner shown above a beta feature's content. */
export function FeatureBetaNotice({ message }: { message?: string }) {
  return (
    <div
      data-testid="feature-beta-notice"
      role="status"
      className="flex items-center gap-2 bg-blue-50 text-blue-800 text-sm px-4 py-2 border-b border-blue-100"
    >
      <FlaskConical className="w-4 h-4 shrink-0" />
      <span>{message || 'This feature is in beta — behavior may change.'}</span>
    </div>
  )
}

/** Inline banner shown above a deprecated feature that has no redirect target. */
export function FeatureDeprecatedNotice({ to }: { to?: string }) {
  return (
    <div
      data-testid="feature-deprecated-notice"
      role="status"
      className="flex items-center gap-2 bg-amber-50 text-amber-800 text-sm px-4 py-2 border-b border-amber-100"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        This feature is deprecated{to ? <> — see <Link className="underline" to={to}>the replacement</Link></> : ' and may be removed soon.'}
      </span>
    </div>
  )
}
