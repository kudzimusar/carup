// Accessible, brand-aware channel icon for the CarUp Command Center.
// Renders role="img" with an aria-label unless `decorative`, so a channel is never conveyed by
// colour alone (docs/agent-8-omnichannel/ENTERPRISE_COMMUNICATION_COMMAND_CENTER_GOAL_LOOP.md §6).

import { getChannel } from './channelRegistry'

export interface ChannelIconProps {
  channel?: string | null
  size?: number
  className?: string
  /** Override the accessible label (defaults to the channel label). */
  title?: string
  /** Mark purely decorative when an adjacent text label already names the channel. */
  decorative?: boolean
  /** Apply the channel brand colour (default true). */
  colored?: boolean
}

export function ChannelIcon({ channel, size = 16, className, title, decorative = false, colored = true }: ChannelIconProps) {
  const def = getChannel(channel)
  const Icon = def.icon
  const label = title || def.label
  return (
    <span
      className={className}
      style={colored ? { color: def.brandColor, display: 'inline-flex' } : { display: 'inline-flex' }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-channel={def.key}
    >
      <Icon width={size} height={size} aria-hidden />
    </span>
  )
}
