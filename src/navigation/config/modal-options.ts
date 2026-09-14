import type { ModalScreenOptions } from '../types/navigation';

import { headerDefaults } from './screen-options';
import { stackTransitions } from './transitions';

export const modalPresentationDefaults: Pick<
  ModalScreenOptions,
  'presentation' | 'animation' | 'gestureEnabled'
> = {
  presentation: 'modal',
  animation: stackTransitions.modal,
  gestureEnabled: true,
};

export const modalScreenOptions: ModalScreenOptions = {
  ...headerDefaults,
  ...modalPresentationDefaults,
};
