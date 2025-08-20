export const COLORS = {
  primary: "#F4E8D8",
  primaryDark: "#EADAC6",
  secondary: "#EBD2CA",
  secondaryDark: "#E5C4B9",
  accent: "#6C1E3A",
  accentAlt: "#8E2F50",
  background: "#F4EDE6",
  surface: "#FAF6F2",
  card: "#FFFFFF",
  text: "#3A2E2C",
  textMuted: "#6E5E5A",
  textDark: "#2E2624",
  border: "#ECDCD0",
  divider: "#EFE4DA",
  success: "#2E7D32",
  error: "#B32638",
  warning: "#A5641A",
  info: "#5C6BC0",
  gold: "#C5A572",
  goldSoft: "#D8C199",
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
  overlay: "rgba(0, 0, 0, 0.4)",
  button: "#6C1E3A",
  buttonHover: "#7A2544",
  buttonPressed: "#581831",
  chip: "#F0E1DA",
} as const;

export const GRADIENTS = {
  primary: ["#F4E8D8", "#EADAC6"] as const,
  secondary: ["#EBD2CA", "#E5C4B9"] as const,
  accent: ["#6C1E3A", "#8E2F50"] as const,
  card: ["#FFFFFF", "#FAF6F2"] as const,
  goldSheen: ["#F7E7CE", "#D6BE8A"] as const,
} as const;

export default {
  light: {
    text: COLORS.text,
    background: COLORS.background,
    tint: COLORS.accent,
    tabIconDefault: "#C0B2AA",
    tabIconSelected: COLORS.accent,
  },
  ...COLORS,
} as const;