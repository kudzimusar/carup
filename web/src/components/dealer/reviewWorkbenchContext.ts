/**
 * RX03-P2-R4 — true while a reviewer page renders inside the unified ReviewWorkbench chrome.
 * Pages use it only to choose their composition (the workbench owns navigation, so the page drops
 * its own sibling links and outer <main>); it never decides access.
 */
import { createContext, useContext } from 'react'

export const ReviewWorkbenchContext = createContext(false)
export const useInReviewWorkbench = () => useContext(ReviewWorkbenchContext)
