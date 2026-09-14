import { animations } from '@/theme';

export const animationDefaults = {
  fast: animations.fast,
  normal: animations.normal,
  slow: animations.slow,
  screenTransition: animations.screenTransition,
  modalTransition: animations.modalTransition,
  bottomSheetTransition: animations.bottomSheetTransition,
} as const;
