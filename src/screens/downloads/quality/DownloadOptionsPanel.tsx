import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ToastAndroid, View } from 'react-native';

import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { directMediaFileTitle } from '@/browser/media-actions/download-title';
import { DsChip, DsChipRow, DsRow, DsRowGroup, DsSearchField, DsText, ds } from '@/design';
import { resolveDisplayTitle, type AnalyzedMediaSelection, type DownloadQualityOption } from '@/downloads/quality';
import type { GalleryChoice, WifiChoice } from '@/downloads/v2/download-options';
import {
  followSelectedQuality,
  updateDownloadOptionsDraft,
  useDownloadOptionsDraft,
} from '@/downloads/v2/download-options-store';
import { applyFilenameTemplate, MAX_NAME_LENGTH, sanitizeFileName } from '@/downloads/v2/filename-template';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { useFoldersStore } from '@/store/organization/folders';
import { selectFilenameTemplate, useSettingsStore } from '@/store/settings';

const GALLERY_CHOICES: { value: GalleryChoice; label: TranslationKey }[] = [
  { value: 'default', label: 'downloadOptions.galleryDefault' },
  { value: 'on', label: 'downloadOptions.galleryOn' },
  { value: 'off', label: 'downloadOptions.galleryOff' },
];

const WIFI_CHOICES: { value: WifiChoice; label: TranslationKey }[] = [
  { value: 'default', label: 'downloadOptions.wifiOnlyDefault' },
  { value: 'on', label: 'downloadOptions.wifiOnlyOn' },
  { value: 'off', label: 'downloadOptions.wifiOnlyOff' },
];

/**
 * Quality sheet → the design's second card (design 33): Rename (#296), Save to (#155) and the Trim · Subtitle ·
 * Metadata toggle, which opens the rest of the options (H8: per-download Save to Gallery and Wi-Fi only, #480).
 * The controls are live for a browser offer (the v2 handoff applies the draft); for a pasted link, which has no
 * draft today, the rows show the values and say "Not available yet". Left alone, nothing changes.
 */
