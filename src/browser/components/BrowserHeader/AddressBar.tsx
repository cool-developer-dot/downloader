import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourTargetRef } from '@/tour/tour-targets';

import {
  BROWSER_ADDRESS_BAR_HEIGHT,
  BROWSER_OMNIBOX_FOCUS_DURATION_MS,
  BROWSER_TOUCH_TARGET,
} from '@/browser/constants';
import { useAddressBar } from '@/browser/hooks';
import { normalizeAddressBarPosition } from '@/browser/address-bar/address-bar-settings';
import { splitForDomainHighlight } from '@/browser/address-bar/domain';
import { EngineBadge } from '@/browser/components/EngineBadge';
import { useSearchEngineDefinition } from '@/browser/hooks/useSearchEngineDefinition';
import { useSettingsStore } from '@/store/settings';

import { OmniboxTrailing } from './OmniboxTrailing';
import { ReaderButton } from '@/browser/reader/components/ReaderButton';
import { SecurityIndicator } from './SecurityIndicator';
import { SuggestionOverlay } from './SuggestionOverlay';

export type AddressBarProps = {
  /** Future leading slot inside the omnibox (e.g. voice, QR). */
  leadingSlot?: ReactNode;
  /** Future trailing slot inside the omnibox (e.g. AI). */
  trailingSlot?: ReactNode;
  testID?: string;
};

/**
 * Premium omnibox — intelligent search + navigation entry point.
 * Compact bar while browsing; focused editing lives in SuggestionOverlay.
 */
