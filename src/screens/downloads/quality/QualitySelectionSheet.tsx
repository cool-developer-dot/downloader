import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsButton, DsButtonRow, DsChip, DsChipRow, DsHeader, DsRowGroup, DsSearchField, DsText, ds } from '@/design';
import { isAnalyzeBusy } from '@/downloads/analyze/analyze-state-machine';
import { resolveDisplayHost } from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { isPlayableOffer, playsChosenQuality } from '@/player/remote-stream';
import { useTourBlocker } from '@/tour/tour-store';

import { AnalysisLoadingState } from './AnalysisLoadingState';
import { AnalyzeFallbackState } from './AnalyzeFallbackState';
import { downloadButtonLabel } from './constants';
import { DownloadOptionsPanel } from './DownloadOptionsPanel';
import { DownloadPreview } from './DownloadPreview';
import { MediaResultCard } from './MediaResultCard';
import { QualityOptionRow } from './QualityOptionRow';
import type { UseQualitySelectionResult } from './useQualitySelection';

export type QualitySelectionSheetProps = {
  controller: UseQualitySelectionResult;
};

type Track = 'video' | 'audio';

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Design 33 "Video detected · Sheet": "Download video" over the page's host, the hero preview, Video · Audio only ·
 * Subtitles chips, the quality rows (a tap downloads that quality) and the Rename · Save to · Trim card. The same
 * bottom sheet as before (it opens over the browser), driven by the same controller; only its content changed.
 */
