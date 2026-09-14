import { memo, useCallback, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { EmptyState } from '@/components/common/EmptyState';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { SearchField } from '@/components/inputs/SearchField';
import { useTheme } from '@/hooks/use-theme';
import {
  getConfiguredLegalContactEmail,
  isLegalContactConfigured,
} from '@/legal';
import { useTranslation } from '@/localization';
import { push, routePaths } from '@/navigation';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_FAQ_ITEMS,
  canSubmitSupportReport,
  getFaqsByCategory,
  getPopularFaqs,
  getSupportCategory,
  getSupportEmail,
  getSupportSubmissionMode,
  hasSupportContext,
  searchSupportFaqs,
  type SupportCategoryId,
  type SupportContext,
} from '@/support';
import { openExternalUrl } from '@/utils/open-external-url';

import { SupportCategoryCard } from './components/SupportCategoryCard';
import { SupportFaqAccordionItem } from './components/SupportFaqAccordionItem';
import { SupportPrivacySection } from './components/SupportPrivacySection';

export type SupportScreenProps = {
  /**
   * Optional contextual hints arriving from error surfaces.
   * Phase 4B.2: pre-selects category + pre-expands FAQ when present.
   * All values are already validated in the route layer.
   */
  initialContext?: SupportContext;
};

/**
 * Week 8.5 Phase 4A + 4B.1 + 4B.2 — Help Center with Contact Support, Report a Problem,
 * and contextual error-to-support routing.
 * Preserves Phase 3B.2 Privacy / deletion / gated email links.
 */
