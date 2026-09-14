import { NativeModules, Platform } from 'react-native';

type IntentLauncherModule = {
  canHandleIntentUri: (uri: string) => Promise<boolean>;
  openIntentUri: (uri: string) => Promise<boolean>;
};

const native = NativeModules.VidoraIntentLauncher as IntentLauncherModule | undefined;

/**
 * Launch a parsed Android intent:// via Intent.parseUri — never Linking.openURL.
 */
export async function openAndroidIntentUri(intentUri: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !native?.openIntentUri) {
    return false;
  }
  const trimmed = intentUri.trim();
  if (!trimmed.toLowerCase().startsWith('intent:')) {
    return false;
  }
  try {
    return Boolean(await native.openIntentUri(trimmed));
  } catch {
    return false;
  }
}

export async function canOpenAndroidIntentUri(intentUri: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !native?.canHandleIntentUri) {
    return false;
  }
  try {
    return Boolean(await native.canHandleIntentUri(intentUri.trim()));
  } catch {
    return false;
  }
}
