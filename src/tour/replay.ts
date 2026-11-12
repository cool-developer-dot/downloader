import { navigate } from '@/navigation/helpers/navigation';
import { routePaths } from '@/navigation/constants/route-paths';

import { requestTourReplay } from './tour-store';

/** "Show the tour again": opens the Browser; the tour starts there as soon as it is idle. */
export function showTourAgain(): void {
  requestTourReplay();
  navigate(routePaths.browser);
}
