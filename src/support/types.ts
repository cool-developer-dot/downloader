import type { TranslationKey } from '@/localization';
import type { RoutePath } from '@/navigation/constants/route-paths';

/** Stable category ids — frozen after Phase 4A. */
export type SupportCategoryId =
  | 'getting-started'
  | 'downloads'
  | 'library-files'
  | 'playback'
  | 'account-settings';

/** Contextual deep actions that map to real in-app routes. */
export type SupportActionId =
  | 'open-browser'
  | 'open-downloads'
  | 'open-library'
  | 'open-download-settings'
  | 'open-settings'
  | 'open-privacy';

export type SupportCategory = {
  readonly id: SupportCategoryId;
  readonly titleKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly icon: string;
};

export type SupportAction = {
  readonly id: SupportActionId;
  readonly labelKey: TranslationKey;
  readonly route: RoutePath;
};

export type SupportFaqItem = {
  readonly id: string;
  readonly categoryId: SupportCategoryId;
  readonly questionKey: TranslationKey;
  readonly answerKey: TranslationKey;
  /** Localized comma-separated keywords for search (optional). */
  readonly keywordsKey?: TranslationKey;
  readonly actionId?: SupportActionId;
  /** Optional label override for the deep action (same route, clearer CTA). */
  readonly actionLabelKey?: TranslationKey;
  /** Shown in the default Popular Questions list when not filtering. */
  readonly popular?: boolean;
};
