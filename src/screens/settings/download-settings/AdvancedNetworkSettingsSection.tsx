import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import * as ReactNative from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { TextField } from '@/components/inputs/TextField';
import {
  addHeaderProblem,
  MAX_HEADER_VALUE_LENGTH,
  MAX_HEADERS,
  MAX_HEADER_NAME_LENGTH,
  MAX_USER_AGENT_LENGTH,
  TIMEOUT_CHOICES,
  validateUserAgent,
  type HeaderPair,
  type HeaderProblem,
  type TimeoutChoice,
  type UserAgentMode,
} from '@/downloads/v2/network-options';
import { ensureNetworkHeadersHydrated, useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

import { SettingsSection, SettingsStaggerItem } from '../components';

export type AdvancedNetworkSettingsSectionProps = {
  index: number;
  disabled?: boolean;
};

const PROBLEM_KEYS: Record<HeaderProblem, TranslationKey> = {
  'empty-name': 'networkOptions.problems.emptyName',
  'invalid-name': 'networkOptions.problems.invalidName',
  'refused-name': 'networkOptions.problems.refusedName',
  'name-too-long': 'networkOptions.problems.nameTooLong',
  'empty-value': 'networkOptions.problems.emptyValue',
  'value-too-long': 'networkOptions.problems.valueTooLong',
  'line-break': 'networkOptions.problems.lineBreak',
  'not-ascii': 'networkOptions.problems.notAscii',
  duplicate: 'networkOptions.problems.duplicate',
  'too-many': 'networkOptions.problems.tooMany',
};

/** A header value may be a key or token: only its last characters are ever shown. */
function maskedValue(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

function announce(message: string): void {
  if (ReactNative.Platform.OS === 'android') {
    ReactNative.ToastAndroid.show(message, ReactNative.ToastAndroid.SHORT);
  }
  ReactNative.AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Download Settings → Advanced network (collapsed until opened): Custom User-Agent (#443), Custom Headers (#444) and
 * Timeout (#349). Every default is today's behaviour, and with the defaults nothing extra reaches the native side.
 */
export const AdvancedNetworkSettingsSection = memo(function AdvancedNetworkSettingsSection({
  index,
  disabled,
}: AdvancedNetworkSettingsSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const userAgentMode = useNetworkOptionsStore((s) => s.userAgentMode);
  const savedUserAgent = useNetworkOptionsStore((s) => s.customUserAgent);
  const headers = useNetworkOptionsStore((s) => s.headers);
  const headersHydrated = useNetworkOptionsStore((s) => s.headersHydrated);
  const timeout = useNetworkOptionsStore((s) => s.timeout);

  const [agentDraft, setAgentDraft] = useState(savedUserAgent);
  const [headerName, setHeaderName] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [headerError, setHeaderError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded) {
      void ensureNetworkHeadersHydrated();
    }
  }, [expanded]);

  const agentCheck = useMemo(() => validateUserAgent(agentDraft), [agentDraft]);
  const agentError = useMemo(() => {
    if (agentCheck.ok || agentDraft.length === 0) {
      return null;
    }
    switch (agentCheck.reason) {
      case 'too-long':
        return t('networkOptions.userAgentTooLong', { max: String(MAX_USER_AGENT_LENGTH) });
      case 'line-break':
        return t('networkOptions.problems.lineBreak');
      case 'not-ascii':
        return t('networkOptions.problems.notAscii');
      default:
        return t('networkOptions.userAgentEmpty');
    }
  }, [agentCheck, agentDraft.length, t]);

  const onUserAgentMode = useCallback((mode: UserAgentMode) => {
    useNetworkOptionsStore.getState().setUserAgentMode(mode);
  }, []);

  const saveUserAgent = useCallback(() => {
    const check = validateUserAgent(agentDraft);
    if (!check.ok) {
      return;
    }
    useNetworkOptionsStore.getState().setCustomUserAgent(check.value);
    setAgentDraft(check.value);
    announce(t('networkOptions.userAgentSaved'));
  }, [agentDraft, t]);

  const problemText = useCallback(
    (problem: HeaderProblem, name: string) =>
      t(PROBLEM_KEYS[problem], {
        name: name.trim(),
        max: String(
          problem === 'too-many'
            ? MAX_HEADERS
            : problem === 'name-too-long'
              ? MAX_HEADER_NAME_LENGTH
              : MAX_HEADER_VALUE_LENGTH,
        ),
      }),
    [t],
  );

  const addHeader = useCallback(() => {
    // Read right before acting: the list may have changed (Clear all, Reset) since this was typed.
    const current = useNetworkOptionsStore.getState().headers;
    const pair: HeaderPair = { name: headerName.trim(), value: headerValue.trim() };
    const problem = addHeaderProblem(current, pair);
    if (problem) {
      setHeaderError(problemText(problem, pair.name));
      return;
    }
    useNetworkOptionsStore.getState().setHeaders([...current, pair]);
    setHeaderName('');
    setHeaderValue('');
    setHeaderError(null);
  }, [headerName, headerValue, problemText]);

  const removeHeader = useCallback((name: string) => {
    const current = useNetworkOptionsStore.getState().headers;
    useNetworkOptionsStore.getState().setHeaders(current.filter((header) => header.name !== name));
  }, []);

  const clearHeaders = useCallback(() => {
    useNetworkOptionsStore.getState().setHeaders([]);
  }, []);

  const resetAll = useCallback(() => {
    useNetworkOptionsStore.getState().reset();
    setAgentDraft('');
    setHeaderName('');
    setHeaderValue('');
    setHeaderError(null);
    announce(t('networkOptions.resetDone'));
  }, [t]);

  const userAgentOptions = useMemo(
    () => [
      { value: 'automatic' as const, label: t('networkOptions.automatic') },
      { value: 'custom' as const, label: t('networkOptions.custom') },
    ],
    [t],
  );

  const timeoutOptions = useMemo(
    () =>
      TIMEOUT_CHOICES.map((choice) => ({
        value: choice,
        label: choice === 'automatic' ? t('networkOptions.automatic') : t('networkOptions.seconds', { seconds: choice }),
      })),
    [t],
  );

  const controlsDisabled = Boolean(disabled);

  return (
    <SettingsStaggerItem index={index}>
      <SettingsSection
        testID="download-settings-advanced-network"
        title={t('networkOptions.section')}
        description={t('networkOptions.sectionDescription')}
        icon="lan">
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? t('networkOptions.hide') : t('networkOptions.show')}
          testID="download-settings-advanced-network-toggle">
          <Box row rtlRow center gap={10} py={14}>
            <Box flex={1}>
              <Text variant="body">{expanded ? t('networkOptions.hide') : t('networkOptions.show')}</Text>
            </Box>
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" color="secondary" />
          </Box>
        </Pressable>

        {expanded ? (
          <Box gap={14} pb={12}>
            <Text variant="bodySmall" color="warning" testID="download-settings-advanced-network-warning">
              {t('networkOptions.warning')}
            </Text>

            <Box gap={8}>
              <Text variant="label">{t('networkOptions.userAgent')}</Text>
              <SegmentedControl
                options={userAgentOptions}
                value={userAgentMode}
                onChange={onUserAgentMode}
                disabled={controlsDisabled}
                accessibilityLabel={t('networkOptions.userAgent')}
                testID="download-settings-user-agent-mode"
              />
              {userAgentMode === 'custom' ? (
                <>
                  <TextField
                    label={t('networkOptions.userAgent')}
                    value={agentDraft}
                    onChangeText={setAgentDraft}
                    maxLength={MAX_USER_AGENT_LENGTH + 1}
                    autoCapitalize="none"
                    autoCorrect={false}
                    disabled={controlsDisabled}
                    error={agentError ?? undefined}
                    helperText={savedUserAgent ? undefined : t('networkOptions.userAgentEmpty')}
                    testID="download-settings-user-agent"
                  />
                  <Box row rtlRow>
                    <Button
                      title={t('networkOptions.userAgentSave')}
                      variant="outline"
                      size="small"
                      onPress={saveUserAgent}
                      disabled={controlsDisabled || !agentCheck.ok || agentCheck.value === savedUserAgent}
                      testID="download-settings-user-agent-save"
                    />
                  </Box>
                </>
              ) : (
                <Text variant="caption" color="textSecondary">
                  {t('networkOptions.userAgentAutomaticHint')}
                </Text>
              )}
            </Box>

            <Box gap={8}>
              <Text variant="label">{t('networkOptions.headers')}</Text>
              <Text variant="caption" color="textSecondary">
                {t('networkOptions.headersHint')}
              </Text>
              {!headersHydrated ? null : headers.length === 0 ? (
                <Text variant="bodySmall" color="textSecondary">
                  {t('networkOptions.noHeaders')}
                </Text>
              ) : (
                headers.map((header) => (
                  <Box key={header.name} row rtlRow center gap={8}>
                    <Box flex={1}>
                      <Text variant="bodySmall" numberOfLines={1}>
                        {`${header.name}: ${maskedValue(header.value)}`}
                      </Text>
                    </Box>
                    <Button
                      title={t('networkOptions.removeHeader')}
                      variant="ghost"
                      size="small"
                      onPress={() => removeHeader(header.name)}
                      disabled={controlsDisabled}
                      accessibilityLabel={t('networkOptions.removeHeaderA11y', { name: header.name })}
                      testID={`download-settings-header-remove-${header.name}`}
                    />
                  </Box>
                ))
              )}
              <TextField
                label={t('networkOptions.headerName')}
                value={headerName}
                onChangeText={(value) => {
                  setHeaderName(value);
                  setHeaderError(null);
                }}
                maxLength={MAX_HEADER_NAME_LENGTH + 1}
                autoCapitalize="none"
                autoCorrect={false}
                disabled={controlsDisabled || !headersHydrated}
                testID="download-settings-header-name"
              />
              <TextField
                label={t('networkOptions.headerValue')}
                value={headerValue}
                onChangeText={(value) => {
                  setHeaderValue(value);
                  setHeaderError(null);
                }}
                maxLength={MAX_HEADER_VALUE_LENGTH + 1}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                disabled={controlsDisabled || !headersHydrated}
                error={headerError ?? undefined}
                testID="download-settings-header-value"
              />
              <Box row rtlRow gap={8} style={{ flexWrap: 'wrap' }}>
                <Button
                  title={t('networkOptions.addHeader')}
                  variant="outline"
                  size="small"
                  onPress={addHeader}
                  disabled={controlsDisabled || !headersHydrated}
                  testID="download-settings-header-add"
                />
                {headers.length > 0 ? (
                  <Button
                    title={t('networkOptions.clearHeaders')}
                    variant="ghost"
                    size="small"
                    onPress={clearHeaders}
                    disabled={controlsDisabled}
                    testID="download-settings-header-clear"
                  />
                ) : null}
              </Box>
            </Box>

            <Box gap={8}>
              <Text variant="label">{t('networkOptions.timeout')}</Text>
              <SegmentedControl<TimeoutChoice>
                options={timeoutOptions}
                value={timeout}
                onChange={(choice) => useNetworkOptionsStore.getState().setTimeoutChoice(choice)}
                disabled={controlsDisabled}
                accessibilityLabel={t('networkOptions.timeout')}
                testID="download-settings-timeout"
              />
              <Text variant="caption" color="textSecondary">
                {t('networkOptions.timeoutHint')}
              </Text>
            </Box>

            <Box row rtlRow>
              <Button
                title={t('networkOptions.reset')}
                variant="ghost"
                size="small"
                onPress={resetAll}
                disabled={controlsDisabled}
                testID="download-settings-advanced-network-reset"
              />
            </Box>
          </Box>
        ) : null}
      </SettingsSection>
    </SettingsStaggerItem>
  );
});
