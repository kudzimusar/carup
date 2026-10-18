// Command Center nested-route sections (plan §5). Kept in a plain .ts module so the constant + type
// can be shared by the page and the nav component without tripping react-refresh's
// "only export components" rule on the .tsx.

export const COMMAND_CENTER_SECTIONS = ['inbox', 'queues', 'recovery', 'sla', 'audit', 'providers', 'settings'] as const
export type CommandCenterSection = (typeof COMMAND_CENTER_SECTIONS)[number]

export const COMMAND_CENTER_SECTION_LABELS: Record<CommandCenterSection, string> = {
  inbox: 'Inbox',
  queues: 'Queues',
  recovery: 'Recovery',
  sla: 'SLA',
  audit: 'Audit',
  providers: 'Providers',
  settings: 'Settings',
}

/**
 * CA-OWNER-02 (H5) — the document title of a Command Center section. ONE definition for the server document
 * (publicPageMetadata → web/api/public-page.ts) and the page itself, so a deep link never reads "Page not found".
 */
export function commandCenterPageTitle(section: CommandCenterSection): string {
  return `${COMMAND_CENTER_SECTION_LABELS[section]} · Command Center · CarUp Admin`
}
