import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type { VidoraMediaEvents, VidoraMediaModuleApi } from './VidoraMedia.types';

export type VidoraMediaModule = NativeModule<VidoraMediaEvents> & VidoraMediaModuleApi;

const nativeModule = requireOptionalNativeModule<VidoraMediaModule>('VidoraMedia');

export function isVidoraMediaAvailable(): boolean {
  return nativeModule != null;
}

/** Throws when the installed Android build does not include modules/vidorax-media. */
export function getVidoraMedia(): VidoraMediaModule {
  if (!nativeModule) {
    throw new Error('VidoraMedia native module is missing. Rebuild the Android app (npx expo run:android).');
  }
  return nativeModule;
}
