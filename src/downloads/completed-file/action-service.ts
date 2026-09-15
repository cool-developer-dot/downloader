/**
 * Phase 7B — centralized completed-file action service.
 *
 * play / open / share by downloadId only — never arbitrary caller paths.
 * Uses Phase 7A identity + Phase 1 managed path guards.
 * External handoff: content:// + temporary read grant (native Android).
 *
 * Phase 1 external open: resolveCompletedMedia → content URI → ACTION_VIEW.
 * Internal Play remains a separate route into VidoraX player (unchanged).
 */

import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { Share } from 'react-native';

import { downloadEngine } from '@/downloads/engine/manager';
import {
  assertManagedDownloadPath,
  isPartialTransferPath,
  verifyCompletedFile,
} from '@/downloads/engine/file-paths';
import { getLocalRecord } from '@/downloads/engine/persistence';
import { hardeningLog } from '@/downloads/hardening-diagnostics';
import { useDownloadsStore } from '@/store/downloads';
import { playerPath, type PlayerRoute } from '@/navigation/constants/route-paths';

import {
  resolveCompletedActions,
  resolveCompletedDescriptor,
  resolveLegacyCompletedDescriptor,
  type CompletedFileActions,
  type CompletedFileDescriptor,
} from './index';
import {
  CompletedFileActionError,
  mapCompletedActionError,
} from './action-errors';
import {
  isAndroidFileActionsNativeAvailable,
  nativeOpenContentUri,
  nativeShareContentUri,
} from './native-file-actions';
import {
  isContentUri,
  resolveExternalHandoffMime,
  validateExternalContentUri,
} from './uri-safety';

export type CompletedFileActionResult =
  | { ok: true; kind: 'play'; route: PlayerRoute }
  | { ok: true; kind: 'open' | 'share' }
  | { ok: false; error: CompletedFileActionError };

/** Authoritative resolved completed media for Open / Share / future Notifications. */
export type ResolvedCompletedMedia = {
  downloadId: string;
  finalPath: string;
  contentUri: string | null;
  mimeType: string | null;
  intentMime: string;
  displayName: string;
  fileName: string;
  exists: boolean;
  readable: boolean;
  size: number;
  descriptor: CompletedFileDescriptor;
};

function buildDescriptorFromStores(downloadId: string): {
  descriptor: CompletedFileDescriptor;
  localUri: string;
  status: string;
} {
  const item = useDownloadsStore.getState().itemsById[downloadId];
  const transfer = useDownloadsStore.getState().transferById[downloadId];

  if (!item || item.status !== 'COMPLETED') {
    throw new CompletedFileActionError(
      'NOT_COMPLETED',
      'This download is not completed.',
    );
  }

  const localUri = transfer?.localUri ?? null;
  const provisionalUri = localUri;

  const descriptor =
    resolveLegacyCompletedDescriptor({
      downloadId,
      status: item.status,
      fileName: item.fileName,
      canonicalPath: provisionalUri,
      displayTitle: item.title,
      platform: item.platform,
      sourceUrl: null, // never pass sourceUrl into action descriptor for sharing
      qualityLabel: item.quality,
      thumbnailUri: item.thumbnailUrl,
      completedAt: item.downloadedAt,
      fileSizeBytes: item.fileSize,
      physicalFilePresent: transfer?.localState === 'complete',
      evidence: {
        verifiedMimeType: item.mimeType,
        containerHint: item.container,
      },
      preserveExistingBaseName: true,
      validationSucceeded: true,
    }) ??
    resolveCompletedDescriptor({
      downloadId,
      status: 'COMPLETED',
      fileName: item.fileName,
      displayTitle: item.title,
      validationSucceeded: true,
      evidence: { verifiedMimeType: item.mimeType },
      preserveExistingBaseName: true,
    });

  if (!descriptor) {
    throw new CompletedFileActionError(
      'NOT_COMPLETED',
      'Completed file identity is unavailable.',
    );
  }

  return {
    descriptor,
    localUri: provisionalUri ?? '',
    status: item.status,
  };
}

