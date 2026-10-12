import { useColorScheme } from 'react-native';

export const palette = {
  navy980: '#050D16',
  navy950: '#061321',
  navy900: '#081B2C',
  navy850: '#0B2237',
  navy800: '#0E2B44',
  navy700: '#173F60',
  orange600: '#EA580C',
  orange500: '#F97316',
  orange400: '#FB923C',
  orange100: '#FFEDD5',
  orange50: '#FFF7ED',
  slate950: '#0F172A',
  slate800: '#1E293B',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748B',
  slate400: '#94A3B8',
  slate300: '#CBD5E1',
  slate200: '#E2E8F0',
  slate150: '#D8E0E8',
  slate100: '#F1F5F9',
  slate50: '#F7F8FA',
  white: '#FFFFFF',
  success700: '#047857',
  success100: '#D1FAE5',
  warning800: '#92400E',
  warning100: '#FEF3C7',
  danger700: '#B91C1C',
  danger100: '#FEE2E2',
  info700: '#1D4ED8',
  info100: '#DBEAFE',
} as const;

export const lightTheme = {
  brand: {
    primary: palette.orange500,
    primaryPressed: palette.orange600,
    primarySubtle: palette.orange100,
    onPrimary: palette.navy900,
    hero: palette.navy900,
    heroDeep: palette.navy980,
    heroRaised: palette.navy800,
    onHero: palette.white,
    onHeroMuted: '#C8D5E2',
    wordmarkInk: palette.navy900,
  },
  background: {
    canvas: palette.slate50,
    surface: palette.white,
    surfaceRaised: palette.white,
    surfaceSunken: palette.slate100,
  },
  text: {
    primary: palette.slate950,
    secondary: palette.slate700,
    muted: palette.slate500,
    inverse: palette.white,
  },
  border: {
    default: palette.slate200,
    strong: palette.slate300,
    brandDark: '#27455F',
  },
  state: {
    success: palette.success700,
    successSubtle: palette.success100,
    warning: palette.warning800,
    warningSubtle: palette.warning100,
    danger: palette.danger700,
    dangerSubtle: palette.danger100,
    info: palette.info700,
    infoSubtle: palette.info100,
  },
  overlay: { scrim: 'rgba(5,13,22,0.68)' },
  focus: { ring: palette.orange500 },
} as const;

export const darkTheme = {
  brand: {
    primary: palette.orange400,
    primaryPressed: palette.orange500,
    primarySubtle: '#47200A',
    onPrimary: palette.navy980,
    hero: palette.navy980,
    heroDeep: '#02070C',
    heroRaised: palette.navy800,
    onHero: palette.white,
    onHeroMuted: '#C8D5E2',
    wordmarkInk: palette.white,
  },
  background: {
    canvas: palette.navy980,
    surface: palette.navy900,
    surfaceRaised: palette.navy800,
    surfaceSunken: '#0A1826',
  },
  text: {
    primary: palette.white,
    secondary: palette.slate300,
    muted: palette.slate400,
    inverse: palette.navy980,
  },
  border: {
    default: '#244159',
    strong: '#3C607E',
    brandDark: '#355A78',
  },
  state: {
    success: '#6EE7B7',
    successSubtle: '#0B3A30',
    warning: '#FCD34D',
    warningSubtle: '#3A2A08',
    danger: '#FCA5A5',
    dangerSubtle: '#451A1A',
    info: '#93C5FD',
    infoSubtle: '#172554',
  },
  overlay: { scrim: 'rgba(2,6,12,0.82)' },
  focus: { ring: palette.orange400 },
} as const;

export type NativeTheme = typeof lightTheme;

export function useNativeTheme(): NativeTheme {
  const scheme = useColorScheme();
  return (scheme === 'dark' ? darkTheme : lightTheme) as NativeTheme;
}

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  control: 10,
  button: 14,
  input: 14,
  chip: 999,
  card: 18,
  imageCard: 20,
  hero: 30,
  sheet: 28,
  modal: 24,
} as const;

export const typeScale = {
  heroEyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800' as const, letterSpacing: 1.4 },
  heroDisplay: { fontSize: 40, lineHeight: 43, fontWeight: '900' as const, letterSpacing: -1.2 },
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.6 },
  titleLarge: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' as const },
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' as const },
  metadata: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  priceLarge: { fontSize: 26, lineHeight: 31, fontWeight: '800' as const, fontVariant: ['tabular-nums'] as ['tabular-nums'] },
  priceCompact: { fontSize: 20, lineHeight: 25, fontWeight: '800' as const, fontVariant: ['tabular-nums'] as ['tabular-nums'] },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '800' as const },
  navLabel: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.1 },
} as const;

export const motion = {
  quick: 120,
  standard: 200,
  sheet: 260,
} as const;

export const touchTarget = {
  minimum: 48,
} as const;

export const contrastMatrix = {
  navyOnOrange: 6.23,
  whiteOnNavy: 17.45,
  primaryTextOnWhite: 17.85,
  mutedTextOnWhite: 4.76,
} as const;
