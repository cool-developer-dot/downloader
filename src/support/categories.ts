import type { SupportCategory } from './types';

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = [
  {
    id: 'getting-started',
    titleKey: 'support.categories.gettingStarted.title',
    descriptionKey: 'support.categories.gettingStarted.description',
    icon: 'rocket-launch-outline',
  },
  {
    id: 'downloads',
    titleKey: 'support.categories.downloads.title',
    descriptionKey: 'support.categories.downloads.description',
    icon: 'download-outline',
  },
  {
    id: 'library-files',
    titleKey: 'support.categories.libraryFiles.title',
    descriptionKey: 'support.categories.libraryFiles.description',
    icon: 'folder-outline',
  },
  {
    id: 'playback',
    titleKey: 'support.categories.playback.title',
    descriptionKey: 'support.categories.playback.description',
    icon: 'play-circle-outline',
  },
  {
    id: 'account-settings',
    titleKey: 'support.categories.accountSettings.title',
    descriptionKey: 'support.categories.accountSettings.description',
    icon: 'cog-outline',
  },
] as const;

export const SUPPORT_CATEGORY_IDS = SUPPORT_CATEGORIES.map((c) => c.id);

export function getSupportCategory(id: string): SupportCategory | undefined {
  return SUPPORT_CATEGORIES.find((c) => c.id === id);
}