async function resolveUsableLocalFile(downloadId: string): Promise<{
  localUri: string;
  file: File;
  descriptor: CompletedFileDescriptor;
  size: number;
}> {
  const refreshed = await downloadEngine.refreshCompletedLocalFile(downloadId);
  if (!refreshed.usable || !refreshed.localUri) {
    throw new CompletedFileActionError(
      'FILE_MISSING',
      "Downloaded file couldn't be found.",
    );
  }

  if (isPartialTransferPath(refreshed.localUri)) {
    throw new CompletedFileActionError(
      'FILE_UNREADABLE',
      "VidoraX couldn't open this downloaded file.",
    );
  }

  assertManagedDownloadPath(refreshed.localUri, downloadId);

  const file = new File(refreshed.localUri);
  const verified = verifyCompletedFile(file, null, { downloadId });
  if (!verified.ok) {
    throw new CompletedFileActionError(
      verified.reason === 'missing' ? 'FILE_MISSING' : 'FILE_UNREADABLE',
      verified.reason === 'missing'
        ? "Downloaded file couldn't be found."
        : "VidoraX couldn't open this downloaded file.",
    );
  }

  const { descriptor } = buildDescriptorFromStores(downloadId);
  const withPath: CompletedFileDescriptor = {
    ...descriptor,
    canonicalPath: refreshed.localUri,
    physicalFilePresent: true,
    fileSize: String(verified.size),
  };

  return {
    localUri: refreshed.localUri,
    file,
    descriptor: withPath,
    size: verified.size,
  };
}

function toAndroidContentUri(file: File): string {
  const uri = file.contentUri;
  if (!validateExternalContentUri(uri)) {
    throw new CompletedFileActionError(
      'URI_CREATION_FAILED',
      'Unable to prepare this file for sharing.',
    );
  }
  return uri;
}

/**
 * Resolve authoritative completed media for external handoff.
 * Does not copy bytes. Does not load the video into JS memory.
 */
export async function resolveCompletedMedia(
  downloadId: string,
): Promise<ResolvedCompletedMedia> {
  const id = downloadId.trim();
  if (!id) {
    throw new CompletedFileActionError('NOT_COMPLETED', 'Invalid download.');
  }

  hardeningLog('COMPLETED_MEDIA_RESOLVE_REQUESTED', { downloadId: id });

  const { localUri, file, descriptor, size } = await resolveUsableLocalFile(id);
  const { mimeType, intentMime } = resolveExternalHandoffMime(
    descriptor.mimeType,
    descriptor.fileName,
  );

  let contentUri: string | null = null;
  if (Platform.OS === 'android') {
    contentUri = toAndroidContentUri(file);
    hardeningLog('CONTENT_URI_RESOLVED', {
      downloadId: id,
      authorityOk: true,
    });
  }

  hardeningLog('COMPLETED_FILE_RESOLVED', {
    downloadId: id,
    size,
    mime: mimeType ?? intentMime,
    hasContentUri: contentUri != null,
  });
  hardeningLog('MIME_RESOLVED', {
    downloadId: id,
    mime: mimeType ?? intentMime,
  });

  return {
    downloadId: id,
    finalPath: localUri,
    contentUri,
    mimeType,
    intentMime,
    displayName: descriptor.displayTitle || descriptor.fileName,
    fileName: descriptor.fileName,
    exists: true,
    readable: true,
    size,
    descriptor,
  };
}

