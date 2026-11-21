import { memo, useCallback, useMemo, useState } from 'react';

import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { DUPLICATE_ACTIONS, type DuplicateAction } from '@/downloads/v2/duplicate-action';
import { useDuplicateActionStore } from '@/downloads/v2/duplicate-action-store';
import { useSaveLocationStore } from '@/downloads/v2/save-location-store';
import { DOWNLOAD_RULES_ROUTE } from '@/screens/download-rules/route';
import { navigation } from '@/navigation';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import { selectFilenameTemplate, useSettingsStore } from '@/store/settings';

import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { FilenameTemplateModal } from './FilenameTemplateModal';

const DUPLICATE_LABELS: Record<DuplicateAction, TranslationKey> = {
  skip: 'duplicates.skip',
  ask: 'duplicates.ask',
  keep_both: 'duplicates.keepBoth',
  replace: 'duplicates.replace',
};

const DUPLICATE_HINTS: Record<DuplicateAction, TranslationKey> = {
  skip: 'duplicates.skipHint',
  ask: 'duplicates.askHint',
  keep_both: 'duplicates.keepBothHint',
  replace: 'duplicates.replaceSettingHint',
};

/**
 * Design 42 "Organize": the save-location copy's folder layout (Auto categorize / Per-type = #382 #383 `byType`,
 * Per-site = #384 `bySite`), the filename template (H10), the duplicate action (H12), and the rows whose feature
 * does not exist yet (Size filter, Tags, Custom extension · Urdu filenames).
 */
export const OrganizeScreen = memo(function OrganizeScreen() {
  const { t } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const byType = useSaveLocationStore((s) => s.byType);
  const bySite = useSaveLocationStore((s) => s.bySite);
  const template = useSettingsStore(selectFilenameTemplate);
  const duplicateAction = useDuplicateActionStore((s) => s.action);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const setByType = useCallback((value: boolean) => {
    useSaveLocationStore.getState().dispatch({ type: 'set-by-type', value });
  }, []);
  const setBySite = useCallback((value: boolean) => {
    useSaveLocationStore.getState().dispatch({ type: 'set-by-site', value });
  }, []);

  const duplicateOptions = useMemo(
    () =>
      DUPLICATE_ACTIONS.map((value) => ({
        value,
        label: t(DUPLICATE_LABELS[value]),
        description: t(DUPLICATE_HINTS[value]),
      })),
    [t],
  );

  return (
    <DsScreen testID="organize-screen">
      <DsHeader title={t('lightOrganize.title')} subtitle={t('lightOrganize.subtitle')} action={settingsAction} />
      <DsRowGroup testID="organize-rows">
        <DsRow
          icon="folder"
          title={t('lightOrganize.autoCategorize')}
          toggle={{ value: byType, onValueChange: setByType }}
          testID="organize-auto-categorize"
        />
        <DsRow
          icon="folder"
          title={t('lightOrganize.perTypeFolder')}
          subtitle={t('lightOrganize.perTypeFolderHint')}
          toggle={{ value: byType, onValueChange: setByType }}
          testID="organize-per-type"
        />
        <DsRow
          icon="globe"
          title={t('lightOrganize.perSiteFolder')}
          toggle={{ value: bySite, onValueChange: setBySite }}
          testID="organize-per-site"
        />
        <DsRow
          icon="tag"
          title={t('downloadNaming.template')}
          subtitle={template}
          onPress={() => setTemplateOpen(true)}
          testID="organize-template"
        />
        <DsRow
          icon="layers"
          title={t('lightOrganize.duplicateAction')}
          subtitle={t(DUPLICATE_LABELS[duplicateAction])}
          onPress={() => setDuplicateOpen(true)}
          testID="organize-duplicate"
        />
        <DsRow
          icon="sliders-vertical"
          title={t('lightOrganize.sizeFilter')}
          subtitle={t('lightDownloadSettings.rulesSub')}
          onPress={() => navigation.push(DOWNLOAD_RULES_ROUTE)}
          testID="organize-size-filter"
        />
        <DsRow icon="tag" title={t('organize.tags')} onPress={notYet} testID="organize-tags" />
        <DsRow
          icon="type"
          title={t('lightOrganize.customExtensionUrdu')}
          toggle={{ value: false, onValueChange: notYet }}
          testID="organize-urdu-filenames"
        />
      </DsRowGroup>

      <FilenameTemplateModal visible={templateOpen} onClose={() => setTemplateOpen(false)} />
      <ChoiceSheet
        visible={duplicateOpen}
        title={t('lightOrganize.duplicateAction')}
        options={duplicateOptions}
        value={duplicateAction}
        onSelect={(value) => useDuplicateActionStore.getState().setAction(value)}
        onClose={() => setDuplicateOpen(false)}
        testID="organize-duplicate-sheet"
      />
    </DsScreen>
  );
});
