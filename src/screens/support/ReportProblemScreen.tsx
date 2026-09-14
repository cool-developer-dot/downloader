/**
 * Phase 4B.1 — Report a Problem screen.
 *
 * Form flow:
 *   category → subject → description → [include technical details] → Send
 *
 * Submission states: idle → validating → sending → success | failure | unavailable
 *
 * Security:
 *   - Only sends allowlisted ReportPayload fields (via support-service).
 *   - Never clears user text on failure.
 *   - No fake success.
 *   - Disabled during sending to prevent duplicate taps.
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { push, routePaths } from '@/navigation';
import {
  EMPTY_REPORT_DRAFT,
  REPORT_CATEGORY_IDS,
  canSubmitSupportReport,
  getSupportSubmissionMode,
  validateReportDraft,
  getValidationMessageKey,
  type ReportCategoryId,
  type ReportDraft,
  type ReportSubmissionStatus,
  type ReportValidationErrors,
} from '@/support';
import {
  collectDiagnostics,
  formatDiagnosticsForDisplay,
} from '@/support/diagnostics';
import {
  buildReportPayload,
  submitReport,
} from '@/support/support-service';

const CATEGORY_KEYS: Record<ReportCategoryId, 'support.report.categories.download' | 'support.report.categories.browser' | 'support.report.categories.playback' | 'support.report.categories.file' | 'support.report.categories.account' | 'support.report.categories.other'> = {
  download: 'support.report.categories.download',
  browser: 'support.report.categories.browser',
  playback: 'support.report.categories.playback',
  file: 'support.report.categories.file',
  account: 'support.report.categories.account',
  other: 'support.report.categories.other',
};

export type ReportProblemScreenProps = {
  /**
   * Phase 4B.2: optional pre-selected report category arriving from error surfaces.
   * Must be a valid ReportCategoryId (validated in route layer).
   */
  initialCategory?: ReportCategoryId;
  /**
   * Phase 4B.2: optional safe semantic source label for subject prefill.
   * Max 80 chars, no raw errors/URLs/tokens. Already validated.
   */
  initialSource?: string;
};

