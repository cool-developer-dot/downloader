import { memo, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { Switch } from '@/components/inputs/Switch';
import { MAX_SNIPPETS, parseSnippets, serializeSnippets } from '@/browser/form-snippets/form-snippets';
import { parseNeverSites, serializeNeverSites } from '@/browser/open-in-app/open-in-app';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';

/** B22 — Browser settings → Share, QR and forms: Open in app (#273), Form snippets (#274), Notes (#252). */
export const ShareSettingsSection = memo(function ShareSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const openInApp = useSettingsStore((s) => s.openInAppPrompt !== false);
  const never = parseNeverSites(useSettingsStore((s) => s.openInAppNever));
  const snippets = parseSnippets(useSettingsStore((s) => s.formSnippets));
  const [sheet, setSheet] = useState<'never' | 'snippets' | null>(null);

  return (
    <SettingsSection testID="browser-settings-share" title={t('browserShare.section')} icon="share-variant-outline">
      <SettingsRow
        title={t('browserShare.notes')}
        icon="note-text-outline"
        onPress={() => navigation.push(routePaths.notes)}
        accessibilityHint={t('browserShare.notesA11y')}
        testID="browser-settings-notes"
      />
      <SettingsRow
        title={t('browserShare.openInAppSetting')}
        description={t('browserShare.openInAppSettingHint')}
        icon="open-in-app"
        trailing={
          <Switch
            value={openInApp}
            onValueChange={(next) => update('openInAppPrompt', next)}
            accessibilityLabel={t('browserShare.openInAppSetting')}
            accessibilityHint={t('browserShare.openInAppSettingHint')}
            testID="browser-settings-open-in-app"
          />
        }
      />
      <SettingsRow
        title={t('browserShare.openInAppNeverSites')}
        icon="cancel"
        value={String(never.length)}
        onPress={() => setSheet('never')}
        testID="browser-settings-open-in-app-never"
      />
      <SettingsRow
        title={t('browserShare.snippets')}
        description={t('browserShare.snippetsHint')}
        icon="form-textbox"
        value={String(snippets.length)}
        onPress={() => setSheet('snippets')}
        showDivider={false}
        testID="browser-settings-snippets"
      />
      <TextListSheet
        visible={sheet === 'never'}
        title={t('browserShare.openInAppNeverSites')}
        empty={t('browserShare.openInAppNeverEmpty')}
        items={never}
        onRemove={(site) => update('openInAppNever', serializeNeverSites(never.filter((s) => s !== site)))}
        onClose={() => setSheet(null)}
        testID="open-in-app-never-sheet"
      />
      <TextListSheet
        visible={sheet === 'snippets'}
        title={t('browserShare.snippets')}
        empty={t('browserShare.snippetsEmpty')}
        items={snippets}
        onRemove={(text) => update('formSnippets', serializeSnippets(snippets.filter((s) => s !== text)))}
        onAdd={(text) => update('formSnippets', serializeSnippets([...snippets, text]))}
        full={snippets.length >= MAX_SNIPPETS}
        onClose={() => setSheet(null)}
        testID="form-snippets-sheet"
      />
    </SettingsSection>
  );
});

const TextListSheet = memo(function TextListSheet({
  visible,
  title,
  empty,
  items,
  onRemove,
  onAdd,
  full = false,
  onClose,
  testID,
}: {
  visible: boolean;
  title: string;
  empty: string;
  items: readonly string[];
  onRemove: (item: string) => void;
  onAdd?: (item: string) => void;
  full?: boolean;
  onClose: () => void;
  testID: string;
}) {
  const { t, rtl } = useTranslation();
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!onAdd || !draft.trim() || full) return;
    onAdd(draft);
    setDraft('');
  };
  return (
    <SheetFrame
      visible={visible}
      title={title}
      onClose={onClose}
      testID={testID}
      footer={
        onAdd ? (
          <View style={{ gap: 8 }}>
            {full ? (
              <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
                {t('browserShare.snippetsFull')}
              </Text>
            ) : null}
            <View style={{ flexDirection: rtl.rowDirection, gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t('browserShare.snippetField')}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={500}
                  testID={`${testID}-field`}
                />
              </View>
              <Button title={t('browserShare.snippetAdd')} onPress={add} disabled={full} testID={`${testID}-add`} />
            </View>
          </View>
        ) : undefined
      }>
      {items.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {empty}
        </Text>
      ) : (
        <View>
          {items.map((item) => (
            <View key={item} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 8 }}>
              <Text variant="body" numberOfLines={2} style={{ flex: 1, textAlign: rtl.textAlign }}>
                {item}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserShare.snippetRemoveA11y', { text: item })}
                onPress={() => onRemove(item)}
                style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={20} color="secondary" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </SheetFrame>
  );
});
