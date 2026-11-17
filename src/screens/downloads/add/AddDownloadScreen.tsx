import * as Clipboard from 'expo-clipboard';
import { memo, useCallback, useMemo, useState } from 'react';
import { ToastAndroid } from 'react-native';

import { DsButton, DsButtonRow, DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSearchField } from '@/design';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { useSubtitleSettingsStore } from '@/downloads/v2/subtitle-store';
import { useTranslation } from '@/localization';
import { formatFileSize } from '@/media-detection/utils';
import { navigation, routePaths } from '@/navigation';
import { BatchAddBody, batchAddPrefill, useBatchAdd } from '@/screens/batch-add';
import { useQualitySelectionContext } from '@/screens/downloads/quality';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { selectConfirmBeforeStart, selectFilenameTemplate, useSettingsStore } from '@/store/settings';

import { announce, pickSaveLocation, saveLocationLabel, scanLinkFromQr } from './add-download-actions';
import { FilenameTemplateSheet } from './FilenameTemplateSheet';

type AddMode = 'link' | 'batch' | 'torrent';
type QualityChoice = 'ask' | 'best';

/** The Batch chip: the Batch Add editor (#292) with its own run, mounted only while the chip is selected. */
const BatchSection = memo(function BatchSection() {
  const batch = useBatchAdd();
  return <BatchAddBody batch={batch} testID="add-download-batch" />;
});

/**
 * Design 11 "Downloads · Add": one link (checked and offered in the Video sheet, as the old Paste link did), the
 * Batch editor, Torrent / Magnet (no torrent engine yet) and the Playlist screen, over the download settings the
 * design lists — each row is the existing setting or control behind it.
 */
