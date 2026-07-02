/**
 * "More" tab route stub (Milestone C).
 *
 * The More tab does NOT normally navigate — its `tabBarButton` (wired in
 * `_layout.tsx`) opens the governed `NativeDrawer` instead. This screen exists
 * only because expo-router requires a route file for a declared tab. If a user
 * ever lands here directly (deep link / programmatic nav), we redirect home and
 * the drawer remains the canonical "more" surface.
 */
import { Redirect } from 'expo-router';

export default function MoreScreen() {
  return <Redirect href="/" />;
}
