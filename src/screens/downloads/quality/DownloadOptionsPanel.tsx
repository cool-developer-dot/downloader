import { memo, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Chip } from '@/components/common/Chip';
import { TextField } from '@/components/inputs/TextField';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { resolveDisplayTitle, type AnalyzedMediaSelection, type DownloadQualityOption } from '@/downloads/quality';
import { hasChangedOptions, type GalleryChoice } from '@/downloads/v2/download-options';
import { updateDownloadOptionsDraft, useDownloadOptionsDraft } from '@/downloads/v2/download-options-store';
import { applyFilenameTemplate, MAX_NAME_LENGTH, sanitizeFileName } from '@/downloads/v2/filename-template';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { useFoldersStore } from '@/store/organization/folders';
import { selectFilenameTemplate, useSettingsStore } from '@/store/settings';

const GALLERY_CHOICES: { value: GalleryChoice; label: TranslationKey }[] = [
  { value: 'default', label: 'downloadOptions.galleryDefault' },
  { value: 'on', label: 'downloadOptions.galleryOn' },
  { value: 'off', label: 'downloadOptions.galleryOff' },
];

/**
 * Quality sheet → "Options" (H8), collapsed until tapped. Shown only for a browser offer (the v2 handoff applies it).
 * Name (#296), library folder (#155) and per-download Save to Gallery (#480). Left alone, nothing changes.
 */
export const DownloadOptionsPanel = memo(function DownloadOptionsPanel({
  selection,
  selectedOption,
}: {
  selection: AnalyzedMediaSelection;
  selectedOption: DownloadQualityOption | null;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const template = useSettingsStore(selectFilenameTemplate);
  const draft = useDownloadOptionsDraft((state) => state.draft);
  const folderIds = useFoldersStore((state) => state.orderedIds);
  const foldersById = useFoldersStore((state) => state.itemsById);
  const identity = selectedOption?.sourceUrl ?? null;
  const browserOffer = browserMediaActionService.isSelectionLocked();

  // The name the File naming template gives this video, cleaned the same way.
  const prefill = useMemo(
    () =>
      sanitizeFileName(
        applyFilenameTemplate({
          template,
          title: resolveDisplayTitle(selection) ?? '',
          pageUrl: browserMediaActionService.getState().pageUrl,
          site: null,
          qualityLabel: selectedOption?.label ?? null,
          now: new Date(),
        }),
      ),
    [selection, selectedOption?.label, template],
  );

  if (!identity || !browserOffer) {
    return null;
  }

  const current = draft && draft.identity === identity ? draft : null;
  const name = current?.titleEdited ? current.title : prefill;
  const changed = hasChangedOptions(current);

  return (
    <Box gap={10}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t('downloadOptions.title')}
        accessibilityHint={t('downloadOptions.hint')}
        testID="quality-download-options-toggle"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
        <Icon name="tune-variant" size="sm" color="secondary" />
        <Box flex={1}>
          <Text variant="bodySmall">{t('downloadOptions.title')}</Text>
          {changed ? (
            <Text variant="caption" color="primary">
              {t('downloadOptions.changed')}
            </Text>
          ) : null}
        </Box>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" color="secondary" />
      </Pressable>

      {expanded ? (
        <Box gap={12} pb={4} style={{ borderTopWidth: 1, borderTopColor: theme.colors.divider, paddingTop: 10 }}>
          <TextField
            label={t('downloadOptions.name')}
            value={name}
            onChangeText={(text) => updateDownloadOptionsDraft({ identity, title: text, titleEdited: true })}
            maxLength={MAX_NAME_LENGTH}
            helperText={t('downloadOptions.nameHint')}
            testID="quality-download-options-name"
          />

          <Box gap={6}>
            <Text variant="caption" color="textSecondary">
              {t('downloadOptions.folder')}
            </Text>
            <Box row gap={6} style={{ flexWrap: 'wrap' }}>
              <Chip
                label={t('downloadOptions.unfiled')}
                selected={(current?.folderId ?? null) == null}
                onPress={() => updateDownloadOptionsDraft({ identity, folderId: null })}
                testID="quality-download-options-folder-unfiled"
              />
              {folderIds.map((id) => {
                const folder = foldersById[id];
                return folder ? (
                  <Chip
                    key={id}
                    label={folder.name}
                    selected={current?.folderId === id}
                    onPress={() => updateDownloadOptionsDraft({ identity, folderId: id })}
                    testID={`quality-download-options-folder-${id}`}
                  />
                ) : null;
              })}
            </Box>
          </Box>

          <Box gap={6}>
            <Text variant="caption" color="textSecondary">
              {t('downloadOptions.gallery')}
            </Text>
            <Box row gap={6} style={{ flexWrap: 'wrap' }}>
              {GALLERY_CHOICES.map((choice) => (
                <Chip
                  key={choice.value}
                  label={t(choice.label)}
                  selected={(current?.saveToGallery ?? 'default') === choice.value}
                  onPress={() => updateDownloadOptionsDraft({ identity, saveToGallery: choice.value })}
                  testID={`quality-download-options-gallery-${choice.value}`}
                />
              ))}
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
});
