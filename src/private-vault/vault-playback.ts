/**
 * Playing a private video (#459): the vault decrypts it to one temporary file in the app's private cache, the
 * player shows it, and the file is deleted when the player closes, the user leaves the section, or the app goes to
 * the background; leftovers from an earlier run are deleted at start. Pure: what to do on each event.
 */

export type VaultPlayback =
  | { phase: 'idle' }
  | { phase: 'preparing'; token: number; itemId: string }
  | { phase: 'playing'; token: number; itemId: string; uri: string };

export type VaultPlaybackEvent =
  | { type: 'open'; token: number; itemId: string }
  /** The decrypted file is ready (`token` says for which open). */
  | { type: 'ready'; token: number; uri: string }
  | { type: 'failed'; token: number }
  | { type: 'close' }
  | { type: 'app-background' }
  | { type: 'left-section' };

export type VaultPlaybackStep = {
  state: VaultPlayback;
  /** Delete the temporary playback file(s) now. */
  clearTemp: boolean;
};

export const IDLE_PLAYBACK: VaultPlayback = { phase: 'idle' };

/** The only files the player may be given: decrypted copies in the vault's playback folder. */
export function isVaultPlaybackUri(uri: string): boolean {
  return /^file:\/\/\/.+\/vault-play\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/i.test(uri);
}

/** Pure: the next playback state, and whether the temporary file must go now. */
export function reduceVaultPlayback(state: VaultPlayback, event: VaultPlaybackEvent): VaultPlaybackStep {
  switch (event.type) {
    case 'open':
      // The native side removes any earlier playback file before it writes the new one.
      return { state: { phase: 'preparing', token: event.token, itemId: event.itemId }, clearTemp: false };
    case 'ready':
      if (state.phase === 'preparing' && state.token === event.token && isVaultPlaybackUri(event.uri)) {
        return { state: { phase: 'playing', token: state.token, itemId: state.itemId, uri: event.uri }, clearTemp: false };
      }
      // Closed (or replaced) while it was being decrypted: the file nobody will play is deleted at once.
      return { state, clearTemp: true };
    case 'failed':
      return state.phase !== 'idle' && state.token === event.token
        ? { state: IDLE_PLAYBACK, clearTemp: true }
        : { state, clearTemp: false };
    case 'close':
    case 'app-background':
    case 'left-section':
      return { state: IDLE_PLAYBACK, clearTemp: true };
    default:
      return { state, clearTemp: false };
  }
}
