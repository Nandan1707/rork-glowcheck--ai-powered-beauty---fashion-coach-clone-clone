export const COLORS = {
  primary: "#F5E6D3",
  primaryDark: "#EBD6C4",
  secondary: "#EBCFC4",
  secondaryDark: "#E3C3B9",
  accent: "#6C1E3A",
  accentAlt: "#8A2D4C",
  background: "#F5E6D3",
  card: "#FFFFFF",
  text: "#3A2E2C",
  textLight: "#6E5E5A",
  textDark: "#2E2624",
  border: "#E7D9CF",
  success: "#2E7D32",
  error: "#C62828",
  warning: "#B26A00",
  info: "#5C6BC0",
  gold: "#C8A96A",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  overlay: "rgba(0, 0, 0, 0.4)",
} as const;

export const GRADIENTS = {
  primary: ["#F5E6D3", "#EBD6C4"] as const,
  secondary: ["#EBCFC4", "#E3C3B9"] as const,
  accent: ["#6C1E3A", "#8A2D4C"] as const,
  card: ["#FFFFFF", "#F5E6D3"] as const,
} as const;

export default {
  light: {
    text: COLORS.text,
    background: COLORS.background,
    tint: COLORS.accent,
    tabIconDefault: "#ccc",
    tabIconSelected: COLORS.accent,
  },
  ...COLORS,
} as const;