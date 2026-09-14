import { translate } from '@/localization';

export const QUALITY_SELECTION_COPY = {
  sheetTitle: 'Add download',
  sheetSubtitle: 'Paste a media link. We’ll check what can be saved.',
  urlLabel: 'Link',
  urlPlaceholder: 'https://example.com/video.mp4',
  urlHelper: 'Direct video, audio, or stream links work best.',
  analyzeAction: 'Analyze link',
  analyzing: 'Checking this link…',
  pasteAction: 'Paste',
  retryAction: 'Try again',
  changeLinkAction: 'Use a different link',
  downloadAction: 'Start download',
  downloadingAction: 'Starting download…',
  qualitiesTitle: 'Choose format',
  emptyTitle: 'Nothing downloadable here',
  errorTitle: 'Couldn’t analyze this link',
  unsupportedBadge: 'Can’t download',
  missingUrl: 'Paste a link to continue',
  invalidUrl: 'Enter a valid http or https link',
  closeLabel: 'Close',
  selectionHint: 'Select a format to download',
  selectedHint: 'Selected for download',
} as const;

export function downloadButtonLabel(optionLabel: string | null | undefined): string {
  if (!optionLabel) {
    return translate('downloads.downloadAction');
  }
  return translate('downloads.downloadNamed', { label: optionLabel });
}
