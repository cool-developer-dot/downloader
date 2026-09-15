/**
 * Hands a chosen DownloadOption to the native download engine, once at a time per option.
 */
import { getVidoraMedia, isVidoraMediaAvailable, type DownloadRecord } from '@modules/vidorax-media';

import { translate } from '@/localization';

import type { DownloadOption } from './types';

export type DownloadResult =
  | { status: 'added'; record: DownloadRecord }
  /** The same option is already being added (double tap). */
  | { status: 'busy' }
  | { status: 'failed'; message: string };

const pending = new Set<string>();

export async function download(option: DownloadOption): Promise<DownloadResult> {
  if (!isVidoraMediaAvailable()) {
    return { status: 'failed', message: translate('detection.error.unavailable') };
  }
  if (pending.has(option.id)) {
    return { status: 'busy' };
  }
  pending.add(option.id);
  try {
    return { status: 'added', record: await getVidoraMedia().enqueue(option.request) };
  } catch (error) {
    return { status: 'failed', message: enqueueErrorMessage(error) };
  } finally {
    pending.delete(option.id);
  }
}

function enqueueErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'ERR_POLICY_BLOCKED':
      return translate('detection.error.policyBlocked');
    case 'ERR_RUNNER_START':
      return translate('detection.error.runnerStart');
    case 'ERR_INVALID_REQUEST':
      return translate('detection.error.invalidRequest');
    case 'ERR_STORAGE':
    case 'ERR_STORAGE_PERMISSION':
      return translate('detection.error.storage');
    default:
      return translate('detection.error.generic');
  }
}
