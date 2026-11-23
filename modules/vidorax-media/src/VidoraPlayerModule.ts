import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { VidoraPlayerEvents, VidoraPlayerModuleApi } from './VidoraPlayer.types';

declare class VidoraPlayerNativeModule extends NativeModule<VidoraPlayerEvents> {}

export type VidoraPlayerModule = VidoraPlayerNativeModule & VidoraPlayerModuleApi;

const nativeModule = requireOptionalNativeModule<VidoraPlayerModule>('VidoraPlayer');

/** Null in builds without Faran's Player packages (and under Node tests). */
export function getVidoraPlayer(): VidoraPlayerModule | null {
  return nativeModule;
}
