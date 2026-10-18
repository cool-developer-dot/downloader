import { useSyncExternalStore } from 'react';

import { webFullscreen } from './web-fullscreen.runtime';

const isFullscreen = () => webFullscreen.isFullscreen();

/** True while a website's video is fullscreen (the video view covers the app). */
export function useIsWebFullscreen(): boolean {
  return useSyncExternalStore(webFullscreen.subscribe, isFullscreen, isFullscreen);
}