export const AddressBar = memo(function AddressBar({
  leadingSlot,
  trailingSlot,
  testID = 'browser-address-bar',
}: AddressBarProps) {
  const tourTargetRef = useTourTargetRef('addressBar');
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    inputRef,
    value,
    draft,
    isFocused,
    isLoading,
    showClear,
    showSecurity,
    validationMessage,
    suggestions,
    suggestionsLoading,
    showSuggestions,
    caretAtEnd,
    inputValue,
    inputSelection,
    onSelectionChange,
    onChangeText,
    onFocus,
    onBlur,
    clear,
    submit,
    selectSuggestion,
    dismissSuggestions,
  } = useAddressBar();

  const focusProgress = useSharedValue(0);
  const position = normalizeAddressBarPosition(useSettingsStore((state) => state.addressBarPosition));
  // Follows an engine change in Browser settings (B5).
  const engine = useSearchEngineDefinition();
  // B4 #37: the registrable domain in full colour, the rest dimmed (not while editing).
  const highlight = useMemo(
    () => (!isFocused && value ? splitForDomainHighlight(value) : null),
    [isFocused, value],
  );
  const showEngineBadge = !isFocused && !value;

  useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, {
      duration: BROWSER_OMNIBOX_FOCUS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [focusProgress, isFocused]);

  const containerStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [theme.colors.border, theme.colors.primary],
    );

    return {
      borderColor,
      shadowColor: theme.colors.primary,
      shadowOpacity: focusProgress.value * 0.22,
      shadowRadius: 8 * focusProgress.value,
      shadowOffset: { width: 0, height: 0 },
      elevation: focusProgress.value > 0.5 ? 3 : 0,
      transform: [{ scale: 1 + focusProgress.value * 0.01 }],
    };
  });

  const handleSubmit = useCallback(
    (_event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      submit();
    },
    [submit],
  );

  return (
    <Box flex={1} gap={4}>
      <Animated.View
        ref={tourTargetRef}
        collapsable={false}
        testID={testID}
        accessibilityRole="search"
        style={[
          {
            minHeight: BROWSER_TOUCH_TARGET,
            height: BROWSER_ADDRESS_BAR_HEIGHT,
            borderRadius: theme.radius.full,
            backgroundColor: theme.colors.surface,
            borderWidth: 1.5,
            paddingHorizontal: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          },
          containerStyle,
        ]}>
        {leadingSlot}
        {showEngineBadge ? (
          <Box accessible accessibilityLabel={t('browserAddress.engineA11y', { engine: engine.name })}>
            <EngineBadge engine={engine.id} size={22} />
          </Box>
        ) : null}
        <SecurityIndicator visible={showSecurity} />
        {highlight?.idnWarning ? (
          <Box accessible accessibilityLabel={t('browserAddress.idnWarning')}>
            <Icon name="alert-outline" size={18} color="warning" />
          </Box>
        ) : null}
        <Box flex={1} style={{ minWidth: 0, justifyContent: 'center' }}>
        <TextInput
          value={isFocused ? draft : value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
          onSubmitEditing={handleSubmit}
          editable={!isFocused}
          showSoftInputOnFocus={!isFocused}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="web-search"
          returnKeyType="go"
          enablesReturnKeyAutomatically
          selectTextOnFocus
          placeholder={t('browser.addressPlaceholder')}
          placeholderTextColor={theme.colors.textDisabled}
          accessibilityLabel={
            highlight?.idnWarning
              ? `${t('browser.addressBar')}. ${t('browserAddress.idnWarningShort')}`
              : t('browser.addressBar')
          }
          accessibilityHint={t('browser.addressHint')}
          accessibilityState={{ busy: isLoading, expanded: isFocused }}
          allowFontScaling
          testID={`${testID}-input`}
          style={{
            minHeight: BROWSER_TOUCH_TARGET,
            paddingVertical: 0,
            color: theme.colors.textPrimary,
            // With the highlight drawn on top, the field itself is invisible but still the tap target (Android ignores a
            // transparent text colour here).
            opacity: highlight ? 0 : 1,
            fontSize: theme.typography.bodySmall.fontSize,
            fontFamily: theme.typography.body.fontFamily,
          }}
        />
        {highlight ? (
          <Text
            pointerEvents="none"
            numberOfLines={1}
            ellipsizeMode="tail"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            testID={`${testID}-domain-highlight`}
            style={[
              StyleSheet.absoluteFill,
              {
                textAlignVertical: 'center',
                includeFontPadding: false,
                fontSize: theme.typography.bodySmall.fontSize,
                fontFamily: theme.typography.body.fontFamily,
                color: theme.colors.textDisabled,
                writingDirection: 'ltr',
                textAlign: 'left',
              },
            ]}>
            {highlight.before}
            <Text style={{ color: highlight.idnWarning ? theme.colors.warning : theme.colors.textPrimary }}>
              {highlight.domain}
            </Text>
            {highlight.after}
          </Text>
        ) : null}
        </Box>
        <OmniboxTrailing
          showClear={showClear && !isFocused}
          isLoading={isLoading && !isFocused}
          onClear={clear}
        />
        {/* B15 #161: reader mode, only on article pages. */}
        <ReaderButton hidden={isFocused || isLoading} />
        {trailingSlot}
      </Animated.View>

      {validationMessage ? (
        <Text
          variant="caption"
          color="error"
          accessibilityLiveRegion="polite"
          testID={`${testID}-validation`}>
          {validationMessage}
        </Text>
      ) : null}

      {isLoading && !validationMessage ? (
        <Text
          variant="caption"
          color="textSecondary"
          accessibilityLiveRegion="polite"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
          testID={`${testID}-loading-announce`}>
          {t('browser.loadingPageA11y')}
        </Text>
      ) : null}

      <SuggestionOverlay
        visible={showSuggestions}
        suggestions={suggestions}
        loading={suggestionsLoading}
        query={draft}
        inputValue={inputValue}
        inputSelection={inputSelection}
        caretAtEnd={caretAtEnd}
        position={position}
        inputRef={inputRef}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        onSubmit={submit}
        onClear={clear}
        onSelect={selectSuggestion}
        onDismiss={dismissSuggestions}
      />
    </Box>
  );
});