export const SupportScreen = memo(function SupportScreen({
  initialContext,
}: SupportScreenProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<SupportCategoryId | null>(initialContext?.categoryId ?? null);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialContext?.faqId ?? null,
  );

  const contactEmail = isLegalContactConfigured()
    ? getConfiguredLegalContactEmail()
    : null;

  const submissionMode = useMemo(() => getSupportSubmissionMode(), []);
  const supportEmail = useMemo(() => getSupportEmail(), []);
  const hasSubmission = useMemo(() => canSubmitSupportReport(), []);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  const visibleFaqs = useMemo(() => {
    if (isSearching) {
      return searchSupportFaqs({
        query: trimmedQuery,
        faqs: SUPPORT_FAQ_ITEMS,
        categories: SUPPORT_CATEGORIES,
        t: (key) => t(key as Parameters<typeof t>[0]),
      });
    }
    if (selectedCategoryId) {
      return getFaqsByCategory(selectedCategoryId);
    }
    return getPopularFaqs();
  }, [isSearching, selectedCategoryId, t, trimmedQuery]);

  const selectedCategory = selectedCategoryId
    ? getSupportCategory(selectedCategoryId)
    : undefined;

  const faqHeading = isSearching
    ? t('support.resultsHeading')
    : selectedCategory
      ? t(selectedCategory.titleKey)
      : t('support.popularHeading');

  const handleToggleFaq = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  const handleSelectCategory = useCallback((id: SupportCategoryId) => {
    setQuery('');
    setExpandedId(null);
    setSelectedCategoryId((current) => (current === id ? null : id));
  }, []);

  const handleClearCategory = useCallback(() => {
    setSelectedCategoryId(null);
    setExpandedId(null);
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setExpandedId(null);
    if (value.trim().length > 0) {
      setSelectedCategoryId(null);
    }
  }, []);

  const openPrivacy = useCallback(() => {
    push(routePaths.privacy);
  }, []);

  const openDeletionInfo = useCallback(() => {
    push(routePaths.privacy);
  }, []);

  const openMail = useCallback(() => {
    if (!contactEmail) {
      return;
    }
    void openExternalUrl(`mailto:${contactEmail}`);
  }, [contactEmail]);

  const handleContactSupport = useCallback(() => {
    if (submissionMode === 'email' && supportEmail) {
      void openExternalUrl(`mailto:${supportEmail}`);
    }
    // 'unavailable': button is shown as disabled/informational — no navigation.
  }, [submissionMode, supportEmail]);

  const handleReportProblem = useCallback(() => {
    push(routePaths.reportProblem);
  }, []);

  return (
    <SafeAreaScreen testID="support-screen" padded scrollable>
      <Box
        gap={24}
        pb={32}
        accessible={false}
        accessibilityLabel={t('support.a11y')}>
        <Box gap={8}>
          <Text
            variant="title"
            accessibilityRole="header"
            style={{
              color: theme.colors.textPrimary,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {t('support.title')}
          </Text>
          <Text
            variant="body"
            style={{
              color: theme.colors.textSecondary,
              lineHeight: 24,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {t('support.description')}
          </Text>
        </Box>

        <SearchField
          value={query}
          onChangeText={handleQueryChange}
          placeholder={t('support.searchPlaceholder')}
          accessibilityLabel={t('support.searchA11y')}
          accessibilityHint={t('support.searchHint')}
          testID="support-search"
        />

        {!isSearching ? (
          <Box gap={10}>
            <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
              <Text
                variant="subtitle"
                accessibilityRole="header"
                style={{ color: theme.colors.textPrimary }}>
                {t('support.categoriesHeading')}
              </Text>
              {selectedCategoryId ? (
                <Pressable
                  onPress={handleClearCategory}
                  accessibilityRole="button"
                  accessibilityLabel={t('support.showAllCategoriesA11y')}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                  testID="support-clear-category">
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.primary, lineHeight: 20 }}>
                    {t('support.showAllCategories')}
                  </Text>
                </Pressable>
              ) : null}
            </Box>

            <Box gap={8}>
              {SUPPORT_CATEGORIES.map((category) => (
                <SupportCategoryCard
                  key={category.id}
                  icon={category.icon}
                  title={t(category.titleKey)}
                  description={t(category.descriptionKey)}
                  selected={selectedCategoryId === category.id}
                  onPress={() => handleSelectCategory(category.id)}
                  testID={`support-category-${category.id}`}
                />
              ))}
            </Box>
          </Box>
        ) : null}

        <Box gap={10}>
          <Text
            variant="subtitle"
            accessibilityRole="header"
            style={{ color: theme.colors.textPrimary }}>
            {faqHeading}
          </Text>

          {visibleFaqs.length === 0 ? (
            <EmptyState
              icon="magnify-close"
              title={t('support.noResultsTitle')}
              description={t('support.noResultsDescription')}
              testID="support-no-results"
            />
          ) : (
            <Box gap={8}>
              {visibleFaqs.map((item) => (
                <SupportFaqAccordionItem
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={handleToggleFaq}
                />
              ))}
            </Box>
          )}
        </Box>

        {/* Phase 4B.1 — Contact Support + Report a Problem (additive) */}
        <Box gap={10} testID="support-contact-section">
          <Text
            variant="subtitle"
            accessibilityRole="header"
            style={{ color: theme.colors.textPrimary }}>
            {t('support.supportActionsHeading')}
          </Text>

          {/* Report a Problem — always available (form collects even when submission unavailable) */}
          <Pressable
            onPress={handleReportProblem}
            accessibilityRole="button"
            accessibilityLabel={t('support.reportProblem')}
            accessibilityHint={t('support.reportProblemA11y')}
            testID="support-report-problem"
            style={{ minHeight: 48 }}>
            <Box
              row
              rtlRow
              center
              gap={12}
              px={14}
              py={14}
              style={{
                minHeight: 48,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}>
              <Box
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: `${theme.colors.primary}14`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                accessibilityElementsHidden
                importantForAccessibility="no">
                <Icon name="bug-outline" size="md" color="primary" />
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
                  {t('support.reportProblem')}
                </Text>
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.textSecondary,
                    lineHeight: 16,
                    textAlign: rtl.textAlign,
                    writingDirection: rtl.writingDirection,
                  }}>
                  {t('support.reportProblemHint')}
                </Text>
              </Box>
              <Icon name={rtl.chevronForward} size="sm" color="secondary" />
            </Box>
          </Pressable>

          {/* Contact Support — active when email configured, otherwise informational */}
          {submissionMode !== 'unavailable' ? (
            <Pressable
              onPress={handleContactSupport}
              accessibilityRole="button"
              accessibilityLabel={t('support.contactSupport')}
              accessibilityHint={t('support.contactSupportA11y')}
              testID="support-contact-support"
              style={{ minHeight: 48 }}>
              <Box
                row
                rtlRow
                center
                gap={12}
                px={14}
                py={14}
                style={{
                  minHeight: 48,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surface,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}>
                <Box
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: `${theme.colors.primary}14`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  accessibilityElementsHidden
                  importantForAccessibility="no">
                  <Icon name="email-outline" size="md" color="primary" />
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
                    {t('support.contactSupport')}
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      color: theme.colors.textSecondary,
                      lineHeight: 16,
                      textAlign: rtl.textAlign,
                      writingDirection: rtl.writingDirection,
                    }}>
                    {t('support.contactSupportHint')}
                  </Text>
                </Box>
                <Icon name={rtl.chevronForward} size="sm" color="secondary" />
              </Box>
            </Pressable>
          ) : (
            <Box
              gap={6}
              px={14}
              py={12}
              style={{
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
              accessible
              accessibilityLabel={t('support.contactUnavailableTitle')}>
              <Text
                variant="body"
                style={{
                  color: theme.colors.textSecondary,
                  textAlign: rtl.textAlign,
                  writingDirection: rtl.writingDirection,
                }}>
                {t('support.contactUnavailableTitle')}
              </Text>
              <Text
                variant="caption"
                style={{
                  color: theme.colors.textSecondary,
                  textAlign: rtl.textAlign,
                  writingDirection: rtl.writingDirection,
                }}>
                {t('support.contactUnavailableDescription')}
              </Text>
            </Box>
          )}
        </Box>

        <SupportPrivacySection
          contactEmail={contactEmail}
          onOpenPrivacy={openPrivacy}
          onOpenDeletion={openDeletionInfo}
          onOpenMail={openMail}
        />
      </Box>
    </SafeAreaScreen>
  );
});