export function resolveCompletedFileActionsForId(
  downloadId: string,
  options?: { allowExternalHandoff?: boolean; allowDelete?: boolean },
): CompletedFileActions {
  const item = useDownloadsStore.getState().itemsById[downloadId];
  const transfer = useDownloadsStore.getState().transferById[downloadId];
  const physical =
    item?.status === 'COMPLETED' &&
    (transfer?.localState === 'complete' ||
      (typeof transfer?.localUri === 'string' && transfer.localUri.length > 0));

  return resolveCompletedActions({
    status: item?.status,
    workerState: item?.workerState,
    physicalFilePresent: physical,
    allowExternalHandoff: options?.allowExternalHandoff ?? true,
    allowDelete: options?.allowDelete ?? false,
    allowExport: false,
  });
}

/**
 * Play — returns Expo Router path for existing VidoraX player.
 * Does not open remote sourceUrl. Does not require Cookie/Auth.
 * Does NOT route through ACTION_VIEW.
 */
export async function playCompletedFile(
  downloadId: string,
): Promise<CompletedFileActionResult> {
  try {
    const id = downloadId.trim();
    if (!id) {
      throw new CompletedFileActionError('NOT_COMPLETED', 'Invalid download.');
    }
    await resolveUsableLocalFile(id);
    return { ok: true, kind: 'play', route: playerPath(id) };
  } catch (error) {
    return { ok: false, error: mapCompletedActionError(error) };
  }
}

/**
 * Open with Android — ACTION_VIEW + content:// + FLAG_GRANT_READ_URI_PERMISSION.
 */
export async function openCompletedFile(
  downloadId: string,
): Promise<CompletedFileActionResult> {
  try {
    hardeningLog('EXTERNAL_OPEN_REQUESTED', {
      downloadId: downloadId.trim(),
    });
    const media = await resolveCompletedMedia(downloadId.trim());

    if (Platform.OS === 'android' && isAndroidFileActionsNativeAvailable()) {
      const contentUri = media.contentUri;
      if (!contentUri || !isContentUri(contentUri)) {
        hardeningLog('EXTERNAL_OPEN_FAILED', {
          downloadId: media.downloadId,
          reason: 'uri',
        });
        throw new CompletedFileActionError(
          'URI_CREATION_FAILED',
          'Unable to prepare this file for sharing.',
        );
      }

      // Native pre-checks compatible handlers and rejects NO_COMPATIBLE_APP
      // before startActivity — avoids ActivityNotFoundException crashes and
      // package-visibility false negatives from a second JS-side probe.
      hardeningLog('EXTERNAL_HANDLER_FOUND', {
        downloadId: media.downloadId,
      });
      await nativeOpenContentUri(contentUri, media.intentMime);
      hardeningLog('EXTERNAL_OPEN_LAUNCHED', {
        downloadId: media.downloadId,
      });
      return { ok: true, kind: 'open' };
    }

    throw new CompletedFileActionError(
      'UNSUPPORTED',
      'Open with is only available on Android.',
    );
  } catch (error) {
    const mapped = mapCompletedActionError(error);
    if (mapped.code === 'FILE_MISSING') {
      hardeningLog('EXTERNAL_OPEN_FILE_MISSING', {
        downloadId: downloadId.trim(),
      });
    } else if (mapped.code !== 'NO_COMPATIBLE_APP') {
      hardeningLog(
        'EXTERNAL_OPEN_FAILED',
        { downloadId: downloadId.trim(), reason: mapped.code },
        'warn',
      );
    }
    return { ok: false, error: mapped };
  }
}

/**
 * Share via Android Sharesheet — ACTION_SEND + EXTRA_STREAM content://.
 * Never attaches sourceUrl / Cookie / Authorization.
 * Never uses React Native Share.share on Android (text/plain + message only).
 * Reuses resolveCompletedMedia — same identity as Play / Open.
 */
const shareInFlight = new Map<string, Promise<CompletedFileActionResult>>();

