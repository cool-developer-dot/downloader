export const animations = {
  fast: 150,
  normal: 250,
  slow: 400,
  screenTransition: 300,
  modalTransition: 250,
  bottomSheetTransition: 350,
} as const;

export type AnimationToken = keyof typeof animations;
