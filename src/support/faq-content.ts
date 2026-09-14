import type { SupportFaqItem } from './types';

/**
 * Static FAQ catalog — localization keys only (no rendered EN/UR strings).
 * Frozen after Phase 4A except for real product / content corrections.
 */
export const SUPPORT_FAQ_ITEMS: readonly SupportFaqItem[] = [
  {
    id: 'how-to-download',
    categoryId: 'getting-started',
    questionKey: 'support.faq.howToDownload.question',
    answerKey: 'support.faq.howToDownload.answer',
    keywordsKey: 'support.faq.howToDownload.keywords',
    popular: true,
  },
  {
    id: 'how-to-use-browser',
    categoryId: 'getting-started',
    questionKey: 'support.faq.howToUseBrowser.question',
    answerKey: 'support.faq.howToUseBrowser.answer',
    keywordsKey: 'support.faq.howToUseBrowser.keywords',
    actionId: 'open-browser',
    popular: true,
  },
  {
    id: 'where-downloads-appear',
    categoryId: 'getting-started',
    questionKey: 'support.faq.whereDownloadsAppear.question',
    answerKey: 'support.faq.whereDownloadsAppear.answer',
    keywordsKey: 'support.faq.whereDownloadsAppear.keywords',
    actionId: 'open-downloads',
    popular: true,
  },
  {
    id: 'how-to-play-downloaded',
    categoryId: 'getting-started',
    questionKey: 'support.faq.howToPlayDownloaded.question',
    answerKey: 'support.faq.howToPlayDownloaded.answer',
    keywordsKey: 'support.faq.howToPlayDownloaded.keywords',
    actionId: 'open-library',
  },
  {
    id: 'download-failed',
    categoryId: 'downloads',
    questionKey: 'support.faq.downloadFailed.question',
    answerKey: 'support.faq.downloadFailed.answer',
    keywordsKey: 'support.faq.downloadFailed.keywords',
    popular: true,
  },
  {
    id: 'pause-and-resume',
    categoryId: 'downloads',
    questionKey: 'support.faq.pauseAndResume.question',
    answerKey: 'support.faq.pauseAndResume.answer',
    keywordsKey: 'support.faq.pauseAndResume.keywords',
  },
  {
    id: 'wifi-only-downloads',
    categoryId: 'downloads',
    questionKey: 'support.faq.wifiOnlyDownloads.question',
    answerKey: 'support.faq.wifiOnlyDownloads.answer',
    keywordsKey: 'support.faq.wifiOnlyDownloads.keywords',
    actionId: 'open-download-settings',
    popular: true,
  },
  {
    id: 'file-unavailable',
    categoryId: 'downloads',
    questionKey: 'support.faq.fileUnavailable.question',
    answerKey: 'support.faq.fileUnavailable.answer',
    keywordsKey: 'support.faq.fileUnavailable.keywords',
  },
  {
    id: 'unsupported-source',
    categoryId: 'downloads',
    questionKey: 'support.faq.unsupportedSource.question',
    answerKey: 'support.faq.unsupportedSource.answer',
    keywordsKey: 'support.faq.unsupportedSource.keywords',
  },
  {
    id: 'rename-media',
    categoryId: 'library-files',
    questionKey: 'support.faq.renameMedia.question',
    answerKey: 'support.faq.renameMedia.answer',
    keywordsKey: 'support.faq.renameMedia.keywords',
  },
  {
    id: 'delete-media',
    categoryId: 'library-files',
    questionKey: 'support.faq.deleteMedia.question',
    answerKey: 'support.faq.deleteMedia.answer',
    keywordsKey: 'support.faq.deleteMedia.keywords',
  },
  {
    id: 'share-media',
    categoryId: 'library-files',
    questionKey: 'support.faq.shareMedia.question',
    answerKey: 'support.faq.shareMedia.answer',
    keywordsKey: 'support.faq.shareMedia.keywords',
  },
  {
    id: 'open-externally',
    categoryId: 'library-files',
    questionKey: 'support.faq.openExternally.question',
    answerKey: 'support.faq.openExternally.answer',
    keywordsKey: 'support.faq.openExternally.keywords',
  },
  {
    id: 'favorites',
    categoryId: 'library-files',
    questionKey: 'support.faq.favorites.question',
    answerKey: 'support.faq.favorites.answer',
    keywordsKey: 'support.faq.favorites.keywords',
    actionId: 'open-library',
  },
  {
    id: 'folders',
    categoryId: 'library-files',
    questionKey: 'support.faq.folders.question',
    answerKey: 'support.faq.folders.answer',
    keywordsKey: 'support.faq.folders.keywords',
    actionId: 'open-library',
  },
  {
    id: 'video-not-playing',
    categoryId: 'playback',
    questionKey: 'support.faq.videoNotPlaying.question',
    answerKey: 'support.faq.videoNotPlaying.answer',
    keywordsKey: 'support.faq.videoNotPlaying.keywords',
    popular: true,
  },
  {
    id: 'unsupported-codec',
    categoryId: 'playback',
    questionKey: 'support.faq.unsupportedCodec.question',
    answerKey: 'support.faq.unsupportedCodec.answer',
    keywordsKey: 'support.faq.unsupportedCodec.keywords',
  },
  {
    id: 'resume-playback',
    categoryId: 'playback',
    questionKey: 'support.faq.resumePlayback.question',
    answerKey: 'support.faq.resumePlayback.answer',
    keywordsKey: 'support.faq.resumePlayback.keywords',
  },
  {
    id: 'fullscreen-orientation',
    categoryId: 'playback',
    questionKey: 'support.faq.fullscreenOrientation.question',
    answerKey: 'support.faq.fullscreenOrientation.answer',
    keywordsKey: 'support.faq.fullscreenOrientation.keywords',
  },
  {
    id: 'login-account',
    categoryId: 'account-settings',
    questionKey: 'support.faq.loginAccount.question',
    answerKey: 'support.faq.loginAccount.answer',
    keywordsKey: 'support.faq.loginAccount.keywords',
  },
  {
    id: 'language-settings',
    categoryId: 'account-settings',
    questionKey: 'support.faq.languageSettings.question',
    answerKey: 'support.faq.languageSettings.answer',
    keywordsKey: 'support.faq.languageSettings.keywords',
    actionId: 'open-settings',
    actionLabelKey: 'support.actions.openLanguageSettings',
  },
  {
    id: 'theme-settings',
    categoryId: 'account-settings',
    questionKey: 'support.faq.themeSettings.question',
    answerKey: 'support.faq.themeSettings.answer',
    keywordsKey: 'support.faq.themeSettings.keywords',
    actionId: 'open-settings',
    actionLabelKey: 'support.actions.openAppearanceSettings',
  },
  {
    id: 'storage-settings',
    categoryId: 'account-settings',
    questionKey: 'support.faq.storageSettings.question',
    answerKey: 'support.faq.storageSettings.answer',
    keywordsKey: 'support.faq.storageSettings.keywords',
    actionId: 'open-library',
    actionLabelKey: 'support.actions.manageStorage',
  },
] as const;

export const SUPPORT_FAQ_IDS = SUPPORT_FAQ_ITEMS.map((item) => item.id);

export function getSupportFaqById(id: string): SupportFaqItem | undefined {
  return SUPPORT_FAQ_ITEMS.find((item) => item.id === id);
}

export function getFaqsByCategory(
  categoryId: string,
): readonly SupportFaqItem[] {
  return SUPPORT_FAQ_ITEMS.filter((item) => item.categoryId === categoryId);
}

export function getPopularFaqs(): readonly SupportFaqItem[] {
  return SUPPORT_FAQ_ITEMS.filter((item) => item.popular);
}
