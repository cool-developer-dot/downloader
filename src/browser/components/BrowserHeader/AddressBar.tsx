import { memo, useCallback, useEffect, type ReactNode } from 'react';
import {
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
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import {
  BROWSER_ADDRESS_BAR_HEIGHT,
  BROWSER_OMNIBOX_FOCUS_DURATION_MS,
  BROWSER_TOUCH_TARGET,
} from '@/browser/constants';
import { useAddressBar } from '@/browser/hooks';

import { OmniboxTrailing } from './OmniboxTrailing';
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
    onChangeText,
    onFocus,
    onBlur,
    clear,
    submit,
    selectSuggestion,
    dismissSuggestions,
  } = useAddressBar();

  const focusProgress = useSharedValue(0);

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
        <SecurityIndicator visible={showSecurity} />
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
          accessibilityLabel={t('browser.addressBar')}
          accessibilityHint={t('browser.addressHint')}
          accessibilityState={{ busy: isLoading, expanded: isFocused }}
          allowFontScaling
          testID={`${testID}-input`}
          style={{
            flex: 1,
            minHeight: BROWSER_TOUCH_TARGET,
            paddingVertical: 0,
            color: theme.colors.textPrimary,
            fontSize: theme.typography.bodySmall.fontSize,
            fontFamily: theme.typography.body.fontFamily,
          }}
        />
        <OmniboxTrailing
          showClear={showClear && !isFocused}
          isLoading={isLoading && !isFocused}
          onClear={clear}
        />
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
          Loading page
        </Text>
      ) : null}

      <SuggestionOverlay
        visible={showSuggestions}
        suggestions={suggestions}
        loading={suggestionsLoading}
        query={draft}
        inputRef={inputRef}
        onChangeText={onChangeText}
        onSubmit={submit}
        onClear={clear}
        onSelect={selectSuggestion}
        onDismiss={dismissSuggestions}
      />
    </Box>
  );
});
