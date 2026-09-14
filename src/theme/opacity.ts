export const opacity = {
  disabled: 0.38,
  pressed: 0.72,
  overlay: 0.5,
  subtle: 0.08,
  medium: 0.12,
  high: 0.24,
} as const;

export type OpacityToken = keyof typeof opacity;
