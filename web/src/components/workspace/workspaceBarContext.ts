import { createContext } from 'react'

/**
 * True inside a shell that already draws the workspace bar (the Trade shell). A page always asks
 * for its workspace bar — so it is identical wherever the page is hosted, and a page rendered
 * alone (a test, a future shell) still shows where it is — and `CarUpWorkspaceBar` quietly
 * declines to draw a second one when this is set. The shell draws its own OUTSIDE the provider.
 */
export const WorkspaceBarProvidedContext = createContext(false)
