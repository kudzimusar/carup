import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { WS_STYLE } from './workspaceStyles'

/**
 * "← Back to <parent>": the one-tap way up, as an explicit control (never the browser Back button).
 *
 * Extracted from SellerWorkspaceHeader, which now renders this same component, so the Seller pages
 * and every Trade page share one parent-link treatment: a 44px target, quiet until hovered, with
 * the orange focus ring. The label names the PARENT the user came from or belongs to
 * ("Back to import order"), never a programme term.
 */
export function WorkspaceParentLink({
  href,
  label,
  tone = 'light',
  className,
}: {
  href: string
  label: string
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <Link
      to={href}
      data-testid="workspace-parent-link"
      className={cn(
        WS_STYLE.quietLink,
        WS_STYLE.focus,
        tone === 'dark' ? 'text-slate-400 hover:text-white focus-visible:ring-offset-slate-950' : '',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  )
}
