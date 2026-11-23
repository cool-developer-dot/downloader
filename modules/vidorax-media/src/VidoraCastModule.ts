import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { VidoraCastEvents, VidoraCastModuleApi } from './VidoraCast.types';

declare class VidoraCastNativeModule extends NativeModule<VidoraCastEvents> {}

export type VidoraCastModule = VidoraCastNativeModule & VidoraCastModuleApi;

const nativeModule = requireOptionalNativeModule<VidoraCastModule>('VidoraCast');

/** Null in builds without P13 (and under Node tests). */
export function getVidoraCast(): VidoraCastModule | null {
  return nativeModule;
}
