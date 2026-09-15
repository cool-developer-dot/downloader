import { requireOptionalNativeModule, type NativeModule } from 'expo';

import type { VidoraWebEvents, VidoraWebModuleApi } from './VidoraWeb.types';

export type VidoraWebModule = NativeModule<VidoraWebEvents> & VidoraWebModuleApi;

const nativeModule = requireOptionalNativeModule<VidoraWebModule>('VidoraWeb');

export function isVidoraWebAvailable(): boolean {
  return nativeModule != null;
}

/** Throws when the installed Android build does not include modules/vidorax-web. */
export function getVidoraWeb(): VidoraWebModule {
  if (!nativeModule) {
    throw new Error('VidoraWeb native module is missing. Rebuild the Android app (npx expo run:android).');
  }
  return nativeModule;
}
