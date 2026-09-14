import { getLanguageLabel } from '@/constants/languages';
import type { Settings, ThemeMode } from '@/api/types';
import { translate } from '@/localization/translate';

export function formatThemeLabel(theme: ThemeMode): string {
  switch (theme) {
    case 'LIGHT':
      return translate('settings.themeLight');
    case 'LOGO':
      return translate('settings.themeLogo');
    case 'DARK':
      return translate('settings.themeDark');
    case 'SYSTEM':
    default:
      return translate('settings.themeLight');
  }
}

export function formatLanguageLabel(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === 'ur') {
    return translate('settings.languageNameUr');
  }
  if (normalized === 'en') {
    return translate('settings.languageNameEn');
  }
  return getLanguageLabel(language);
}

export function formatBooleanLabel(value: boolean): string {
  return value ? translate('common.on') : translate('common.off');
}

export function formatDownloadDirectory(directory: string): string {
  const trimmed = directory.trim();
  if (!trimmed) {
    return translate('common.default');
  }
  return trimmed;
}

export type SettingsDisplayValues = {
  theme: string;
  language: string;
  wifiOnly: string;
  autoResume: string;
  notifications: string;
  downloadDirectory: string;
};

export function toSettingsDisplayValues(settings: Settings): SettingsDisplayValues {
  return {
    theme: formatThemeLabel(settings.theme),
    language: formatLanguageLabel(settings.language),
    wifiOnly: formatBooleanLabel(settings.wifiOnlyDownloads),
    autoResume: formatBooleanLabel(settings.autoResumeDownloads),
    notifications: formatBooleanLabel(settings.notificationsEnabled),
    downloadDirectory: formatDownloadDirectory(settings.downloadDirectory),
  };
}
