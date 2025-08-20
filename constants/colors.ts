export const COLORS = {
  // Primary - Sophisticated Mauve (calm yet premium)
  primary: "#8B5A7C",
  primaryDark: "#6D4562",
  primaryLight: "#A06F91",
  
  // Secondary - Warm Sage (calming, natural)
  secondary: "#9CAF88",
  secondaryDark: "#7A8B6B",
  secondaryLight: "#B5C8A1",
  
  // Accent - Soft Terracotta (warm, inviting)
  accent: "#C4A484",
  accentAlt: "#D4B494",
  
  // Backgrounds - Clean and airy
  background: "#FDFCFB",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  
  // Text colors - Readable and elegant
  text: "#2C2A29",
  textMuted: "#6B6866",
  textDark: "#1A1918",
  textLight: "#8F8C89",
  
  // Borders and dividers - Subtle
  border: "#E8E5E2",
  divider: "#F0EDEA",
  
  // Status colors - Calm versions
  success: "#6B8E6B",
  error: "#C47B7B",
  warning: "#D4A574",
  info: "#7B9BC4",
  
  // Special colors
  gold: "#C4A484",
  goldSoft: "#D4B494",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  overlay: "rgba(44, 42, 41, 0.4)",
  
  // Button colors - High contrast and calm
  button: "#8B5A7C",
  buttonHover: "#A06F91",
  buttonPressed: "#6D4562",
  buttonSecondary: "#9CAF88",
  buttonSecondaryHover: "#B5C8A1",
  buttonSecondaryPressed: "#7A8B6B",
  buttonTertiary: "#C4A484",
  buttonTertiaryHover: "#D4B494",
  buttonOutline: "#8B5A7C",
  buttonText: "#FFFFFF",
  buttonTextSecondary: "#FFFFFF",
  buttonTextOutline: "#8B5A7C",
  
  // Chip and other UI elements
  chip: "#F5F2F0",
  chipActive: "#E8E0DD",
} as const;

export const GRADIENTS = {
  primary: ["#8B5A7C", "#A06F91"] as const,
  secondary: ["#9CAF88", "#B5C8A1"] as const,
  tertiary: ["#C4A484", "#D4B494"] as const,
  accent: ["#F5F2F0", "#E8E0DD"] as const,
  card: ["#FFFFFF", "#FDFCFB"] as const,
  goldSheen: ["#D4B494", "#C4A484"] as const,
  calmLuxury: ["#8B5A7C", "#C4A484"] as const,
  naturalGlow: ["#9CAF88", "#C4A484"] as const,
} as const;

export default {
  light: {
    text: COLORS.text,
    background: COLORS.background,
    tint: COLORS.primary,
    tabIconDefault: "#C0B2AA",
    tabIconSelected: COLORS.primary,
  },
  ...COLORS,
} as const;