import { createContext } from 'react'
import type { WorkspaceId } from './workspaceModel'

/**
 * True inside a shell that already draws the workspace bar (the Trade shell). A page always asks
 * for its workspace bar — so it is identical wherever the page is hosted, and a page rendered
 * alone (a test, a future shell) still shows where it is — and `CarUpWorkspaceBar` quietly
 * declines to draw a second one when this is set. The shell draws its own OUTSIDE the provider.
 */
export const WorkspaceBarProvidedContext = createContext(false)

/**
 * Which workspace the hosting shell belongs to, for the one page that is mounted in more than one shell and must
 * say whose inbox it is (Messages). Null outside a shell that declares one. Pages that belong to a single
 * workspace never read this: they name their workspace themselves.
 */
export const ActiveWorkspaceContext = createContext<WorkspaceId | null>(null)