export const DownloadOptionsPanel = memo(function DownloadOptionsPanel({
  selection,
  selectedOption,
}: {
  selection: AnalyzedMediaSelection;
  selectedOption: DownloadQualityOption | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const template = useSettingsStore(selectFilenameTemplate);
  const draft = useDownloadOptionsDraft((state) => state.draft);
  const folderIds = useFoldersStore((state) => state.orderedIds);
  const foldersById = useFoldersStore((state) => state.itemsById);
  const identity = selectedOption?.sourceUrl ?? null;
  const browserOffer = browserMediaActionService.isSelectionLocked();
  const live = Boolean(identity) && browserOffer;

  // The name the File naming template gives this video, cleaned the same way — from the title the download gets
  // (a video file opened directly is named by its file, as the handoff does).
  const prefill = useMemo(
    () =>
      sanitizeFileName(
        applyFilenameTemplate({
          template,
          title: directMediaFileTitle(browserMediaActionService.getState().pageUrl) ?? resolveDisplayTitle(selection) ?? '',
          pageUrl: browserMediaActionService.getState().pageUrl,
          site: null,
          qualityLabel: selectedOption?.label ?? null,
          now: new Date(),
        }),
      ),
    [selection, selectedOption?.label, template],
  );

  // Another quality picked after setting options: they follow it.
  useEffect(() => {
    if (identity) {
      followSelectedQuality(identity);
    }
  }, [identity]);

  const notYet = useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);

  const current = draft && identity && draft.identity === identity ? draft : null;
  const name = current?.titleEdited ? current.title : prefill;
  const folderId = current?.folderId ?? null;
  const folderLabel = (folderId && foldersById[folderId]?.name) || t('downloadOptions.unfiled');
  const changed = current ? Boolean(current.titleEdited || current.folderId || (current.saveToGallery ?? 'default') !== 'default' || (current.wifiOnly ?? 'default') !== 'default') : false;

  const onRename = useCallback(() => {
    if (!live) {
      notYet();
      return;
    }
    setEditingName((open) => !open);
  }, [live, notYet]);

  const onSaveTo = useCallback(() => {
    if (!live) {
      notYet();
      return;
    }
    setChoosingFolder((open) => !open);
  }, [live, notYet]);

  const onToggle = useCallback(
    (value: boolean) => {
      if (!live) {
        notYet();
        return;
      }
      setExpanded(value);
    },
    [live, notYet],
  );

  return (
    <DsRowGroup testID="quality-download-options">
      <DsRow
        icon="pencil"
        title={t('lightVideoSheet.rename')}
        subtitle={name}
        onPress={onRename}
        accessibilityHint={t('lightVideoSheet.renameHint')}
        testID="quality-download-options-rename"
      />
      {editingName && live && identity ? (
        <View style={{ padding: ds.space.cardPad, gap: 6 }}>
          <DsSearchField
            icon={null}
            value={name}
            onChangeText={(text) => updateDownloadOptionsDraft({ identity, title: text, titleEdited: true })}
            maxLength={MAX_NAME_LENGTH}
            placeholder={prefill}
            accessibilityLabel={t('downloadOptions.name')}
            testID="quality-download-options-name"
          />
          <DsText variant="rowSub">{t('downloadOptions.nameHint')}</DsText>
        </View>
      ) : null}
      <DsRow
        icon="folder"
        title={t('lightVideoSheet.saveTo')}
        subtitle={folderLabel}
        onPress={onSaveTo}
        accessibilityHint={t('lightVideoSheet.saveToHint')}
        testID="quality-download-options-folder"
      />
      {choosingFolder && live && identity ? (
        <View style={{ padding: ds.space.cardPad }}>
          <DsChipRow scroll={false}>
            <DsChip
              label={t('downloadOptions.unfiled')}
              selected={folderId == null}
              onPress={() => updateDownloadOptionsDraft({ identity, folderId: null })}
              testID="quality-download-options-folder-unfiled"
            />
            {folderIds.map((id) => {
              const folder = foldersById[id];
              return folder ? (
                <DsChip
                  key={id}
                  label={folder.name}
                  selected={folderId === id}
                  onPress={() => updateDownloadOptionsDraft({ identity, folderId: id })}
                  testID={`quality-download-options-folder-${id}`}
                />
              ) : null;
            })}
          </DsChipRow>
        </View>
      ) : null}
      <DsRow
        icon="scissors"
        title={t('lightVideoSheet.trim')}
        subtitle={changed ? t('downloadOptions.changed') : undefined}
        toggle={{ value: expanded && live, onValueChange: onToggle, accessibilityLabel: t('lightVideoSheet.trim') }}
        accessibilityHint={t('lightVideoSheet.trimHint')}
        testID="quality-download-options-toggle"
      />
      {expanded && live && identity ? (
        <View style={{ padding: ds.space.cardPad, gap: 12 }}>
          <View style={{ gap: 6 }}>
            <DsText variant="rowSub">{t('downloadOptions.gallery')}</DsText>
            <DsChipRow scroll={false}>
              {GALLERY_CHOICES.map((choice) => (
                <DsChip
                  key={choice.value}
                  label={t(choice.label)}
                  selected={(current?.saveToGallery ?? 'default') === choice.value}
                  onPress={() => updateDownloadOptionsDraft({ identity, saveToGallery: choice.value })}
                  testID={`quality-download-options-gallery-${choice.value}`}
                />
              ))}
            </DsChipRow>
          </View>
          <View style={{ gap: 6 }}>
            <DsText variant="rowSub">{t('downloadOptions.wifiOnly')}</DsText>
            <DsChipRow scroll={false}>
              {WIFI_CHOICES.map((choice) => (
                <DsChip
                  key={choice.value}
                  label={t(choice.label)}
                  selected={(current?.wifiOnly ?? 'default') === choice.value}
                  onPress={() => updateDownloadOptionsDraft({ identity, wifiOnly: choice.value })}
                  testID={`quality-download-options-wifi-${choice.value}`}
                />
              ))}
            </DsChipRow>
          </View>
        </View>
      ) : null}
    </DsRowGroup>
  );
});
