/**
 * The media permission for reading the device's own videos (READ_MEDIA_VIDEO on Android 13+). Asked once, from
 * the screen that needs it; a refusal simply leaves the list empty and says so.
 */

import * as ReactNative from 'react-native';

let asked = false;

export function resetDeviceVideoPermissionForTests(): void {
  asked = false;
}

/** Returns whether VidoraX may read the device's videos. Never throws. */
export async function ensureDeviceVideoPermission(options: { force?: boolean } = {}): Promise<boolean> {
  try {
    const permissions = ReactNative.PermissionsAndroid;
    if (!permissions || ReactNative.Platform.OS !== 'android') {
      return false;
    }
    const version = ReactNative.Platform.Version;
    const api = typeof version === 'number' ? version : 0;
    const name =
      api >= 33
        ? permissions.PERMISSIONS.READ_MEDIA_VIDEO
        : permissions.PERMISSIONS.READ_EXTERNAL_STORAGE;
    if (!name) {
      return false;
    }
    // Android 14 lets the user grant only the items they pick; that counts as access.
    const partial = 'android.permission.READ_MEDIA_VISUAL_USER_SELECTED';
    const hasPartial = async () => (api >= 34 ? permissions.check(partial).catch(() => false) : false);
    if ((await permissions.check(name)) || (await hasPartial())) {
      return true;
    }
    if (asked && !options.force) {
      return false;
    }
    asked = true;
    const result = await permissions.request(name);
    return result === permissions.RESULTS.GRANTED || (await hasPartial());
  } catch {
    return false;
  }
}
