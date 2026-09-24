import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { VidoraWebEvents, VidoraWebModuleApi } from './VidoraWeb.types';

// `NativeModule<Events>` as a type is the constructor; extending it gives the instance event API (addListener).
declare class VidoraWebNativeModule extends NativeModule<VidoraWebEvents> {}

export type VidoraWebModule = VidoraWebNativeModule & VidoraWebModuleApi;

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
