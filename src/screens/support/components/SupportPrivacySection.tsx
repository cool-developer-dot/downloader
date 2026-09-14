import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type SupportLinkRowProps = {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
  accessibilityHint: string;
  testID: string;
};

export const SupportLinkRow = memo(function SupportLinkRow({
  icon,
  title,
  description,
  onPress,
  accessibilityHint,
  testID,
}: SupportLinkRowProps) {
  const theme = useTheme();
  const { rtl } = useTranslation();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={{ minHeight: 48 }}>
      <Box row rtlRow center gap={12} py={12}>
        <Box
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: theme.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityElementsHidden
          importantForAccessibility="no">
          <Icon name={icon} size="md" color="primary" />
        </Box>
        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text
            variant="body"
            style={{
              color: theme.colors.textPrimary,
              lineHeight: 22,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {title}
          </Text>
          <Text
            variant="caption"
            style={{
              color: theme.colors.textSecondary,
              lineHeight: 16,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {description}
          </Text>
        </Box>
        <Icon name={rtl.chevronForward} size="sm" color="secondary" />
      </Box>
    </Pressable>
  );
});

export type SupportPrivacySectionProps = {
  contactEmail: string | null;
  onOpenPrivacy: () => void;
  onOpenDeletion: () => void;
  onOpenMail: () => void;
};

export const SupportPrivacySection = memo(function SupportPrivacySection({
  contactEmail,
  onOpenPrivacy,
  onOpenDeletion,
  onOpenMail,
}: SupportPrivacySectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleMail = useCallback(() => {
    onOpenMail();
  }, [onOpenMail]);

  return (
    <Box gap={4}>
      <Text
        variant="subtitle"
        accessibilityRole="header"
        style={{ color: theme.colors.textPrimary, marginBottom: 8 }}>
        {t('support.privacyHeading')}
      </Text>

      <SupportLinkRow
        icon="shield-lock-outline"
        title={t('support.privacyQuestions')}
        description={t('support.privacyQuestionsHint')}
        onPress={onOpenPrivacy}
        accessibilityHint={t('support.privacyQuestionsA11y')}
        testID="support-privacy"
      />
      <SupportLinkRow
        icon="delete-outline"
        title={t('support.deletionRequest')}
        description={t('support.deletionRequestHint')}
        onPress={onOpenDeletion}
        accessibilityHint={t('support.deletionRequestA11y')}
        testID="support-deletion"
      />
      {contactEmail ? (
        <SupportLinkRow
          icon="email-outline"
          title={t('support.emailContact')}
          description={t('support.emailContactHint', { email: contactEmail })}
          onPress={handleMail}
          accessibilityHint={t('support.emailContactA11y')}
          testID="support-email"
        />
      ) : null}
    </Box>
  );
});
