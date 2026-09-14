import { memo, useCallback } from 'react';
import { LayoutAnimation } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { push } from '@/navigation';
import { getSupportAction, type SupportFaqItem } from '@/support';

export type SupportFaqAccordionItemProps = {
  item: SupportFaqItem;
  expanded: boolean;
  onToggle: (id: string) => void;
};

export const SupportFaqAccordionItem = memo(function SupportFaqAccordionItem({
  item,
  expanded,
  onToggle,
}: SupportFaqAccordionItemProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const action = getSupportAction(item.actionId);
  const actionLabel = item.actionLabelKey
    ? t(item.actionLabelKey)
    : action
      ? t(action.labelKey)
      : null;

  const handleToggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle(item.id);
  }, [item.id, onToggle]);

  const handleAction = useCallback(() => {
    if (!action) {
      return;
    }
    push(action.route);
  }, [action]);

  const question = t(item.questionKey);
  const answer = t(item.answerKey);

  return (
    <Box
      style={{
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
      }}
      testID={`support-faq-${item.id}`}>
      <Pressable
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityHint={
          expanded ? t('support.collapseA11y') : t('support.expandA11y')
        }
        accessibilityState={{ expanded }}
        style={{ minHeight: 48 }}
        testID={`support-faq-toggle-${item.id}`}>
        <Box row rtlRow center gap={12} px={14} py={14} style={{ minHeight: 48 }}>
          <Box flex={1} style={{ minWidth: 0 }}>
            <Text
              variant="body"
              style={{
                color: theme.colors.textPrimary,
                lineHeight: 22,
                fontWeight: '600',
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {question}
            </Text>
          </Box>
          <Icon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size="sm"
            color="secondary"
          />
        </Box>
      </Pressable>

      {expanded ? (
        <Box gap={12} px={14} pb={14} testID={`support-faq-answer-${item.id}`}>
          <Text
            variant="body"
            style={{
              color: theme.colors.textSecondary,
              lineHeight: 24,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}
            accessibilityRole="text">
            {answer}
          </Text>
          {action && actionLabel ? (
            <Button
              title={actionLabel}
              variant="outline"
              size="medium"
              onPress={handleAction}
              accessibilityLabel={actionLabel}
              testID={`support-faq-action-${item.id}`}
            />
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});
