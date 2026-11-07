import { useEffect } from 'react';

import { selectionMenuService } from '@/browser/selection/selection-menu.service';
import { useSettingsStore } from '@/store/settings';

/**
 * B8: while the browser is mounted, pages' text-selection menus carry the app's items (Search…), titled in the app's
 * language. Unmounting takes them away again.
 */
export function useSelectionMenu(): void {
  const language = useSettingsStore((state) => state.language);

  useEffect(() => {
    selectionMenuService.start();
    return () => selectionMenuService.stop();
  }, [language]);
}
