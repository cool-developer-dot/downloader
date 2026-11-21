/**
 * The voice input language for the app's language: Urdu asks for Pakistani Urdu, anything else leaves the phone's
 * own voice language (null), which already follows the device. Pure.
 */
export function voiceLanguageTag(appLanguage: string | null | undefined): string | null {
  return appLanguage === 'ur' ? 'ur-PK' : null;
}