export const QualitySelectionSheet = memo(function QualitySelectionSheet({
  controller,
}: QualitySelectionSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    visible,
    url,
    urlError,
    phase,
    platform,
    progressMessage,
    selection,
    selectedId,
    selectedOption,
    errorMessage,
    emptyMessage,
    creating,
    createError,
    analyzing,
    close,
    setUrl,
    pasteUrl,
    analyze,
    retry,
    resetToInput,
    selectOption,
    confirmDownload,
    playing,
    playOption,
    openPendingInBrowser,
    flowKind,
    isBrowserHandoffActive,
  } = controller;

  const [track, setTrack] = useState<Track>('video');
  // A row tap selects its quality and, once the selection landed, starts the download — one tap, as the design.
  const pendingConfirmRef = useRef<string | null>(null);

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text?.trim()) {
        pasteUrl(text);
      }
    } catch {
      // Clipboard may be unavailable — ignore.
    }
  }, [pasteUrl]);

  const handleAnalyze = useCallback(() => {
    void analyze();
  }, [analyze]);

  const isBrowserQualityHandoff = flowKind === 'page' || isBrowserHandoffActive();

  const handleRetry = useCallback(() => {
    void retry();
  }, [retry]);

  const handlePlay = useCallback(
    (optionId?: string) => {
      void playOption(optionId);
    },
    [playOption],
  );

  const notYet = useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);

  const openSettings = useCallback(() => {
    close();
    navigation.push(routePaths.downloadSettings);
  }, [close]);

  const handleRowPress = useCallback(
    (id: string) => {
      if (phase !== 'ready') {
        selectOption(id);
        return;
      }
      if (id === selectedId) {
        void confirmDownload();
        return;
      }
      pendingConfirmRef.current = id;
      selectOption(id);
    },
    [confirmDownload, phase, selectOption, selectedId],
  );

  useEffect(() => {
    if (pendingConfirmRef.current && pendingConfirmRef.current === selectedId) {
      pendingConfirmRef.current = null;
      void confirmDownload();
    }
  }, [confirmDownload, selectedId]);

  useEffect(() => {
    if (!visible) {
      pendingConfirmRef.current = null;
      setTrack('video');
    }
  }, [visible]);

  const videoOptions = useMemo(() => selection?.options.filter((option) => !option.isAudioOnly) ?? [], [selection]);
  const audioOptions = useMemo(() => selection?.options.filter((option) => option.isAudioOnly) ?? [], [selection]);
  const effectiveTrack: Track = track === 'audio' && audioOptions.length > 0 ? 'audio' : videoOptions.length > 0 ? 'video' : 'audio';
  const shownOptions = effectiveTrack === 'audio' ? audioOptions : videoOptions;
  const bestId = shownOptions.find((option) => option.downloadable)?.id ?? null;

  const chooseAudio = useCallback(() => {
    if (audioOptions.length === 0) {
      notYet();
      return;
    }
    setTrack('audio');
  }, [audioOptions.length, notYet]);

  const showInput = phase === 'idle' || phase === 'failed' || phase === 'cancelled';
  const showAnalyzing = isAnalyzeBusy(phase);
  const showPlaybackFallback = phase === 'waiting_for_playback';

  const canPlay = phase === 'ready' && isPlayableOffer(selectedOption) && !creating && !analyzing;
  const subtitle = selection ? resolveDisplayHost(selection) : hostOf(url.trim());

  const footer = (() => {
    if (showAnalyzing) {
      return <DsButton label={progressMessage ?? t('downloads.analyzing')} fullWidth disabled loading testID="quality-selection-analyzing-cta" />;
    }
    if (showInput) {
      return (
        <DsButtonRow>
          <DsButton
            label={t('home.openBrowser')}
            variant="secondary"
            icon="globe"
            flex
            onPress={() => close()}
            accessibilityHint={t('downloads.pasteLinkHint')}
            testID="quality-selection-open-browser"
          />
          <DsButton label={t('downloads.analyzeAction')} icon="search" flex onPress={handleAnalyze} testID="quality-selection-analyze" />
        </DsButtonRow>
      );
    }
    if (phase === 'ready') {
      const showPlay = isPlayableOffer(selectedOption);
      const showChangeLink = !isBrowserQualityHandoff;
      if (!createError && !showPlay && !showChangeLink) {
        return null;
      }
      return (
        <View style={{ gap: 8 }}>
          {createError ? (
            <DsText variant="body" color="primary" accessibilityLiveRegion="polite">
              {createError}
            </DsText>
          ) : null}
          {showPlay || showChangeLink ? (
            <DsButtonRow>
              {showPlay ? (
                <DsButton
                  label={t('downloads.playAction')}
                  variant="secondary"
                  icon="play"
                  flex
                  onPress={() => handlePlay()}
                  loading={playing}
                  disabled={!canPlay}
                  accessibilityLabel={
                    playsChosenQuality(selectedOption)
                      ? t('downloads.playOptionA11y', { label: selectedOption?.label ?? '' })
                      : t('browser.media.playVideoA11y')
                  }
                  accessibilityHint={t('downloads.playHint')}
                  testID="quality-selection-play"
                />
              ) : null}
              {showChangeLink ? (
                <DsButton
                  label={t('downloads.changeLinkAction')}
                  variant="secondary"
                  flex
                  onPress={resetToInput}
                  disabled={creating}
                  testID="quality-selection-change-link"
                />
              ) : null}
            </DsButtonRow>
          ) : null}
        </View>
      );
    }
    if (phase === 'empty') {
      return isBrowserQualityHandoff ? null : (
        <DsButton label={t('downloads.changeLinkAction')} variant="secondary" fullWidth onPress={resetToInput} testID="quality-selection-change-link" />
      );
    }
    if (showPlaybackFallback) {
      return <DsButton label={t('lightVideoSheet.openVideo')} icon="globe" fullWidth onPress={openPendingInBrowser} testID="quality-open-video-footer" />;
    }
    if (phase === 'creating_download' || phase === 'verifying_media') {
      return (
        <DsButton
          label={downloadButtonLabel(selectedOption?.label, selectedOption?.isLive === true)}
          fullWidth
          disabled
          loading
          testID="quality-selection-download"
        />
      );
    }
    return null;
  })();

  useTourBlocker(visible);

  // Unmount when dismissed. This sheet is mounted at the tab-root provider;
  // a leftover Android Dialog would intercept every tab's buttons.
  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root} testID="quality-selection-sheet-root">
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={close}
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <View
            testID="quality-selection-sheet"
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.background,
                borderTopLeftRadius: ds.radius.card,
                borderTopRightRadius: ds.radius.card,
                paddingBottom: Math.max(insets.bottom, 12),
                maxHeight: '92%',
              },
            ]}>
            <View style={[styles.handle, { backgroundColor: theme.colors.switchOff }]} />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 8, gap: ds.space.stack }}>
              <DsHeader
                title={showInput ? t('downloads.qualitySheetTitle') : t('lightVideoSheet.title')}
                subtitle={subtitle ?? t('downloads.qualitySheetSubtitle')}
                action={{
                  icon: 'settings',
                  accessibilityLabel: t('lightVideoSheet.settingsA11y'),
                  onPress: openSettings,
                  testID: 'quality-selection-settings',
                }}
              />

              {showInput ? (
                <>
                  <DsSearchField
                    icon={null}
                    placeholder={t('downloads.urlPlaceholder')}
                    value={url}
                    onChangeText={setUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="go"
                    onSubmitEditing={handleAnalyze}
                    accessibilityLabel={t('downloads.urlLabel')}
                    actions={[
                      { icon: 'clipboard', accessibilityLabel: t('downloads.pasteAction'), onPress: () => void handlePaste(), testID: 'quality-selection-paste' },
                      ...(url ? [{ icon: 'x' as const, accessibilityLabel: t('common.clearInput'), onPress: () => setUrl('') }] : []),
                    ]}
                    testID="quality-selection-url"
                  />
                  <DsText variant="rowSub" color={urlError ? 'primary' : 'textSecondary'} accessibilityLiveRegion="polite">
                    {urlError ?? t('downloads.urlHelper')}
                  </DsText>
                  {phase === 'failed' && errorMessage ? (
                    <View style={{ gap: 8 }} testID="quality-selection-error">
                      <DsText variant="bodyStrong">{t('downloads.qualityErrorTitle')}</DsText>
                      <DsText variant="body">{errorMessage}</DsText>
                      <DsButton label={t('downloads.retryAction')} variant="secondary" icon="refresh-cw" onPress={handleRetry} />
                    </View>
                  ) : null}
                </>
              ) : null}

              {showAnalyzing ? <AnalysisLoadingState phase={phase} platform={platform} message={progressMessage ?? undefined} /> : null}

              {showPlaybackFallback ? (
                <AnalyzeFallbackState
                  title={t('lightVideoSheet.playbackTitle')}
                  description={emptyMessage ?? t('lightVideoSheet.playbackHint')}
                  onOpenVideo={openPendingInBrowser}
                  onRetry={handleRetry}
                />
              ) : null}

              {phase === 'empty' && selection ? (
                <>
                  <MediaResultCard selection={selection} selectedOption={selectedOption} />
                  {selection.options.length > 0 ? (
                    <DsRowGroup>
                      {selection.options.map((option) => (
                        <QualityOptionRow
                          key={option.id}
                          option={option}
                          selected={false}
                          onSelect={selectOption}
                          interactionDisabled={creating}
                          testID={`quality-option-${option.id}`}
                        />
                      ))}
                    </DsRowGroup>
                  ) : null}
                  <View style={{ gap: 4 }} testID="quality-selection-empty">
                    <DsText variant="bodyStrong">{t('downloads.qualityEmptyTitle')}</DsText>
                    {emptyMessage ? <DsText variant="body">{emptyMessage}</DsText> : null}
                  </View>
                </>
              ) : null}

              {phase === 'ready' && selection ? (
                <>
                  <DownloadPreview option={selectedOption} thumbnailUrl={selection.thumbnailUrl} />
                  <DsChipRow testID="quality-selection-tracks">
                    <DsChip label={t('lightVideoSheet.chipVideo')} selected={effectiveTrack === 'video'} onPress={() => setTrack('video')} testID="quality-chip-video" />
                    <DsChip label={t('lightVideoSheet.chipAudio')} selected={effectiveTrack === 'audio'} onPress={chooseAudio} testID="quality-chip-audio" />
                    <DsChip label={t('lightVideoSheet.chipSubtitles')} onPress={notYet} testID="quality-chip-subtitles" />
                  </DsChipRow>
                  {shownOptions.length > 0 ? (
                    <DsRowGroup testID="quality-selection-options">
                      {shownOptions.map((option) => (
                        <QualityOptionRow
                          key={option.id}
                          option={option}
                          selected={selectedId === option.id}
                          best={option.id === bestId}
                          onSelect={handleRowPress}
                          interactionDisabled={creating || playing}
                          onPlay={playsChosenQuality(option) ? handlePlay : undefined}
                          testID={`quality-option-${option.id}`}
                        />
                      ))}
                    </DsRowGroup>
                  ) : null}
                  <DownloadOptionsPanel selection={selection} selectedOption={selectedOption} />
                </>
              ) : null}
            </ScrollView>

            {footer ? (
              <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: 8, paddingBottom: 4 }}>{footer}</View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetWrap: {
    width: '100%',
  },
  sheet: {
    paddingTop: 8,
    width: '100%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
});
