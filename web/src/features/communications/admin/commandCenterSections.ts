// Command Center nested-route sections (plan §5). Kept in a plain .ts module so the constant + type
// can be shared by the page and the nav component without tripping react-refresh's
// "only export components" rule on the .tsx.

export const COMMAND_CENTER_SECTIONS = ['inbox', 'queues', 'recovery', 'sla', 'audit', 'providers', 'settings'] as const
export type CommandCenterSection = (typeof COMMAND_CENTER_SECTIONS)[number]
