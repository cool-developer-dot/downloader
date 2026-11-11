import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

/** The native editor (library/MediaEditor.kt). Null on builds without it: then no edit action is shown. */
export type EditPort = {
  getTrimStart(id: string, positionMs: number): Promise<number | null>;
  startEdit(request: EditRequest): Promise<LibraryItem>;
  getEditProgress(): number | null;
  cancelEdit(): Promise<void>;
  /** Free space for the pre-check (the native editor checks again). */
  getStorageStats(): Promise<{ freeBytes: number }>;
};

const METHODS: readonly (keyof EditPort)[] = ['getTrimStart', 'startEdit', 'getEditProgress', 'cancelEdit', 'getStorageStats'];

let override: EditPort | null | undefined;

export function getEditPort(): EditPort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<Record<keyof EditPort, unknown>>;
  return METHODS.every((name) => typeof media[name] === 'function') ? (media as unknown as EditPort) : null;
}

/** `undefined` restores the real module. */
export function setEditPortForTests(port: EditPort | null | undefined): void {
  override = port;
}
