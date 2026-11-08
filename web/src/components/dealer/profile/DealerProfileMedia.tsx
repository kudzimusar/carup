import { useState, type ReactNode } from 'react'
import { Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dealerInitials } from './dealerProfileLabels'

/**
 * CARUP-DEALER-1.0 visual redesign — the dealership identity images (cover banner + square avatar).
 *
 * Only a src the caller already obtained from CarUp's own media endpoints is rendered (an approved
 * public storefront image, or the owner's private blob: preview). There is deliberately no external,
 * OEM/manufacturer-logo or stock fallback: without an image the cover is a neutral branded gradient
 * and the avatar shows the dealer's initials. A src that fails to load degrades to that placeholder.
 */
export function DealerProfileCover({
  src,
  alt,
  className,
  children,
}: {
  src?: string | null
  alt?: string | null
  className?: string
  children?: ReactNode
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  return (
    <div
      className={cn('relative h-36 w-full overflow-hidden bg-slate-900 sm:h-48 lg:h-60', className)}
      data-testid="dealer-profile-cover"
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt || ''}
          className="h-full w-full object-cover object-center"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <div className="absolute inset-0" aria-hidden="true" data-testid="dealer-profile-cover-placeholder">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#08111f_0%,#13213a_55%,#1e293b_100%)]" />
          <div className="absolute inset-0 [background-image:radial-gradient(circle_at_85%_20%,rgba(249,115,22,0.35),transparent_45%),radial-gradient(circle_at_10%_110%,rgba(56,189,248,0.18),transparent_40%)]" />
          <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:28px_28px]" />
        </div>
      )}
      {children}
    </div>
  )
}

export function DealerProfileAvatar({
  src,
  alt,
  name,
  className,
}: {
  src?: string | null
  alt?: string | null
  name: string | null | undefined
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && failedSrc !== src
  const initials = dealerInitials(name)
  return (
    <div
      className={cn(
        'relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-white shadow-lg ring-4 ring-white sm:h-28 sm:w-28',
        className,
      )}
      data-testid="dealer-profile-avatar"
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={alt || ''}
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-[linear-gradient(140deg,#0f172a,#1e293b)]"
          aria-hidden="true"
          data-testid="dealer-profile-avatar-placeholder"
        >
          {initials ? (
            <span className="text-3xl font-black tracking-tight sm:text-4xl">{initials}</span>
          ) : (
            <Store className="h-10 w-10" />
          )}
          <span className="absolute bottom-0 left-0 h-1.5 w-full bg-orange-500" />
        </div>
      )}
    </div>
  )
}
