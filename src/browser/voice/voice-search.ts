import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web/src/VidoraWebModule';

import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { loadUrlActiveTab, navigationService } from '@/browser/services';
import { isYouTubeLink, openPastedLink } from '@/browser/services/pasted-link.service';
import { announceYouTubeNotSupported } from '@/browser/services/youtube-refusal';
import { getActiveLanguage } from '@/localization';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import { useRecentSearchesStore } from '@/store/recent-searches';

import { voiceLanguageTag } from './voice-language';

/**
 * #31 Voice Search and #282 Voice Commands: Android's own voice input screen turns speech into text (VidoraX never
 * records or asks for the microphone), then the words go where typed words go — an address opens, anything else is a
 * search with the chosen engine.
 */
export function isVoiceSearchAvailable(): boolean {
  if (!isVidoraWebAvailable()) return false;
  const web = getVidoraWeb();
  if (typeof web.recognizeSpeech !== 'function') return false;
  try {
    return web.isVoiceSearchAvailable?.() ?? true;
  } catch {
    return false;
  }
}

/** The words heard, or null (cancelled, nothing heard, or no voice input on this phone). */
export async function listenForWords(): Promise<string | null> {
  if (!isVoiceSearchAvailable()) return null;
  try {
    const heard = await withExpectedSystemScreen(() => getVidoraWeb().recognizeSpeech!(voiceLanguageTag(getActiveLanguage())));
    return heard?.trim() ? heard.trim() : null;
  } catch {
    return null;
  }
}

export type VoiceSearchOutcome = 'opened' | 'cancelled' | 'unavailable' | 'invalid' | 'youtube';

/** Listens, then opens the words in the browser's tab in front (the caller shows the Browser tab). */
export async function voiceSearchInBrowser(): Promise<VoiceSearchOutcome> {
  if (!isVoiceSearchAvailable()) return 'unavailable';
  const words = await listenForWords();
  if (!words) return 'cancelled';
  return openWords(words);
}

/** The address bar's Enter for words that were spoken. */
export function openWords(words: string): VoiceSearchOutcome {
  const result = navigationService.resolveSubmission(words);
  if (!result.ok) return 'invalid';
  const typedLink = result.intent.kind === 'navigate';
  if (typedLink && isYouTubeLink(result.url)) {
    announceYouTubeNotSupported();
    return 'youtube';
  }
  const loaded = typedLink ? openPastedLink(result.url, { source: 'omnibox' }) : loadUrlActiveTab(result.url);
  if (!loaded) return 'invalid';
  // B11: a search made in an incognito tab is never kept.
  if (result.intent.kind === 'search' && !isIncognitoInFront()) {
    void useRecentSearchesStore.getState().record(words);
  }
  return 'opened';
}