export const AddDownloadScreen = memo(function AddDownloadScreen() {
  const { t } = useTranslation();
  const quality = useQualitySelectionContext();
  const confirmBeforeStart = useSettingsStore(selectConfirmBeforeStart);
  const template = useSettingsStore(selectFilenameTemplate);
  const subtitles = useSubtitleSettingsStore((state) => state.enabled);
  const saveEnabled = useSaveLocationStore((state) => state.enabled);
  const saveFolder = useSaveLocationStore((state) => state.folderName);

  const [link, setLink] = useState('');
  const [mode, setMode] = useState<AddMode>('link');
  const [qualitySheet, setQualitySheet] = useState(false);
  const [templateSheet, setTemplateSheet] = useState(false);

  const notYet = useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);

  const goBack = useCallback(() => navigation.back(), []);
  const openSettings = useCallback(() => navigation.push(routePaths.downloadSettings), []);

  // The same path the Paste link button used: the quality selection context checks the link and shows the sheet.
  const submit = useCallback(() => {
    if (mode === 'torrent') {
      notYet();
      return;
    }
    const trimmed = link.trim();
    if (!trimmed) {
      announce(t('lightAddDownload.missingLink'));
      return;
    }
    void quality.openWithUrl(trimmed);
  }, [link, mode, notYet, quality, t]);

  const paste = useCallback(async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (text) {
        setLink(text);
      } else {
        announce(t('lightAddDownload.clipboardEmpty'));
      }
    } catch {
      announce(t('lightAddDownload.clipboardEmpty'));
    }
  }, [t]);

  const scan = useCallback(async () => {
    const text = await scanLinkFromQr();
    if (text) {
      setLink(text);
    }
  }, []);

  const openPlaylist = useCallback(() => {
    if (link.trim()) {
      batchAddPrefill.set(link.trim());
    }
    navigation.push(routePaths.downloadsPlaylist);
  }, [link]);

  const chooseTorrent = useCallback(() => {
    setMode('torrent');
    notYet();
  }, [notYet]);

  const qualityOptions = useMemo<ChoiceOption<QualityChoice>[]>(
    () => [
      { value: 'ask', label: t('lightAddDownload.qualityAsk'), description: t('lightAddDownload.qualityAskHint') },
      { value: 'best', label: t('lightAddDownload.qualityBest'), description: t('lightAddDownload.qualityBestHint') },
    ],
    [t],
  );
  const chooseQuality = useCallback((value: QualityChoice) => {
    useSettingsStore.getState().updateSetting('confirmBeforeStart', value === 'ask');
  }, []);

  const chooseFolder = useCallback(async () => {
    const result = await pickSaveLocation();
    if (result === 'unavailable') {
      notYet();
    } else if (result === 'failed') {
      announce(t('lightAddDownload.saveLocationFailed'));
    }
  }, [notYet, t]);

  const setSubtitles = useCallback((value: boolean) => {
    useSubtitleSettingsStore.getState().setEnabled(value);
  }, []);

  // "~ 23.5 MB" once this link was checked: the size of the quality the sheet selected for it.
  const estimate = useMemo(() => {
    const trimmed = link.trim();
    if (!trimmed || quality.url.trim() !== trimmed) {
      return null;
    }
    const option = quality.selectedOption;
    const bytes = option?.estimatedFileSize ?? (option?.fileSize ? Number(option.fileSize) : null);
    return formatFileSize(bytes);
  }, [link, quality.selectedOption, quality.url]);

  const folderLabel = saveLocationLabel({ enabled: saveEnabled, folderName: saveFolder }, t('lightAddDownload.saveLocationDefault'));

  return (
    <DsScreen testID="add-download-screen">
      <DsHeader
        title={t('lightAddDownload.title')}
        subtitle={t('lightAddDownload.subtitle')}
        onBack={goBack}
        action={{ icon: 'settings', accessibilityLabel: t('lightAddDownload.settingsA11y'), onPress: openSettings, testID: 'add-download-settings' }}
        testID="add-download-header"
      />
      {mode === 'batch' ? null : (
        <>
          <DsSearchField
            icon={null}
            value={link}
            onChangeText={setLink}
            placeholder={t('lightAddDownload.linkPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
            accessibilityLabel={t('lightAddDownload.linkA11y')}
            actions={link ? [{ icon: 'x', accessibilityLabel: t('common.clearInput'), onPress: () => setLink('') }] : undefined}
            testID="add-download-link"
          />
          <DsButtonRow>
            <DsButton
              label={t('lightAddDownload.paste')}
              icon="clipboard"
              flex
              onPress={() => void paste()}
              accessibilityHint={t('lightAddDownload.pasteHint')}
              testID="add-download-paste"
            />
            <DsButton
              label={t('lightAddDownload.scanQr')}
              variant="secondary"
              icon="qr-code"
              flex
              onPress={() => void scan()}
              accessibilityHint={t('lightAddDownload.scanQrHint')}
              testID="add-download-scan"
            />
          </DsButtonRow>
        </>
      )}
      <DsChipRow testID="add-download-chips">
        <DsChip label={t('lightAddDownload.chipLink')} selected={mode === 'link'} onPress={() => setMode('link')} testID="add-download-chip-link" />
        <DsChip label={t('lightAddDownload.chipBatch')} selected={mode === 'batch'} onPress={() => setMode('batch')} testID="add-download-chip-batch" />
        <DsChip label={t('lightAddDownload.chipTorrent')} selected={mode === 'torrent'} onPress={chooseTorrent} testID="add-download-chip-torrent" />
        <DsChip label={t('lightAddDownload.chipPlaylist')} onPress={openPlaylist} testID="add-download-chip-playlist" />
      </DsChipRow>
      {mode === 'batch' ? (
        <BatchSection />
      ) : (
        <DsRowGroup testID="add-download-rows">
          <DsRow
            icon="film"
            title={t('lightAddDownload.quality')}
            subtitle={confirmBeforeStart ? t('lightAddDownload.qualityAsk') : t('lightAddDownload.qualityBest')}
            onPress={() => setQualitySheet(true)}
            testID="add-download-quality"
          />
          <DsRow
            icon="pencil"
            title={t('lightAddDownload.rename')}
            subtitle={t('lightAddDownload.renameTemplate', { template })}
            onPress={() => setTemplateSheet(true)}
            testID="add-download-rename"
          />
          <DsRow
            icon="folder"
            title={t('lightAddDownload.saveLocation')}
            subtitle={folderLabel}
            onPress={() => void chooseFolder()}
            accessibilityHint={t('lightAddDownload.saveLocationHint')}
            testID="add-download-save-location"
          />
          <DsRow icon="lock" title={t('lightAddDownload.auth')} onPress={notYet} testID="add-download-auth" />
          <DsRow
            icon="eye"
            title={t('lightAddDownload.preview')}
            onPress={submit}
            accessibilityHint={t('lightAddDownload.previewHint')}
            testID="add-download-preview"
          />
          <DsRow
            icon="scissors"
            title={t('lightAddDownload.trim')}
            toggle={{ value: subtitles, onValueChange: setSubtitles, accessibilityLabel: t('lightAddDownload.trim') }}
            testID="add-download-trim"
          />
          <DsRow
            icon="file-text"
            title={t('lightAddDownload.dataEstimate')}
            subtitle={estimate ? t('lightAddDownload.estimateValue', { size: estimate }) : '—'}
            onPress={submit}
            testID="add-download-estimate"
          />
        </DsRowGroup>
      )}
      <ChoiceSheet<QualityChoice>
        visible={qualitySheet}
        title={t('lightAddDownload.quality')}
        options={qualityOptions}
        value={confirmBeforeStart ? 'ask' : 'best'}
        onSelect={chooseQuality}
        onClose={() => setQualitySheet(false)}
        testID="add-download-quality-choice"
      />
      <FilenameTemplateSheet visible={templateSheet} onClose={() => setTemplateSheet(false)} />
    </DsScreen>
  );
});
