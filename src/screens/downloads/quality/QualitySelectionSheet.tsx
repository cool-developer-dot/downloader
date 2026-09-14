import * as Clipboard from 'expo-clipboard';
import { memo, useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable as RNPressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { TextField } from '@/components/inputs/TextField';
import { isAnalyzeBusy } from '@/downloads/analyze/analyze-state-machine';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { primaryAlphas } from '@/theme';

import { AnalysisLoadingState } from './AnalysisLoadingState';
import { AnalyzeFallbackState } from './AnalyzeFallbackState';
import { downloadButtonLabel } from './constants';
import { MediaResultCard } from './MediaResultCard';
import { QualityOptionRow } from './QualityOptionRow';
import type { UseQualitySelectionResult } from './useQualitySelection';

export type QualitySelectionSheetProps = {
  controller: UseQualitySelectionResult;
};

export const QualitySelectionSheet = memo(function QualitySelectionSheet({
  controller,
}: QualitySelectionSheetProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
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
    openPendingInBrowser,
    flowKind,
    isBrowserHandoffActive,
  } = controller;

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

  const handleDownload = useCallback(() => {
    void confirmDownload();
  }, [confirmDownload]);

  const showInput = phase === 'idle' || phase === 'failed' || phase === 'cancelled';
  const showAnalyzing = isAnalyzeBusy(phase);
  const showPlaybackFallback = phase === 'waiting_for_playback';
  const showFooter =
    showInput ||
    phase === 'ready' ||
    phase === 'empty' ||
    showAnalyzing ||
    showPlaybackFallback ||
    phase === 'creating_download';

  const canDownload =
    phase === 'ready' &&
    selectedOption?.downloadable === true &&
    !creating &&
    !analyzing;

  const footer = (() => {
    if (showAnalyzing) {
      return (
        <Button
          title={progressMessage ?? t('downloads.analyzing')}
          fullWidth
          disabled
          loading
          testID="quality-selection-analyzing-cta"
        />
      );
    }

    if (showInput) {
      return (
        <Button
          title={t('home.openBrowser')}
          onPress={() => {
            close();
          }}
          fullWidth
          leftIcon="web"
          accessibilityHint={t('downloads.pasteLinkHint')}
          testID="quality-selection-open-browser"
        />
      );
    }

    if (phase === 'ready') {
      return (
        <Box gap={8}>
          {createError ? (
            <Text variant="caption" color="error" accessibilityLiveRegion="polite">
              {createError}
            </Text>
          ) : selectedOption ? (
            <Text variant="caption" color="textSecondary" align="center">
              {t('downloads.selectedHint')}: {selectedOption.label}
            </Text>
          ) : null}
          <Button
            title={downloadButtonLabel(selectedOption?.label)}
            onPress={handleDownload}
            loading={creating}
            disabled={!canDownload}
            fullWidth
            leftIcon="download"
            accessibilityLabel={downloadButtonLabel(selectedOption?.label)}
            accessibilityHint={
              canDownload
                ? 'Starts download with the selected format'
                : 'Select a downloadable format first'
            }
            testID="quality-selection-download"
          />
          {isBrowserQualityHandoff ? null : (
            <Button
              title={t('downloads.changeLinkAction')}
              variant="outline"
              onPress={resetToInput}
              disabled={creating}
              fullWidth
              testID="quality-selection-change-link"
            />
          )}
        </Box>
      );
    }

    if (phase === 'empty') {
      return isBrowserQualityHandoff ? null : (
        <Button
          title={t('downloads.changeLinkAction')}
          onPress={resetToInput}
          fullWidth
          variant="outline"
          testID="quality-selection-change-link"
        />
      );
    }

    if (showPlaybackFallback) {
      return (
        <Button
          title="Open Video"
          onPress={openPendingInBrowser}
          fullWidth
          leftIcon="web"
          testID="quality-open-video-footer"
        />
      );
    }

    return null;
  })();

  // Unmount when dismissed. This sheet is mounted at the tab-root provider;
  // a leftover Android Dialog would intercept every tab's buttons.
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent>
      <View style={styles.root} testID="quality-selection-sheet-root">
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={close}
          style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}>
          <View
            testID="quality-selection-sheet"
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.card,
                borderTopLeftRadius: theme.radius.xl,
                borderTopRightRadius: theme.radius.xl,
                paddingBottom: Math.max(insets.bottom, 12) + 12,
                maxHeight: '90%',
                borderTopWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
              },
            ]}>
            <View
              style={[styles.handle, { backgroundColor: theme.colors.textDisabled }]}
            />

            <Box
              row
              px={20}
              pb={12}
              style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box flex={1} gap={6} pr={12}>
                <Box row gap={10} style={{ alignItems: 'center' }}>
                  <Box
                    center
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: primary.strong,
                    }}
                    accessibilityElementsHidden
                    importantForAccessibility="no">
                    <Icon name="link-variant" size={18} color="primary" />
                  </Box>
                  <Text variant="title">
                    {isBrowserQualityHandoff
                      ? t('downloads.qualitiesTitle')
                      : t('downloads.qualitySheetTitle')}
                  </Text>
                </Box>
                <Text variant="bodySmall" color="textSecondary">
                  {isBrowserQualityHandoff
                    ? t('browser.media.chooseQualityHint')
                    : t('downloads.qualitySheetSubtitle')}
                </Text>
              </Box>

              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={t('downloads.closeLabel')}
                testID="quality-selection-close"
                hitSlop={8}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}>
                <Icon name="close" size={20} color="secondary" />
              </Pressable>
            </Box>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: 8,
                gap: 16,
                flexGrow: 1,
              }}>
              {showInput ? (
                <Box gap={16}>
                  <Box
                    gap={12}
                    p={16}
                    borderRadius="md"
                    style={{
                      backgroundColor: theme.colors.surface,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.colors.border,
                    }}>
                    <Box
                      row
                      style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="label" color="textSecondary">
                        {t('downloads.urlLabel')}
                      </Text>
                      <Pressable
                        onPress={() => {
                          void handlePaste();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={t('downloads.pasteAction')}
                        testID="quality-selection-paste"
                        hitSlop={6}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          minHeight: 32,
                          paddingHorizontal: 10,
                          borderRadius: theme.radius.full,
                          backgroundColor: primary.medium,
                        }}>
                        <Icon name="content-paste" size={16} color="primary" />
                        <Text variant="label" color="primary">
                          {t('downloads.pasteAction')}
                        </Text>
                      </Pressable>
                    </Box>

                    <TextField
                      placeholder={t('downloads.urlPlaceholder')}
                      value={url}
                      onChangeText={setUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      returnKeyType="go"
                      onSubmitEditing={handleAnalyze}
                      error={urlError ?? undefined}
                      helperText={urlError ? undefined : t('downloads.urlHelper')}
                      clearable
                      onClear={() => setUrl('')}
                      leftIcon="link"
                      testID="quality-selection-url"
                    />
                  </Box>

                  {phase === 'failed' && errorMessage ? (
                    <ErrorState
                      title={t('downloads.qualityErrorTitle')}
                      message={errorMessage}
                      retryLabel={t('downloads.retryAction')}
                      onRetry={handleRetry}
                      testID="quality-selection-error"
                    />
                  ) : null}
                </Box>
              ) : null}

              {showAnalyzing ? (
                <AnalysisLoadingState
                  phase={phase}
                  platform={platform}
                  message={progressMessage ?? undefined}
                />
              ) : null}

              {showPlaybackFallback ? (
                <AnalyzeFallbackState
                  title="Video needs to be played once"
                  description={
                    emptyMessage ??
                    'Play the video in Browser so VidoraX can detect the media.'
                  }
                  onOpenVideo={openPendingInBrowser}
                  onRetry={handleRetry}
                />
              ) : null}

              {phase === 'empty' && selection ? (
                <Box gap={16}>
                  <MediaResultCard selection={selection} selectedOption={selectedOption} />
                  {selection.options.length > 0 ? (
                    <Box gap={8}>
                      <Text variant="label" color="textSecondary">
                        {t('downloads.qualitiesTitle')}
                      </Text>
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
                    </Box>
                  ) : null}
                  <EmptyState
                    icon="alert-circle-outline"
                    title={t('downloads.qualityEmptyTitle')}
                    description={emptyMessage ?? undefined}
                    testID="quality-selection-empty"
                  />
                </Box>
              ) : null}

              {phase === 'ready' && selection ? (
                <Box gap={16}>
                  <MediaResultCard selection={selection} selectedOption={selectedOption} />

                  {selection.options.length > 1 ? (
                    <Box gap={10}>
                      <Text variant="label" color="textSecondary">
                        {t('downloads.qualitiesTitle')}
                      </Text>
                      <Box
                        gap={10}
                        accessibilityRole="radiogroup"
                        accessibilityLabel={t('downloads.qualitiesTitle')}>
                        {selection.options.map((option) => (
                          <QualityOptionRow
                            key={option.id}
                            option={option}
                            selected={selectedId === option.id}
                            onSelect={selectOption}
                            interactionDisabled={creating}
                            testID={`quality-option-${option.id}`}
                          />
                        ))}
                      </Box>
                    </Box>
                  ) : null}
                </Box>
              ) : null}
            </ScrollView>

            {showFooter && footer ? (
              <Box
                px={20}
                pt={12}
                style={{
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}>
                {footer}
              </Box>
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
    marginBottom: 12,
  },
});
