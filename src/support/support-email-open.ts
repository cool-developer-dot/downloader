import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import { Alert, Linking, Platform } from 'react-native';

import { getAppIdentityMetadata } from '@/constants/app-identity';
import { translate } from '@/localization';

import {
  SUPPORT_EMAIL_ADDRESS,
  buildSupportMailtoUrl,
  type SupportEmailDeviceInfo,
} from './support-email';

function readNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function collectSupportEmailDeviceInfo(): SupportEmailDeviceInfo {
  const { version, build } = getAppIdentityMetadata();
  const os = readNonEmpty(Device.osVersion);
  const api = Device.platformApiLevel;
  const androidVersion =
    Platform.OS === 'android'
      ? [os, typeof api === 'number' && api > 0 ? `(API ${api})` : null].filter(Boolean).join(' ') || 'Unknown'
      : `${Platform.OS} ${os ?? ''}`.trim();
  const manufacturer = readNonEmpty(Device.manufacturer);
  const model = readNonEmpty(Device.modelName);
  const device =
    manufacturer && model && !model.toLowerCase().startsWith(manufacturer.toLowerCase())
      ? `${manufacturer} ${model}`
      : (model ?? manufacturer ?? 'Unknown');
  return {
    appVersion: build && build !== '—' ? `${version} (${build})` : version,
    androidVersion,
    device,
  };
}

/**
 * Opens the user's email app on a pre-filled support email. Without an email app, says so and offers to copy the
 * address instead of failing silently. Linking.openURL is called directly: `canOpenURL('mailto:')` needs a manifest
 * query and would report "no app" even when one exists.
 */
export async function openSupportEmail(): Promise<boolean> {
  try {
    await Linking.openURL(buildSupportMailtoUrl(collectSupportEmailDeviceInfo()));
    return true;
  } catch {
    Alert.alert(
      translate('settings.noEmailAppTitle'),
      translate('settings.noEmailAppMessage', { email: SUPPORT_EMAIL_ADDRESS }),
      [
        { text: translate('common.cancel'), style: 'cancel' },
        {
          text: translate('settings.copyEmailAddress'),
          onPress: () => {
            void Clipboard.setStringAsync(SUPPORT_EMAIL_ADDRESS).catch(() => undefined);
          },
        },
      ],
    );
    return false;
  }
}
