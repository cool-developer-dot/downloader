import { isApiError } from '@/api/errors';
import type { TranslationKey } from '@/localization';

export type SettingsErrorKind =
  | 'network'
  | 'server'
  | 'validation'
  | 'unexpected';

export type SettingsErrorViewModel = {
  kind: SettingsErrorKind;
  titleKey: TranslationKey;
  messageKey: TranslationKey;
};

export type SettingsErrorContext = 'load' | 'save';

/**
 * Maps local storage / unknown errors into localized settings error keys.
 */
export function mapSettingsError(
  error: unknown,
  context: SettingsErrorContext = 'load',
): SettingsErrorViewModel {
  if (isApiError(error)) {
    if (error.isNetworkError) {
      return {
        kind: 'network',
        titleKey: 'errors.networkTitle',
        messageKey: 'errors.network',
      };
    }

    if (error.isValidationError) {
      return {
        kind: 'validation',
        titleKey: 'settings.preferenceErrorTitle',
        messageKey: 'settings.invalidPreference',
      };
    }

    if (error.code === 'SERVER_ERROR' || (error.status !== null && error.status >= 500)) {
      return {
        kind: 'server',
        titleKey: 'errors.serverTitle',
        messageKey: 'errors.server',
      };
    }
  }

  if (error instanceof Error && error.message.startsWith('Unsupported language')) {
    return {
      kind: 'validation',
      titleKey: 'settings.preferenceErrorTitle',
      messageKey: 'settings.unsupportedLanguage',
    };
  }

  if (error instanceof Error && error.message.startsWith('Invalid theme')) {
    return {
      kind: 'validation',
      titleKey: 'settings.preferenceErrorTitle',
      messageKey: 'settings.unsupportedTheme',
    };
  }

  return {
    kind: 'unexpected',
    titleKey: 'errors.unexpectedTitle',
    messageKey: context === 'save' ? 'settings.saveFailed' : 'settings.loadFailed',
  };
}
