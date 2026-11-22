/**
 * CarUp design-system entry for the Claude Design sync (design-sync).
 *
 * The curated DS surface - and ONLY that: the shadcn-style UI primitives, the RX-02 Truth
 * components and the unified-shell chrome. App code (pages, API hooks, contexts) is never
 * exported. Built from the real source by .design-sync/build-ds.mjs; the converter bundles the
 * result. Adding a component to the DS = adding its export here.
 */

export * from '../web/src/components/ui/accordion'
export * from '../web/src/components/ui/alert'
export * from '../web/src/components/ui/alert-dialog'
export * from '../web/src/components/ui/aspect-ratio'
export * from '../web/src/components/ui/avatar'
export * from '../web/src/components/ui/badge'
export * from '../web/src/components/ui/breadcrumb'
export * from '../web/src/components/ui/button'
export * from '../web/src/components/ui/button-group'
export * from '../web/src/components/ui/calendar'
export * from '../web/src/components/ui/card'
export * from '../web/src/components/ui/carousel'
export * from '../web/src/components/ui/chart'
export * from '../web/src/components/ui/checkbox'
export * from '../web/src/components/ui/collapsible'
export * from '../web/src/components/ui/command'
export * from '../web/src/components/ui/context-menu'
export * from '../web/src/components/ui/dialog'
export * from '../web/src/components/ui/drawer'
export * from '../web/src/components/ui/dropdown-menu'
export * from '../web/src/components/ui/empty'
export * from '../web/src/components/ui/field'
export * from '../web/src/components/ui/form'
export * from '../web/src/components/ui/hover-card'
export * from '../web/src/components/ui/input'
export * from '../web/src/components/ui/input-group'
export * from '../web/src/components/ui/input-otp'
export * from '../web/src/components/ui/item'
export * from '../web/src/components/ui/kbd'
export * from '../web/src/components/ui/label'
export * from '../web/src/components/ui/menubar'
export * from '../web/src/components/ui/navigation-menu'
export * from '../web/src/components/ui/pagination'
export * from '../web/src/components/ui/popover'
export * from '../web/src/components/ui/progress'
export * from '../web/src/components/ui/radio-group'
export * from '../web/src/components/ui/resizable'
export * from '../web/src/components/ui/scroll-area'
export * from '../web/src/components/ui/select'
export * from '../web/src/components/ui/separator'
export * from '../web/src/components/ui/sheet'
export * from '../web/src/components/ui/sidebar'
export * from '../web/src/components/ui/skeleton'
export * from '../web/src/components/ui/slider'
export * from '../web/src/components/ui/sonner'
export * from '../web/src/components/ui/spinner'
export * from '../web/src/components/ui/switch'
export * from '../web/src/components/ui/table'
export * from '../web/src/components/ui/tabs'
export * from '../web/src/components/ui/textarea'
export * from '../web/src/components/ui/toggle'
export * from '../web/src/components/ui/toggle-group'
export * from '../web/src/components/ui/tooltip'

// RX-02 Truth components - the only permitted renderers of their data class.
export * from '../web/src/components/truth'

// RX-02 unified shell chrome (presentation only; authorization stays server-side).
export { BrandMark, PublicShell, WorkspaceShell, FocusedShell } from '../web/src/components/shell'
export type * from '../web/src/components/shell/contracts'

// Shared runtime APIs the DS components depend on. Exported so designs (and previews) talk to the
// SAME instance the components use: toast() reaches <Toaster>, useForm() drives <Form>/<FormField>.
export { toast } from 'sonner'
export { useForm } from 'react-hook-form'

// Router for the shells' <Link>s. Preview provider only; not a DS component (excluded in config).
export { MemoryRouter } from 'react-router-dom'
