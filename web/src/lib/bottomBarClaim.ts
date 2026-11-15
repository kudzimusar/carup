import { useEffect, useSyncExternalStore } from 'react'

/**
 * RX03-P1a — one bottom bar at a time on phones.
 *
 * A page with a contextual action bar (Vehicle Detail: price + Contact) CLAIMS the bottom of the
 * screen. A shell navigation bar that knows about claims (P1b: the legacy `CompactBottomNav` and the
 * unified `PublicShell` tab bar) hides itself while a claim is active and marks the claim honoured.
 * The claiming page reads `honoured` to know where to dock: flush with the bottom when the nav
 * stepped aside, or just above the nav when it did not (a shell without claim support) — so the
 * two bars never overlap, and with P1b they never stack.
 */
type Snapshot = { claimed: boolean; honoured: boolean }

let claims = 0
let honourers = 0
let snapshot: Snapshot = { claimed: false, honoured: false }
const listeners = new Set<() => void>()

function publish() {
  const next = { claimed: claims > 0, honoured: claims > 0 && honourers > 0 }
  if (next.claimed === snapshot.claimed && next.honoured === snapshot.honoured) return
  snapshot = next
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => snapshot

export function useBottomBarClaimState(): Snapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Called by a page while it shows its own bottom action bar. */
export function useClaimBottomBar(active: boolean): Snapshot {
  useEffect(() => {
    if (!active) return
    claims += 1
    publish()
    return () => {
      claims -= 1
      publish()
    }
  }, [active])
  return useBottomBarClaimState()
}

/**
 * Called by a shell navigation bar that steps aside for a claim. Returns whether it should hide.
 * `active=false` keeps the bar exactly as it was (it neither honours nor hides).
 */
export function useHonourBottomBarClaim(active = true): boolean {
  useEffect(() => {
    if (!active) return
    honourers += 1
    publish()
    return () => {
      honourers -= 1
      publish()
    }
  }, [active])
  const { claimed } = useBottomBarClaimState()
  return active && claimed
}
