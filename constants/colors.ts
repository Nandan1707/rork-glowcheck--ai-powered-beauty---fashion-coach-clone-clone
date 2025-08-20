export const COLORS = {
  primary: "#E1D4C1",
  primaryDark: "#F4E1D2",
  secondary: "#D5AA9F",
  secondaryDark: "#E1D3CC",
  accent: "#7E102C",
  accentAlt: "#987284",
  background: "#F7F2EC",
  card: "#FFFFFF",
  text: "#2A1F1B",
  textLight: "#7A6A62",
  textDark: "#1A1411",
  border: "#E8E0D7",
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
  primary: ["#E1D4C1", "#F4E1D2"] as const,
  secondary: ["#D5AA9F", "#E1D3CC"] as const,
  accent: ["#7E102C", "#987284"] as const,
  card: ["#FFFFFF", "#F7F2EC"] as const,
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