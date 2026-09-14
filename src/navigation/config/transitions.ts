import type { StackScreenOptions } from '../types/navigation';

export const stackTransitions = {
  default: 'slide_from_right',
  modal: 'slide_from_bottom',
  fade: 'fade',
} as const satisfies Record<string, NonNullable<StackScreenOptions['animation']>>;

export const navigationAnimations = {
  push: stackTransitions.default,
  pop: stackTransitions.default,
  modal: stackTransitions.modal,
  fade: stackTransitions.fade,
} as const;

export type StackTransition = (typeof stackTransitions)[keyof typeof stackTransitions];
