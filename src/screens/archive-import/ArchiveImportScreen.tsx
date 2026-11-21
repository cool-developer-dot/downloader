import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';
import type { ArchiveExtraction, ArchiveInspection } from '@modules/vidorax-media/src/VidoraMedia.types';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { DsHeader, DsScreen } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatFileSize } from '@/media-detection/utils/format';
import { navigation } from '@/navigation';
import { routePaths } from '@/navigation/constants/route-paths';
import { externalMediaId, isIncomingMediaToken, knownIncomingMedia } from '@/player/external-media';

import { isUnsupportedArchive, MALICIOUS_REFUSALS, refusalKey } from './archive-import';

type State =
  | { step: 'loading' }
  | { step: 'listed'; listing: Extract<ArchiveInspection, { status: 'ok' }> }
  | { step: 'refused'; reason: string }
  | { step: 'extracting' }
  | { step: 'done'; result: Extract<ArchiveExtraction, { status: 'extracted' }> }
  | { step: 'failed'; code: string | null };

const KIND_ICONS: Record<string, IconName> = {
  video: 'movie-outline',
  subtitle: 'subtitles-outline',
  program: 'shield-alert-outline',
  other: 'file-outline',
};

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

/**
 * P8 #407 Extract Archive: a `.zip` opened with (or shared to) VidoraX. Lists what is inside, warns about programs in
 * it, and imports its videos — with their `.srt`/`.vtt` subtitles — into the library; files already there are
 * skipped. RAR and 7z are refused with a plain "not supported".
 */
