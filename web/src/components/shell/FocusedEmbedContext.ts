/**
 * RX-02A S1-4B — Focused-embed presentation context.
 *
 * `FocusedUnifiedShell` provides `true` while the focused chrome is active so a
 * page rendered beneath it can suppress its OWN duplicated brand block (legacy
 * login panels carry a large in-page logo + heading). Default is `false`, so
 * every existing usage of the page outside the focused shell is pixel-unchanged.
 * Presentation only — no behavior, auth or data implication.
 */
import { createContext, useContext } from 'react'

export const FocusedEmbedContext = createContext<boolean>(false)

/** True when this page is rendered beneath the unified focused chrome. */
export function useFocusedEmbed(): boolean {
  return useContext(FocusedEmbedContext)
}
