import type { StackScreenOptions } from '../types/navigation';

import { modalPresentationDefaults } from './modal-options';
import { headerDefaults } from './screen-options';
import { navigationAnimations } from './transitions';

export function createPushScreenOptions(
  overrides?: StackScreenOptions,
): StackScreenOptions {
  return {
    animation: navigationAnimations.push,
    ...overrides,
  };
}

export function createFadeScreenOptions(
  overrides?: StackScreenOptions,
): StackScreenOptions {
  return {
    animation: navigationAnimations.fade,
    gestureEnabled: false,
    ...overrides,
  };
}

export function createReplaceScreenOptions(
  overrides?: StackScreenOptions,
): StackScreenOptions {
  return createFadeScreenOptions(overrides);
}

export function createModalScreenOptions(
  overrides?: StackScreenOptions,
): StackScreenOptions {
  return {
    ...headerDefaults,
    ...modalPresentationDefaults,
    ...overrides,
  };
}

export function createContentStyleOptions(
  backgroundColor: string,
  overrides?: StackScreenOptions,
): StackScreenOptions {
  return {
    contentStyle: { backgroundColor },
    ...overrides,
  };
}
