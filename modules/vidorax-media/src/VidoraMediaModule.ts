import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { VidoraMediaEvents, VidoraMediaModuleApi } from './VidoraMedia.types';

// `NativeModule<Events>` as a type is the constructor; extending it gives the instance event API (addListener).
declare class VidoraMediaNativeModule extends NativeModule<VidoraMediaEvents> {}

export type VidoraMediaModule = VidoraMediaNativeModule & VidoraMediaModuleApi;

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