export const ReportProblemScreen = memo(function ReportProblemScreen({
  initialCategory,
  initialSource,
}: ReportProblemScreenProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();

  const [draft, setDraft] = useState<ReportDraft>({
    ...EMPTY_REPORT_DRAFT,
    ...(initialCategory ? { category: initialCategory } : {}),
    ...(initialSource
      ? { subject: initialSource.trim().slice(0, 120) }
      : {}),
  });
  const [validationErrors, setValidationErrors] =
    useState<ReportValidationErrors>({});
  const [status, setStatus] = useState<ReportSubmissionStatus>('idle');
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const submissionMode = useMemo(() => getSupportSubmissionMode(), []);
  const isAvailable = useMemo(() => canSubmitSupportReport(), []);
  const isSending = status === 'sending' || status === 'validating';

  const diagnosticsLines = useMemo(() => {
    if (!draft.includeDiagnostics || !diagnosticsExpanded) {
      return [];
    }
    return formatDiagnosticsForDisplay(collectDiagnostics(draft.category));
  }, [draft.category, draft.includeDiagnostics, diagnosticsExpanded]);

  const setCategory = useCallback(
    (id: ReportCategoryId) => {
      setDraft((prev) => ({ ...prev, category: id }));
      if (validationErrors.category) {
        setValidationErrors((prev) => ({ ...prev, category: undefined }));
      }
    },
    [validationErrors.category],
  );

  const setSubject = useCallback(
    (value: string) => {
      setDraft((prev) => ({ ...prev, subject: value }));
      if (validationErrors.subject) {
        setValidationErrors((prev) => ({ ...prev, subject: undefined }));
      }
    },
    [validationErrors.subject],
  );

  const setDescription = useCallback(
    (value: string) => {
      setDraft((prev) => ({ ...prev, description: value }));
      if (validationErrors.description) {
        setValidationErrors((prev) => ({ ...prev, description: undefined }));
      }
    },
    [validationErrors.description],
  );

  const setIncludeDiagnostics = useCallback((value: boolean) => {
    setDraft((prev) => ({ ...prev, includeDiagnostics: value }));
  }, []);

  const toggleDiagnosticsExpanded = useCallback(() => {
    setDiagnosticsExpanded((prev) => !prev);
  }, []);

  const openPrivacy = useCallback(() => {
    push(routePaths.privacy);
  }, []);

  const handleSend = useCallback(async () => {
    if (isSending) {
      return;
    }

    if (!isAvailable) {
      setStatus('unavailable');
      return;
    }

    setStatus('validating');
    const result = validateReportDraft(draft);

    if (!result.valid) {
      setValidationErrors(result.errors);
      setStatus('idle');
      const firstErrorKey = Object.keys(result.errors)[0];
      if (firstErrorKey) {
        const msg =
          t(getValidationMessageKey(result.errors[firstErrorKey as keyof ReportValidationErrors]!) as Parameters<typeof t>[0]);
        AccessibilityInfo.announceForAccessibility(msg);
      }
      return;
    }

    setStatus('sending');
    const payload = buildReportPayload(result.data, draft.includeDiagnostics);
    const submitResult = await submitReport(payload);

    const nextStatus = submitResult.status;
    setStatus(nextStatus);

    if (nextStatus === 'success') {
      AccessibilityInfo.announceForAccessibility(t('support.report.successTitle'));
      setDraft(EMPTY_REPORT_DRAFT);
      setValidationErrors({});
    } else if (nextStatus === 'failure') {
      AccessibilityInfo.announceForAccessibility(t('support.report.failureTitle'));
    } else if (nextStatus === 'unavailable') {
      AccessibilityInfo.announceForAccessibility(t('support.report.unavailableTitle'));
    }
  }, [draft, isAvailable, isSending, t]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
  }, []);

  const categoryError = validationErrors.category
    ? t(getValidationMessageKey(validationErrors.category) as Parameters<typeof t>[0])
    : undefined;
  const subjectError = validationErrors.subject
    ? t(getValidationMessageKey(validationErrors.subject) as Parameters<typeof t>[0])
    : undefined;
  const descriptionError = validationErrors.description
    ? t(getValidationMessageKey(validationErrors.description) as Parameters<typeof t>[0])
    : undefined;

  return (
    <SafeAreaScreen testID="report-problem-screen" padded scrollable>
      <Box
        gap={24}
        pb={40}
        accessible={false}
        accessibilityLabel={t('support.report.a11y')}>
        {/* Header */}
        <Box gap={8}>
          <Text
            variant="title"
            accessibilityRole="header"
            style={{
              color: theme.colors.textPrimary,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            }}>
            {t('support.report.title')}
          </Text>
        </Box>

        {/* Success state */}
        {status === 'success' ? (
          <Box
            gap={12}
            px={16}
            py={20}
            style={{
              borderRadius: theme.radius.md,
              backgroundColor: `${theme.colors.primary}14`,
              borderWidth: 1,
              borderColor: theme.colors.primary,
            }}
            accessible
            accessibilityRole="alert">
            <Text
              variant="subtitle"
              style={{
                color: theme.colors.primary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.successTitle')}
            </Text>
            <Text
              variant="body"
              style={{
                color: theme.colors.textSecondary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.successDescription')}
            </Text>
          </Box>
        ) : null}

        {/* Unavailable state */}
        {status === 'unavailable' || (!isAvailable && status === 'idle') ? (
          <Box
            gap={10}
            px={16}
            py={16}
            style={{
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
            accessible
            accessibilityRole="alert">
            <Text
              variant="subtitle"
              style={{
                color: theme.colors.textPrimary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.unavailableTitle')}
            </Text>
            <Text
              variant="body"
              style={{
                color: theme.colors.textSecondary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.unavailableDescription')}
            </Text>
          </Box>
        ) : null}

        {/* Failure state */}
        {status === 'failure' ? (
          <Box
            gap={10}
            px={16}
            py={16}
            style={{
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
            accessible
            accessibilityRole="alert">
            <Text
              variant="subtitle"
              style={{
                color: theme.colors.textPrimary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.failureTitle')}
            </Text>
            <Text
              variant="body"
              style={{
                color: theme.colors.textSecondary,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}>
              {t('support.report.failureDescription')}
            </Text>
            <Button
              title={t('support.report.retry')}
              variant="secondary"
              size="small"
              onPress={handleRetry}
              testID="report-retry-button"
              accessibilityLabel={t('support.report.retry')}
            />
          </Box>
        ) : null}

        {/* Form — always visible so text is preserved on failure */}
        {status !== 'success' ? (
          <Box gap={20}>
            {/* Category selector */}
            <Box gap={8}>
              <Text
                variant="bodySmall"
                style={{
                  color: theme.colors.textSecondary,
                  textAlign: rtl.textAlign,
                  writingDirection: rtl.writingDirection,
                }}>
                {t('support.report.categoryLabel')}
              </Text>
              <Box gap={6} testID="report-category-selector">
                {REPORT_CATEGORY_IDS.map((id) => {
                  const selected = draft.category === id;
                  const label = t(CATEGORY_KEYS[id]);
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setCategory(id)}
                      disabled={isSending}
                      accessibilityRole="radio"
                      accessibilityLabel={label}
                      accessibilityState={{ checked: selected, disabled: isSending }}
                      testID={`report-category-${id}`}
                      style={{ minHeight: 44 }}>
                      <Box
                        row
                        rtlRow
                        center
                        gap={10}
                        px={14}
                        py={12}
                        style={{
                          borderRadius: theme.radius.md,
                          backgroundColor: selected
                            ? `${theme.colors.primary}14`
                            : theme.colors.surface,
                          borderWidth: 1,
                          borderColor: selected
                            ? theme.colors.primary
                            : theme.colors.border,
                        }}>
                        <Box
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 10,
                            borderWidth: 2,
                            borderColor: selected
                              ? theme.colors.primary
                              : theme.colors.border,
                            backgroundColor: selected
                              ? theme.colors.primary
                              : 'transparent',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                        <Text
                          variant="body"
                          style={{
                            color: selected
                              ? theme.colors.primary
                              : theme.colors.textPrimary,
                            textAlign: rtl.textAlign,
                            writingDirection: rtl.writingDirection,
                            flex: 1,
                          }}>
                          {label}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })}
              </Box>
              {categoryError ? (
                <Text
                  variant="caption"
                  accessible
                  accessibilityRole="alert"
                  style={{
                    color: theme.colors.error,
                    textAlign: rtl.textAlign,
                    writingDirection: rtl.writingDirection,
                  }}>
                  {categoryError}
                </Text>
              ) : null}
            </Box>

            {/* Subject field */}
            <TextField
              label={t('support.report.subjectLabel')}
              placeholder={t('support.report.subjectPlaceholder')}
              value={draft.subject}
              onChangeText={setSubject}
              error={subjectError}
              disabled={isSending}
              accessibilityLabel={t('support.report.subjectLabel')}
              accessibilityHint={t('support.report.subjectPlaceholder')}
              testID="report-subject-field"
              maxLength={150}
              returnKeyType="next"
            />

            {/* Description field */}
            <TextField
              label={t('support.report.descriptionLabel')}
              placeholder={t('support.report.descriptionPlaceholder')}
              value={draft.description}
              onChangeText={setDescription}
              error={descriptionError}
              disabled={isSending}
              accessibilityLabel={t('support.report.descriptionLabel')}
              accessibilityHint={t('support.report.descriptionPlaceholder')}
              testID="report-description-field"
              multiline
              numberOfLines={5}
              maxLength={2100}
              style={{ minHeight: 120, textAlignVertical: 'top' }}
            />

            {/* Diagnostics toggle */}
            <Box
              gap={10}
              px={14}
              py={14}
              style={{
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}>
              <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
                <Box flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text
                    variant="body"
                    style={{
                      color: theme.colors.textPrimary,
                      textAlign: rtl.textAlign,
                      writingDirection: rtl.writingDirection,
                    }}>
                    {t('support.report.includeDiagnostics')}
                  </Text>
                  <Text
                    variant="caption"
                    style={{
                      color: theme.colors.textSecondary,
                      textAlign: rtl.textAlign,
                      writingDirection: rtl.writingDirection,
                    }}>
                    {t('support.report.diagnosticsHint')}
                  </Text>
                </Box>
                <Switch
                  value={draft.includeDiagnostics}
                  onValueChange={setIncludeDiagnostics}
                  disabled={isSending}
                  accessibilityLabel={t('support.report.includeDiagnostics')}
                  accessibilityHint={t('support.report.diagnosticsHint')}
                  testID="report-diagnostics-toggle"
                />
              </Box>

              {draft.includeDiagnostics ? (
                <Pressable
                  onPress={toggleDiagnosticsExpanded}
                  accessibilityRole="button"
                  accessibilityLabel={t('support.report.diagnosticsExpanded')}
                  accessibilityState={{ expanded: diagnosticsExpanded }}
                  testID="report-diagnostics-expand"
                  style={{ minHeight: 36, justifyContent: 'center' }}>
                  <Text
                    variant="bodySmall"
                    style={{
                      color: theme.colors.primary,
                      textAlign: rtl.textAlign,
                      writingDirection: rtl.writingDirection,
                    }}>
                    {t('support.report.diagnosticsExpanded')}{' '}
                    {diagnosticsExpanded ? '▲' : '▼'}
                  </Text>
                </Pressable>
              ) : null}

              {diagnosticsExpanded && diagnosticsLines.length > 0 ? (
                <Box
                  gap={4}
                  px={10}
                  py={10}
                  style={{
                    borderRadius: theme.radius.sm,
                    backgroundColor: theme.colors.background,
                  }}
                  accessible
                  accessibilityLabel={t('support.report.diagnosticsExpanded')}>
                  {diagnosticsLines.map((line) => (
                    <Text
                      key={line}
                      variant="caption"
                      style={{
                        color: theme.colors.textSecondary,
                        fontFamily: 'monospace',
                        textAlign: rtl.textAlign,
                        writingDirection: rtl.writingDirection,
                      }}>
                      {line}
                    </Text>
                  ))}
                </Box>
              ) : null}
            </Box>

            {/* Privacy note */}
            <Box row rtlRow gap={4} style={{ flexWrap: 'wrap' }}>
              <Text
                variant="caption"
                style={{
                  color: theme.colors.textSecondary,
                  textAlign: rtl.textAlign,
                  writingDirection: rtl.writingDirection,
                }}>
                {t('support.report.privacyNote')}
              </Text>
              <Pressable
                onPress={openPrivacy}
                accessibilityRole="link"
                accessibilityLabel={t('support.report.openPrivacy')}
                style={{ minHeight: 24, justifyContent: 'center' }}
                testID="report-privacy-link">
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.primary,
                    textDecorationLine: 'underline',
                  }}>
                  {t('support.report.openPrivacy')}
                </Text>
              </Pressable>
            </Box>

            {/* Send button */}
            <Button
              title={isSending ? t('support.report.sending') : t('support.report.send')}
              variant="primary"
              size="large"
              fullWidth
              loading={isSending}
              disabled={isSending}
              onPress={handleSend}
              accessibilityLabel={t('support.report.send')}
              testID="report-send-button"
            />
          </Box>
        ) : null}
      </Box>
    </SafeAreaScreen>
  );
});
