import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { useTheme } from '@/hooks/use-theme';
import { allTags, MAX_TAG_LENGTH, MAX_TAGS_PER_ITEM, tagProblem, type TagProblem } from '@/library/item-organize';
import { useItemTagsStore } from '@/library/item-organize-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

const PROBLEM_KEYS: Record<TagProblem, TranslationKey> = {
  empty: 'organize.tagEmpty',
  'too-long': 'organize.tagTooLong',
  duplicate: 'organize.tagDuplicate',
  'too-many': 'organize.tagTooMany',
};

const NO_TAGS: string[] = [];

export type ItemTagsEditorProps = {
  /** The saved video (its download id). */
  id: string;
  testID?: string;
};

/**
 * H12 (#387): a saved video's tags — each removable, a field to add one, and the tags already used elsewhere as
 * one-tap suggestions. Saved on this device at once.
 */
export const ItemTagsEditor = memo(function ItemTagsEditor({ id, testID = 'item-tags' }: ItemTagsEditorProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tags = useItemTagsStore((s) => s.tagsById[id] ?? NO_TAGS);
  const tagsById = useItemTagsStore((s) => s.tagsById);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<TagProblem | null>(null);

  const suggestions = useMemo(
    () =>
      allTags(tagsById)
        .map((entry) => entry.tag)
        .filter((tag) => tagProblem(tags, tag) === null)
        .slice(0, 8),
    [tags, tagsById],
  );

  const add = useCallback(
    (raw: string) => {
      const found = tagProblem(tags, raw);
      if (found) {
        setProblem(found);
        return;
      }
      if (useItemTagsStore.getState().addTag(id, raw)) {
        setDraft('');
        setProblem(null);
        AccessibilityInfo.announceForAccessibility(t('organize.tagAdded', { tag: raw.trim() }));
      }
    },
    [id, t, tags],
  );

  const remove = useCallback(
    (tag: string) => {
      useItemTagsStore.getState().removeTag(id, tag);
      AccessibilityInfo.announceForAccessibility(t('organize.tagRemoved', { tag }));
    },
    [id, t],
  );

  const errorText = problem
    ? t(PROBLEM_KEYS[problem], { max: String(problem === 'too-many' ? MAX_TAGS_PER_ITEM : MAX_TAG_LENGTH) })
    : undefined;

  return (
    <Box gap={8} testID={testID}>
      {tags.length > 0 ? (
        <Box row rtlRow gap={6} style={{ flexWrap: 'wrap' }}>
          {tags.map((tag) => (
            <Pressable
              key={tag}
              onPress={() => remove(tag)}
              accessibilityRole="button"
              accessibilityLabel={t('organize.removeTagA11y', { tag })}
              testID={`${testID}-remove-${tag}`}>
              <Box
                row
                rtlRow
                center
                gap={4}
                px={10}
                py={4}
                style={{ borderRadius: 999, backgroundColor: theme.colors.surfaceSelected, borderWidth: 1, borderColor: theme.colors.border }}>
                <Text variant="bodySmall">{tag}</Text>
                <Icon name="close" size={14} color="secondary" />
              </Box>
            </Pressable>
          ))}
        </Box>
      ) : (
        <Text variant="caption" color="textSecondary">
          {t('organize.noTags')}
        </Text>
      )}
      <Box row rtlRow gap={8} style={{ alignItems: 'flex-start' }}>
        <Box flex={1}>
          <TextField
            value={draft}
            onChangeText={(value) => {
              setDraft(value);
              setProblem(null);
            }}
            placeholder={t('organize.addTagPlaceholder')}
            maxLength={MAX_TAG_LENGTH + 10}
            error={errorText}
            returnKeyType="done"
            onSubmitEditing={() => add(draft)}
            accessibilityLabel={t('organize.addTagPlaceholder')}
            testID={`${testID}-input`}
          />
        </Box>
        <Button
          title={t('organize.addTag')}
          variant="outline"
          size="small"
          onPress={() => add(draft)}
          disabled={!draft.trim()}
          testID={`${testID}-add`}
        />
      </Box>
      {suggestions.length > 0 ? (
        <Box row rtlRow gap={6} style={{ flexWrap: 'wrap' }}>
          {suggestions.map((tag) => (
            <Button
              key={tag}
              title={`+ ${tag}`}
              variant="ghost"
              size="small"
              onPress={() => add(tag)}
              accessibilityLabel={t('organize.addTagA11y', { tag })}
              testID={`${testID}-suggest-${tag}`}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
});
