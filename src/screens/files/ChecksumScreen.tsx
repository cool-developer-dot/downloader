import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { DsButton, DsCard, DsHeader, DsScreen, DsText } from '@/design';
import { checksumPercent, fileIntegrity, groupSha256, isSha256, storedChecksum } from '@/downloads/v2/file-integrity';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

import { announce } from './announce';
import { useFilesSettingsAction } from './hooks/use-files-settings-action';
import { compareChecksum } from './utils/checksum-compare';

function paramOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

type State = { kind: 'computing'; percent: number | null } | { kind: 'done'; sha256: string } | { kind: 'failed' } | { kind: 'unavailable' };

/** How often the running computation's progress is read. */
const PROGRESS_POLL_MS = 500;

/**
 * Files F3 · #827 Checksum (`/files/checksum/[id]`): a spinner while the native `computeChecksum(id)` streams the file
 * through SHA-256 (a stored digest shows at once), then the hash with Copy, and a paste field that says "Match ✔" or
 * "Doesn't match ✘" — case and spaces don't matter. Leaving while it runs is safe: the computation finishes on its own
 * and keeps its result, and this page ignores the answer.
 */
export const ChecksumScreen = memo(function ChecksumScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const id = paramOf(useLocalSearchParams<{ id?: string | string[] }>().id);
  const name = useDownloadsStore((s) => {
    const item = s.engineRowsById[id] ?? s.itemsById[id];
    return item?.fileName?.trim() || item?.title?.trim() || '';
  });
  const settingsAction = useFilesSettingsAction();
  // Older builds have no checksum: say so instead of a spinner that never ends.
  const [state, setState] = useState<State>(() =>
    typeof fileIntegrity()?.computeChecksum === 'function' && id ? { kind: 'computing', percent: null } : { kind: 'unavailable' },
  );
  const [pasted, setPasted] = useState('');
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    const port = fileIntegrity();
    let timer: ReturnType<typeof setInterval> | null = null;
    const finish = (next: State) => {
      if (timer) clearInterval(timer);
      if (liveRef.current) setState(next);
    };
    const compute = port?.computeChecksum;
    if (!port || !compute || !id) {
      return undefined;
    }
    void (async () => {
      const stored = await storedChecksum(port, id);
      if (stored?.sha256) {
        finish({ kind: 'done', sha256: stored.sha256 });
        return;
      }
      timer = setInterval(() => {
        const percent = checksumPercent(port.getChecksumProgress?.(id) ?? null);
        if (liveRef.current) setState((current) => (current.kind === 'computing' ? { kind: 'computing', percent } : current));
      }, PROGRESS_POLL_MS);
      try {
        const digest = await compute.call(port, id);
        finish(isSha256(digest) ? { kind: 'done', sha256: digest } : { kind: 'failed' });
      } catch {
        finish({ kind: 'failed' });
      }
    })();
    return () => {
      liveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [id]);

  const verdict = state.kind === 'done' ? compareChecksum(state.sha256, pasted) : 'empty';

  return (
    <DsScreen edges={['top', 'bottom']} testID="files-checksum-screen">
      <DsHeader title={t('fileManager.checksumTitle')} subtitle={name || undefined} onBack={() => navigation.back()} action={settingsAction} />
      <DsCard testID="files-checksum-card">
        {state.kind === 'computing' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}>
            <ActivityIndicator color={theme.colors.primary} />
            <DsText variant="body" align="center" accessibilityLiveRegion="polite">
              {state.percent != null
                ? t('fileManager.checksumComputing', { percent: `${state.percent}%` })
                : t('fileManager.checksumComputingPlain')}
            </DsText>
          </View>
        ) : state.kind === 'done' ? (
          <View style={{ gap: 10 }}>
            <DsText variant="rowSub">{t('lightFileActions.sha256')}</DsText>
            <DsText variant="bodyStrong" selectable testID="files-checksum-hash">
              {groupSha256(state.sha256)}
            </DsText>
            <DsButton
              label={t('fileManager.copy')}
              icon="copy"
              variant="secondary"
              onPress={() => {
                void Clipboard.setStringAsync(state.sha256).then(() => announce(t('fileManager.copied')));
              }}
              testID="files-checksum-copy"
            />
          </View>
        ) : (
          <DsText variant="body" color="error">
            {state.kind === 'unavailable' ? t('fileManager.checksumUnavailable') : t('fileManager.checksumFailed')}
          </DsText>
        )}
      </DsCard>
      {state.kind === 'done' ? (
        <DsCard>
          <View style={{ gap: 10 }}>
            <TextField
              label={t('fileManager.checksumPaste')}
              value={pasted}
              onChangeText={setPasted}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              testID="files-checksum-paste"
            />
            {verdict !== 'empty' ? (
              <DsText
                variant="bodyStrong"
                color={verdict === 'match' ? 'success' : 'error'}
                accessibilityLiveRegion="polite"
                testID="files-checksum-verdict">
                {verdict === 'match'
                  ? t('fileManager.checksumMatch')
                  : verdict === 'wrong-length'
                    ? t('fileManager.checksumWrongLength')
                    : t('fileManager.checksumMismatch')}
              </DsText>
            ) : null}
          </View>
        </DsCard>
      ) : null}
    </DsScreen>
  );
});
