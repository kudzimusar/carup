import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Global toast styling.
 *
 * Two fixes that made error toasts (e.g. "Invalid credentials" / "wrong password" and any backend
 * JSON error surfaced via toast.error) render with text that clashed into the background:
 *  1. The CSS-var overrides MUST be wrapped in hsl(): the design tokens are raw HSL triplets
 *     (e.g. --popover: "0 0% 100%"), so "var(--popover)" alone is an INVALID color and the toast
 *     text/background broke. They are now "hsl(var(--popover))".
 *  2. This app is light-only (no .dark token block), so the toaster is pinned to theme="light"
 *     instead of following the OS ("system"), which previously applied sonner's dark treatment on a
 *     dark-mode OS against our light tokens.
 * `richColors` additionally gives error/success/warning/info toasts a guaranteed high-contrast,
 * color-coded treatment so the message is always clearly legible.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      richColors
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