export async function shareCompletedFile(
  downloadId: string,
): Promise<CompletedFileActionResult> {
  const id = downloadId.trim();
  if (!id) {
    return {
      ok: false,
      error: new CompletedFileActionError('NOT_COMPLETED', 'Invalid download.'),
    };
  }

  const existing = shareInFlight.get(id);
  if (existing) {
    return existing;
  }

  const run = (async (): Promise<CompletedFileActionResult> => {
    try {
      hardeningLog('COMPLETED_MEDIA_SHARE_REQUESTED', { downloadId: id });

      const media = await resolveCompletedMedia(id);
      hardeningLog('COMPLETED_MEDIA_SHARE_RESOLVED', {
        downloadId: id,
        mime: media.intentMime,
        size: media.size,
        hasContentUri: media.contentUri != null,
      });

      if (Platform.OS === 'android' && isAndroidFileActionsNativeAvailable()) {
        const contentUri = media.contentUri;
        if (!contentUri || !isContentUri(contentUri)) {
          hardeningLog(
            'COMPLETED_MEDIA_SHARE_FAILED',
            { downloadId: id, reason: 'uri' },
            'warn',
          );
          throw new CompletedFileActionError(
            'URI_CREATION_FAILED',
            'Unable to prepare this file for sharing.',
          );
        }

        // Title/display name is optional subject only — attachment is EXTRA_STREAM.
        await nativeShareContentUri(
          contentUri,
          media.intentMime,
          media.displayName,
        );
        hardeningLog('COMPLETED_MEDIA_SHARE_INTENT_STARTED', {
          downloadId: id,
          mime: media.intentMime,
        });
        return { ok: true, kind: 'share' };
      }

      if (Platform.OS === 'ios') {
        // iOS Share accepts file:// for same-device share; Android must never
        // use RN Share (text/plain-only).
        const file = new File(media.finalPath);
        await Share.share({ url: file.uri, title: media.displayName });
        return { ok: true, kind: 'share' };
      }

      // Android without native bridge: do NOT fall back to RN Share.share —
      // it forces text/plain and ignores file URLs (filename-only shares).
      throw new CompletedFileActionError(
        'SHARE_FAILED',
        'Unable to share this video.',
      );
    } catch (error) {
      const mapped = mapCompletedActionError(error);
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        message.includes('cancel') ||
        message.includes('dismiss') ||
        message.includes('sharedaction')
      ) {
        hardeningLog('COMPLETED_MEDIA_SHARE_CANCELLED', { downloadId: id });
        return { ok: true, kind: 'share' };
      }
      if (mapped.code === 'FILE_MISSING') {
        hardeningLog('COMPLETED_MEDIA_SHARE_FAILED', {
          downloadId: id,
          reason: 'missing',
        });
      } else {
        hardeningLog(
          'COMPLETED_MEDIA_SHARE_FAILED',
          { downloadId: id, reason: mapped.code },
          'warn',
        );
      }
      return { ok: false, error: mapped };
    } finally {
      shareInFlight.delete(id);
    }
  })();

  shareInFlight.set(id, run);
  return run;
}

/**
 * Create a content:// URI for a managed completed file without launching an Intent.
 * Used by tests/diagnostics — does not load file bytes into JS.
 */
export async function createCompletedFileContentUri(
  downloadId: string,
): Promise<{ contentUri: string; mimeType: string | null }> {
  const media = await resolveCompletedMedia(downloadId.trim());
  if (Platform.OS !== 'android') {
    throw new CompletedFileActionError(
      'UNSUPPORTED',
      'content:// URIs are Android-only.',
    );
  }
  if (!media.contentUri || !isContentUri(media.contentUri)) {
    throw new CompletedFileActionError(
      'URI_CREATION_FAILED',
      'Unable to prepare this file for sharing.',
    );
  }
  return { contentUri: media.contentUri, mimeType: media.mimeType };
}

/** Prefer engine record when store transfer URI is stale. */
export async function peekCompletedLocalUri(
  downloadId: string,
): Promise<string | null> {
  const record = await getLocalRecord(downloadId);
  return record?.localUri ?? null;
}
