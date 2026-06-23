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
  iconTone = 'neutral',
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  testid: string
  /** Tints the icon chip to match the state's intent without relying on colour alone. */
  iconTone?: 'neutral' | 'planned' | 'disabled' | 'warning'
  children?: React.ReactNode
}) {
  const tone = {
    neutral: 'bg-gray-100 text-gray-500',
    planned: 'bg-orange-50 text-orange-500',
    disabled: 'bg-red-50 text-red-500',
    warning: 'bg-amber-50 text-amber-600',
  }[iconTone]
  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-16"
      data-testid={testid}
      role="region"
      aria-label={title}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-5 ${tone}`}>
        {icon}
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
      <p className="max-w-md text-gray-500 mb-6">{description}</p>
      {/* Every state offers a safe way forward — never a dead end. */}
      <div className="flex flex-col sm:flex-row items-center gap-3">{children}</div>
    </div>
  )
}

/** Shared safe next-action set so each state hands the user a clear way forward. */
function HomeAction() {
  return (
    <Button asChild className="bg-orange-500 hover:bg-orange-600">
      <Link to="/">Back to home</Link>
    </Button>
  )
}
function MarketplaceAction() {
  return (
    <Button asChild variant="outline">
      <Link to="/marketplace">Browse marketplace</Link>
    </Button>
  )
}
function DashboardAction() {
  return (
    <Button asChild variant="outline">
      <Link to="/dashboard">Go to dashboard</Link>
    </Button>
  )
}

export function FeaturePlannedPage() {
  return (
    <Shell
      testid="feature-planned-page"
      iconTone="planned"
      icon={<Clock className="w-7 h-7" />}
      title="Coming soon"
      description="This feature is planned but not yet available. It is not active, so there's nothing to use here yet — explore what's live in the meantime."
    >
      <HomeAction />
      <MarketplaceAction />
    </Shell>
  )
}

export function FeatureDisabledPage() {
  return (
    <Shell
      testid="feature-disabled-page"
      iconTone="disabled"
      icon={<Ban className="w-7 h-7" />}
      title="Feature unavailable"
      description="This feature is currently turned off. Please check back later — your dashboard and the marketplace are still available."
    >
      <DashboardAction />
      <MarketplaceAction />
    </Shell>
  )
}

export function FeatureUnavailablePage() {
  return (
    <Shell
      testid="feature-unavailable-page"
      iconTone="warning"
      icon={<AlertTriangle className="w-7 h-7" />}
      title="Not available"
      description="This feature isn't available in your current context. You can head back home or keep browsing verified vehicles."
    >
      <HomeAction />
      <MarketplaceAction />
    </Shell>
  )
}

export function NotFoundPage() {
  return (
    <Shell
      testid="not-found-page"
      icon={<Compass className="w-7 h-7" />}
      title="Page not found"
      description="The page you're looking for doesn't exist or may have moved. Let's get you back on track."
    >
      <HomeAction />
      <MarketplaceAction />
    </Shell>
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
      <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
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
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>
        This feature is deprecated{to
          ? <> — see <Link className="font-medium underline underline-offset-2 hover:text-amber-900" to={to}>the replacement</Link></>
          : <> and may be removed soon. <Link className="font-medium underline underline-offset-2 hover:text-amber-900" to="/">Back to home</Link></>}
      </span>
    </div>
  )
}
