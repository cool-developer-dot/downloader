import { memo, useCallback, useState } from 'react';

import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { TextField } from '@/components/inputs/TextField';
import { EMPTY_LINK_RULES, isValidRulePattern, parseRuleList, type LinkRules } from '@/downloads/bulk/link-rules';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';
import { useSettingsTokens } from '@/screens/settings/theme/settings-tokens';
import { useSettingsStore } from '@/store/settings';

type Draft = {
  includeExtensions: string;
  excludeExtensions: string;
  includeKeywords: string;
  excludeKeywords: string;
  includePattern: string;
  excludePattern: string;
  minSizeMb: string;
  maxSizeMb: string;
};

function draftOf(rules: LinkRules): Draft {
  return {
    includeExtensions: rules.includeExtensions.join(', '),
    excludeExtensions: rules.excludeExtensions.join(', '),
    includeKeywords: rules.includeKeywords.join(', '),
    excludeKeywords: rules.excludeKeywords.join(', '),
    includePattern: rules.includePattern,
    excludePattern: rules.excludePattern,
    minSizeMb: rules.minSizeMb ? String(rules.minSizeMb) : '',
    maxSizeMb: rules.maxSizeMb ? String(rules.maxSizeMb) : '',
  };
}

function rulesOf(draft: Draft): LinkRules {
  const size = (text: string) => {
    const value = Number(text.trim());
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  };
  return {
    includeExtensions: parseRuleList(draft.includeExtensions),
    excludeExtensions: parseRuleList(draft.excludeExtensions),
    includeKeywords: draft.includeKeywords.split(',').map((w) => w.trim()).filter(Boolean),
    excludeKeywords: draft.excludeKeywords.split(',').map((w) => w.trim()).filter(Boolean),
    includePattern: draft.includePattern.trim(),
    excludePattern: draft.excludePattern.trim(),
    minSizeMb: size(draft.minSizeMb),
    maxSizeMb: size(draft.maxSizeMb),
  };
}

/**
 * #505 Include/Exclude Rules: which links bulk adding takes (Batch Add, patterns, playlists, feeds and the site
 * grabber). Saved as you type; an empty field allows everything, an invalid pattern is ignored (and says so).
 */
export const DownloadRulesScreen = memo(function DownloadRulesScreen() {
  const { t } = useTranslation();
  const settingsTokens = useSettingsTokens();
  const [draft, setDraft] = useState<Draft>(() => draftOf(useSettingsStore.getState().linkRules));
  const goBack = useCallback(() => navigation.back(), []);

  const change = useCallback((key: keyof Draft, value: string) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      useSettingsStore.getState().updateSetting('linkRules', rulesOf(next));
      return next;
    });
  }, []);
  const clear = useCallback(() => {
    setDraft(draftOf(EMPTY_LINK_RULES));
    useSettingsStore.getState().updateSetting('linkRules', { ...EMPTY_LINK_RULES });
  }, []);

  const field = (key: keyof Draft, label: string, helper: string, numeric = false) => (
    <TextField
      label={label}
      value={draft[key]}
      onChangeText={(value) => change(key, value)}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={numeric ? 'number-pad' : 'default'}
      helperText={helper}
      error={
        (key === 'includePattern' || key === 'excludePattern') && !isValidRulePattern(draft[key]) ? t('bulkAdd.patternInvalid') : undefined
      }
      testID={`download-rules-${key}`}
    />
  );

  return (
    <SafeAreaScreen
      testID="download-rules-screen"
      scrollable
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: settingsTokens.spacing.screenX, paddingBottom: 40, gap: 16 }}>
      <ScreenHeader title={t('bulkAdd.rulesTitle')} showBack onBackPress={goBack} testID="download-rules-header" />
      <Text variant="bodySmall" color="textSecondary">
        {t('bulkAdd.rulesHint')}
      </Text>
      {field('includeExtensions', t('bulkAdd.includeTypes'), t('bulkAdd.includeTypesHint'))}
      {field('excludeExtensions', t('bulkAdd.excludeTypes'), t('bulkAdd.includeTypesHint'))}
      {field('includeKeywords', t('bulkAdd.includeWords'), t('bulkAdd.wordsHint'))}
      {field('excludeKeywords', t('bulkAdd.excludeWords'), t('bulkAdd.wordsHint'))}
      {field('includePattern', t('bulkAdd.includePattern'), t('bulkAdd.patternFieldHint'))}
      {field('excludePattern', t('bulkAdd.excludePattern'), t('bulkAdd.patternFieldHint'))}
      {field('minSizeMb', t('bulkAdd.minSize'), t('bulkAdd.sizeHint'), true)}
      {field('maxSizeMb', t('bulkAdd.maxSize'), t('bulkAdd.sizeHint'), true)}
      <Button title={t('bulkAdd.clearRules')} variant="outline" size="small" leftIcon="filter-remove-outline" onPress={clear} testID="download-rules-clear" />
    </SafeAreaScreen>
  );
});
