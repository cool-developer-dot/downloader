import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Share, ToastAndroid } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { ProgressBar } from '@/components/common/ProgressBar';
import {
  canOfferRepair,
  checksumPercent,
  fileIntegrity,
  groupSha256,
  isPlayable,
  isSha256,
  mayPlayWhileDownloading,
  repairMessageKey,
  shouldAskAgain,
  storedChecksum,
} from '@/downloads/v2/file-integrity';
import { useTranslation } from '@/localization';
import { isEngineOwned } from '@/downloads/v2';
import { navigation } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

import { formatDownloadFileSize } from '../utils/download-format';

const PROGRESS_POLL_MS = 250;
const PLAYABLE_POLL_MS = 3_000;

function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.5 }}>
      {children}
    </Text>
  );
}

/** Checksum Verify (#409): the stored SHA-256, or Compute with progress and Cancel; then Copy and Share. */
const ChecksumPanel = memo(function ChecksumPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [sha256, setSha256] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [computing, setComputing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const alive = useRef(true);
  /** True while this panel's own compute call waits for its answer. */
  const ownRun = useRef(false);

  useEffect(() => {
    alive.current = true;
    void storedChecksum(fileIntegrity(), id).then((state) => {
      if (!alive.current || !state) return;
      setSha256(state.sha256);
      setComputing(state.computing && !state.sha256);
    });
    return () => {
      alive.current = false;
    };
  }, [id]);

  // While it runs, the progress is read a few times a second (the native call is synchronous and cheap). A run that
  // began before this screen opened has no answer to wait for here: when it ends, the stored hash is read.
  useEffect(() => {
    if (!computing) return;
    const port = fileIntegrity();
    const timer = setInterval(() => {
      const progress = port?.getChecksumProgress?.(id) ?? null;
      if (progress) {
        setPercent(checksumPercent(progress));
        return;
      }
      if (ownRun.current) return;
      void storedChecksum(port, id).then((state) => {
        if (!alive.current || !state || state.computing) return;
        setSha256(state.sha256);
        setComputing(false);
        setPercent(null);
      });
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [computing, id]);

  const compute = useCallback(async () => {
    const port = fileIntegrity();
    if (!port?.computeChecksum) {
      setNote(t('fileIntegrity.unavailable'));
      return;
    }
    setNote(null);
    setPercent(0);
    setComputing(true);
    ownRun.current = true;
    try {
      const result = await port.computeChecksum(id);
      if (!alive.current) return;
      if (isSha256(result)) {
        setSha256(result);
      } else {
        setNote(t('fileIntegrity.checksumCancelled'));
      }
    } catch {
      if (alive.current) setNote(t('fileIntegrity.checksumFailed'));
    } finally {
      ownRun.current = false;
      if (alive.current) {
        setComputing(false);
        setPercent(null);
      }
    }
  }, [id, t]);

  const cancel = useCallback(() => {
    fileIntegrity()?.cancelChecksum?.(id);
  }, [id]);

  const copy = useCallback(async () => {
    if (!sha256) return;
    try {
      await Clipboard.setStringAsync(sha256);
      setNote(t('fileIntegrity.copied'));
    } catch {
      setNote(t('fileIntegrity.copyFailed'));
    }
  }, [sha256, t]);

  const share = useCallback(() => {
    if (!sha256) return;
    void Share.share({ message: `SHA-256: ${sha256}` }).catch(() => undefined);
  }, [sha256]);

  return (
    <Box gap={8} testID="download-details-checksum">
      <SectionTitle>{t('fileIntegrity.checksumTitle')}</SectionTitle>
      {sha256 ? (
        <>
          <Text
            variant="bodySmall"
            selectable
            accessibilityLabel={`${t('fileIntegrity.checksumTitle')}: ${sha256}`}
            style={{ fontFamily: 'monospace', writingDirection: 'ltr', textAlign: 'left' }}
            testID="download-details-checksum-value">
            {groupSha256(sha256)}
          </Text>
          <Box row gap={10}>
            <Box flex={1}>
              <Button title={t('fileIntegrity.copy')} variant="outline" onPress={copy} fullWidth testID="download-details-checksum-copy" />
            </Box>
            <Box flex={1}>
              <Button title={t('fileIntegrity.share')} variant="outline" onPress={share} fullWidth testID="download-details-checksum-share" />
            </Box>
          </Box>
        </>
      ) : computing ? (
        <Box gap={6}>
          <ProgressBar progress={(percent ?? 0) / 100} accessibilityLabel={t('fileIntegrity.computing')} />
          <Box row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="caption" color="textSecondary">
              {percent != null ? t('fileIntegrity.computingPercent', { percent }) : t('fileIntegrity.computing')}
            </Text>
            <Button title={t('common.cancel')} variant="ghost" size="small" onPress={cancel} testID="download-details-checksum-cancel" />
          </Box>
        </Box>
      ) : (
        <Box gap={6}>
          <Text variant="caption" color="textSecondary">
            {t('fileIntegrity.checksumHint')}
          </Text>
          <Button title={t('fileIntegrity.compute')} variant="outline" onPress={() => void compute()} fullWidth testID="download-details-checksum-compute" />
        </Box>
      )}
      {note ? (
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </Box>
  );
});

/** Repair Partial File (#412): a failed download with a partial file on disk. */
const RepairPanel = memo(function RepairPanel({ id, status }: { id: string; status: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A synchronous native read of the work folder; asked again when the download's state changes.
  const info = useMemo(() => {
    try {
      return fileIntegrity()?.getRepairInfo?.(id) ?? null;
    } catch {
      return null;
    }
    // `status` re-reads it after a Retry or a Repair changed the files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status]);

  const repair = useCallback(async () => {
    const port = fileIntegrity();
    if (!port?.repairDownload) return;
    setBusy(true);
    setNote(null);
    let message: string;
    try {
      message = t(repairMessageKey(await port.repairDownload(id)));
    } catch {
      message = t('fileIntegrity.repairFailed');
    }
    setBusy(false);
    setNote(message);
    // The download usually leaves "failed" at once (it is retried), which replaces this panel: say it as a toast too.
    if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
    AccessibilityInfo.announceForAccessibility(message);
  }, [id, t]);

  if (!canOfferRepair(status, info) && !note) return null;
  return (
    <Box gap={8} testID="download-details-repair">
      {canOfferRepair(status, info) ? (
        <>
          <Text variant="caption" color="textSecondary">
            {t('fileIntegrity.repairHint', { size: formatDownloadFileSize(String(info?.partialBytes ?? 0)) ?? '' })}
          </Text>
          <Button title={t('fileIntegrity.repair')} variant="outline" onPress={() => void repair()} loading={busy} fullWidth testID="download-details-repair-button" />
        </>
      ) : null}
      {note ? (
        <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
    </Box>
  );
});

/** Play While Downloading (#411): offered once native code says the `.part` can be played. */
const PlayWhileDownloadingPanel = memo(function PlayWhileDownloadingPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const [playable, setPlayable] = useState(false);

  useEffect(() => {
    const port = fileIntegrity();
    if (!port?.checkPlayable) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const answer = await port.checkPlayable?.(id).catch(() => null);
      if (!alive) return;
      const now = isPlayable(answer);
      setPlayable(now);
      // Only "not enough bytes yet" can change by itself: then it is asked again now and then. Once playable it stays
      // offered; a file that can never be played (a stream, an index at the end…) is not asked about again.
      if (shouldAskAgain(answer)) timer = setTimeout(() => void check(), PLAYABLE_POLL_MS);
    };
    void check();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (!playable) return null;
  return (
    <Box gap={6} testID="download-details-play-while-downloading">
      <Button
        title={t('fileIntegrity.playWhileDownloading')}
        variant="outline"
        onPress={() =>
          navigation.push({ pathname: '/play-while-downloading', params: { id } } as unknown as Href)
        }
        fullWidth
        testID="download-details-play-while-downloading-button"
      />
      <Text variant="caption" color="textSecondary">
        {t('fileIntegrity.playWhileDownloadingHint')}
      </Text>
    </Box>
  );
});

/**
 * H20 File integrity in Download Details, for downloads of the native engine: the SHA-256 of a finished file, Repair
 * for a failed one with a partial file, and Play While Downloading for one still downloading.
 */
export const DownloadIntegritySection = memo(function DownloadIntegritySection({
  id,
  status,
  workerState,
}: {
  id: string;
  status: string;
  workerState?: string | null;
}) {
  const engineOwned = useDownloadsStore((state) => isEngineOwned(state, id));
  if (!fileIntegrity()) return null;
  if (status === 'COMPLETED') return <ChecksumPanel id={id} />;
  if (!engineOwned) return null;
  if (status === 'FAILED') return <RepairPanel id={id} status={status} />;
  if (mayPlayWhileDownloading(status, workerState)) return <PlayWhileDownloadingPanel id={id} />;
  return null;
});
