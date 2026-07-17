/**
 * Native icon adapter (Milestone A).
 *
 * Maps the abstract icon-name strings used by the navigation manifest (shared
 * vocabulary with web's lucide names) onto concrete `@expo/vector-icons`
 * Ionicons glyphs. Native-safe: only react-native + @expo/vector-icons.
 */
import React from 'react';
import { Ionicons } from '@expo/vector-icons';

// The Ionicons component's `name` prop is a large string-literal union. We keep
// our mapping values typed against it via the component's own props so an
// invalid glyph name fails at compile time.
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface NativeIconProps {
  size?: number;
  color?: string;
}

const DEFAULT_ICON: IoniconName = 'ellipse-outline';

/** Abstract icon-name → Ionicons glyph. Unknown names fall back safely. */
const ICON_MAP: Record<string, IoniconName> = {
  ShoppingCart: 'cart-outline',
  Car: 'car-outline',
  Package: 'cube-outline',
  Shield: 'shield-checkmark-outline',
  Home: 'home-outline',
  Gift: 'gift-outline',
  MessageSquare: 'chatbubbles-outline',
  FileText: 'document-text-outline',
  Wrench: 'construct-outline',
  Building2: 'business-outline',
  DollarSign: 'cash-outline',
  // A couple of common dashboard/aliases used by the manifest.
  LayoutDashboard: 'home-outline',
  Storefront: 'storefront-outline',
  // Native navigation hub ("More" tab) drawer affordance.
  Menu: 'menu-outline',
};

/** Resolve an abstract icon name to a concrete Ionicons glyph name. */
export function resolveIconName(name: string): IoniconName {
  return ICON_MAP[name] ?? DEFAULT_ICON;
}

/** Render an Ionicons element for an abstract icon name (safe default). */
export function getNativeIcon(name: string, props: NativeIconProps = {}): React.ReactElement {
  const { size = 24, color = '#111827' } = props;
  return <Ionicons name={resolveIconName(name)} size={size} color={color} />;
}
