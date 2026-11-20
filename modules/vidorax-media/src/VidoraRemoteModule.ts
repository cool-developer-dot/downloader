import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { VidoraRemoteEvents, VidoraRemoteModuleApi } from './VidoraRemote.types';

declare class VidoraRemoteNativeModule extends NativeModule<VidoraRemoteEvents> {}

export type VidoraRemoteModule = VidoraRemoteNativeModule & VidoraRemoteModuleApi;

const nativeModule = requireOptionalNativeModule<VidoraRemoteModule>('VidoraRemote');

/** Null in builds without P6 (and under Node tests). */
export function getVidoraRemote(): VidoraRemoteModule | null {
  return nativeModule;
}
