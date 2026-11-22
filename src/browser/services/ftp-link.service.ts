import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { getV2Engine } from '@/downloads/v2/engine-port';
import { startFtpDownload, type FtpRefusal, type FtpStartOutcome } from '@/downloads/v2/ftp-download';
import { translate, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';

const REFUSAL_KEYS: Record<FtpRefusal, TranslationKey> = {
  invalid: 'downloadSources.ftpInvalid',
  private: 'downloadSources.ftpPrivate',
  unavailable: 'downloadSources.ftpUnavailable',
  'not-video': 'downloadSources.ftpNotVideo',
  protected: 'downloadSources.ftpProtected',
  live: 'downloadSources.ftpLive',
  'sign-in': 'downloadSources.ftpSignIn',
  'not-found': 'downloadSources.ftpNotFound',
  network: 'downloadSources.ftpNetwork',
  server: 'downloadSources.ftpServer',
  'old-android': 'downloadSources.ftpOldAndroid',
};

/** The message for how an FTP link ended (shown as a toast and announced). */
export function ftpOutcomeMessage(outcome: FtpStartOutcome): string {
  switch (outcome.kind) {
    case 'started':
      return translate('downloadSources.ftpStarted', { title: outcome.title });
    case 'duplicate':
      return translate(outcome.already === 'downloading' ? 'downloadSources.ftpAlreadyDownloading' : 'downloadSources.ftpAlreadyDownloaded');
    default:
      return translate(REFUSAL_KEYS[outcome.reason]);
  }
}

function say(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * #304: an FTP link pasted or typed into the address bar, shared to VidoraX or offered from the clipboard. The WebView
 * never opens it: the engine checks the file (a video, on a public server) and downloads it; Downloads opens when it
 * started.
 */
export function openFtpLink(url: string): void {
  say(translate('downloadSources.ftpChecking'));
  void startFtpDownload(getV2Engine(), url).then((outcome) => {
    say(ftpOutcomeMessage(outcome));
    if (outcome.kind === 'started') {
      navigation.navigate(routePaths.downloads);
    }
  });
}