export const ArchiveImportScreen = memo(function ArchiveImportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const valid = isIncomingMediaToken(token);
  const incoming = valid ? knownIncomingMedia(externalMediaId(token)) : null;
  const [state, setState] = useState<State>({ step: 'loading' });
  const extracted = useRef(false);

  useEffect(() => {
    if (!valid || !isVidoraMediaAvailable() || !getVidoraMedia().inspectIncomingArchive) {
      setState({ step: 'failed', code: 'ERR_NOT_FOUND' });
      return undefined;
    }
    if (isUnsupportedArchive(incoming)) {
      setState({ step: 'refused', reason: 'rar' });
      return undefined;
    }
    let live = true;
    getVidoraMedia()
      .inspectIncomingArchive!(token)
      .then((listing) => {
        if (!live) return;
        setState(listing.status === 'ok' ? { step: 'listed', listing } : { step: 'refused', reason: listing.reason });
      })
      .catch((error: unknown) => {
        if (live) setState({ step: 'failed', code: errorCode(error) });
      });
    return () => {
      live = false;
    };
  }, [incoming, token, valid]);

  // Leaving without extracting deletes the copied archive.
  useEffect(
    () => () => {
      if (!extracted.current && isVidoraMediaAvailable()) {
        void getVidoraMedia().discardIncomingArchive?.().catch(() => undefined);
      }
    },
    [],
  );

  const runExtract = useCallback(async () => {
    if (!valid) return;
    extracted.current = true;
    setState({ step: 'extracting' });
    try {
      const result = await getVidoraMedia().extractIncomingArchive!(token);
      setState(result.status === 'extracted' ? { step: 'done', result } : { step: 'refused', reason: result.reason });
    } catch (error) {
      setState({ step: 'failed', code: errorCode(error) });
    }
  }, [token, valid]);

  const onExtract = useCallback(() => {
    if (state.step !== 'listed') return;
    const programs = state.listing.programs;
    if (programs.length === 0) {
      void runExtract();
      return;
    }
    // P8 #461: programs inside are named before anything is extracted; they themselves never are.
    Alert.alert(
      t('fileSafety.archiveProgramsTitle'),
      t('fileSafety.archiveProgramsMessage', { names: programs.slice(0, 5).join(', ') }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('fileSafety.extractAnyway'), style: 'destructive', onPress: () => void runExtract() },
      ],
      { cancelable: true },
    );
  }, [runExtract, state, t]);

  const goBack = useCallback(() => navigation.back(), []);
  const openLibrary = useCallback(() => navigation.navigate(routePaths.library), []);
  const archiveName = incoming?.displayName ?? t('archiveImport.untitled');

  const card = { backgroundColor: theme.colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border };

  return (
    <DsScreen testID="archive-import-screen" edges={['top', 'bottom']}>
      <DsHeader title={t('archiveImport.title')} onBack={goBack} testID="archive-import-header" />
      <Box row rtlRow gap={10} style={{ alignItems: 'center' }}>
        <Icon name="folder-zip-outline" size={24} color="primary" />
        <Text variant="subtitle" numberOfLines={2} style={{ flex: 1 }}>
          {archiveName}
        </Text>
      </Box>

      {state.step === 'loading' || state.step === 'extracting' ? (
        <Box gap={8} testID={`archive-import-${state.step}`}>
          <Button title={t(state.step === 'loading' ? 'archiveImport.reading' : 'archiveImport.extracting')} loading disabled fullWidth />
        </Box>
      ) : null}

      {state.step === 'refused' ? (
        <Box row rtlRow gap={10} p={14} borderRadius="md" style={{ ...card, borderColor: theme.colors.error }} testID="archive-import-refused">
          <Icon name={MALICIOUS_REFUSALS.has(state.reason as never) ? 'shield-alert-outline' : 'alert-circle-outline'} size={22} color="error" />
          <Text variant="bodySmall" color="textPrimary" style={{ flex: 1 }}>
            {t(refusalKey(state.reason))}
          </Text>
        </Box>
      ) : null}

      {state.step === 'failed' ? (
        <Box row rtlRow gap={10} p={14} borderRadius="md" style={card} testID="archive-import-failed">
          <Icon name="alert-circle-outline" size={22} color="error" />
          <Text variant="bodySmall" style={{ flex: 1 }}>
            {t(
              state.code === 'ERR_NO_SPACE'
                ? 'archiveImport.failedNoSpace'
                : state.code === 'ERR_NOT_FOUND'
                  ? 'archiveImport.failedGone'
                  : 'archiveImport.failed',
            )}
          </Text>
        </Box>
      ) : null}

      {state.step === 'listed' ? (
        <Box gap={12} testID="archive-import-listing">
          <Text variant="bodySmall" color="textSecondary">
            {t('archiveImport.summary', {
              entries: String(state.listing.entryCount),
              videos: String(state.listing.videoCount),
              subtitles: String(state.listing.subtitleCount),
              size: formatFileSize(state.listing.totalBytes) ?? '0 B',
            })}
          </Text>
          {state.listing.programs.length > 0 ? (
            <Box row rtlRow gap={10} p={12} borderRadius="md" style={{ ...card, borderColor: theme.colors.error }} testID="archive-import-programs">
              <Icon name="shield-alert-outline" size={20} color="error" />
              <Text variant="caption" style={{ flex: 1 }}>
                {t('fileSafety.archiveProgramsMessage', { names: state.listing.programs.slice(0, 5).join(', ') })}
              </Text>
            </Box>
          ) : null}
          <Box gap={2} p={8} borderRadius="md" style={card}>
            {state.listing.entries.map((entry) => (
              <Box key={entry.name} row rtlRow gap={10} py={8} style={{ alignItems: 'center' }}>
                <Icon name={KIND_ICONS[entry.kind] ?? 'file-outline'} size={18} color={entry.kind === 'program' ? 'error' : 'secondary'} />
                <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                  {entry.name}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {formatFileSize(entry.sizeBytes) ?? ''}
                </Text>
              </Box>
            ))}
          </Box>
          {state.listing.videoCount > 0 ? (
            <Button
              title={t(state.listing.videoCount === 1 ? 'archiveImport.extractOne' : 'archiveImport.extractOther', {
                count: String(state.listing.videoCount),
              })}
              variant="primary"
              fullWidth
              leftIcon="tray-arrow-down"
              onPress={onExtract}
              testID="archive-import-extract"
            />
          ) : (
            <Text variant="bodySmall" color="textSecondary" testID="archive-import-no-videos">
              {t('archiveImport.noVideos')}
            </Text>
          )}
        </Box>
      ) : null}

      {state.step === 'done' ? (
        <Box gap={12} testID="archive-import-done">
          <Text variant="bodySmall">
            {t('archiveImport.done', {
              imported: String(state.result.imported.length),
              duplicates: String(state.result.duplicates),
              subtitles: String(state.result.subtitles),
            })}
          </Text>
          {state.result.disguised.length > 0 ? (
            <Box row rtlRow gap={10} p={12} borderRadius="md" style={{ ...card, borderColor: theme.colors.error }} testID="archive-import-disguised">
              <Icon name="shield-alert-outline" size={20} color="error" />
              <Text variant="caption" style={{ flex: 1 }}>
                {t('fileSafety.archiveDisguisedMessage', { names: state.result.disguised.slice(0, 5).join(', ') })}
              </Text>
            </Box>
          ) : null}
          {state.result.failed > 0 ? (
            <Text variant="caption" color="error">
              {t('archiveImport.someFailed', { count: String(state.result.failed) })}
            </Text>
          ) : null}
          {state.result.imported.length > 0 ? (
            <Button title={t('archiveImport.openLibrary')} variant="primary" fullWidth onPress={openLibrary} testID="archive-import-open-library" />
          ) : null}
          <Button title={t('common.done')} variant="outline" fullWidth onPress={goBack} testID="archive-import-close" />
        </Box>
      ) : null}
    </DsScreen>
  );
});
