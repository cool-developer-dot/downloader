import { memo, useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  type ListRenderItem,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSubmitEditingEventData,
  type TextInput as TextInputType,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { Loader } from '@/components/common/Loader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { OmniboxSuggestion } from '@/browser/suggestions';
import {
  BROWSER_ADDRESS_BAR_HEIGHT,
  BROWSER_OMNIBOX_FOCUS_DURATION_MS,
  BROWSER_TOUCH_TARGET,
} from '@/browser/constants';

import { OmniboxTrailing } from './OmniboxTrailing';
import { SuggestionItem } from './SuggestionItem';

export type SuggestionOverlayProps = {
  visible: boolean;
  suggestions: OmniboxSuggestion[];
  loading: boolean;
  query: string;
  inputRef: RefObject<TextInputType | null>;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onSelect: (item: OmniboxSuggestion) => void;
  onDismiss: () => void;
  testID?: string;
};

/**
 * Focused omnibox sheet — owns the TextInput so suggestions never steal typing focus.
 */
export const SuggestionOverlay = memo(function SuggestionOverlay({
  visible,
  suggestions,
  loading,
  query,
  inputRef,
  onChangeText,
  onSubmit,
  onClear,
  onSelect,
  onDismiss,
  testID = 'suggestion-overlay',
}: SuggestionOverlayProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const focusedOnceRef = useRef(false);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: BROWSER_OMNIBOX_FOCUS_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });

    if (visible) {
      focusedOnceRef.current = false;
      const timer = setTimeout(() => {
        if (!focusedOnceRef.current) {
          focusedOnceRef.current = true;
          inputRef.current?.focus();
        }
      }, 40);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [inputRef, progress, visible]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }));

  const renderItem: ListRenderItem<OmniboxSuggestion> = useCallback(
    ({ item }) => (
      <SuggestionItem
        item={item}
        onPress={onSelect}
        testID={`suggestion-item-${item.id}`}
      />
    ),
    [onSelect],
  );

  const keyExtractor = useCallback((item: OmniboxSuggestion) => item.id, []);

  const handleDismiss = useCallback(() => {
    Keyboard.dismiss();
    onDismiss();
  }, [onDismiss]);

  const handleSubmit = useCallback(
    (_event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      onSubmit();
    },
    [onSubmit],
  );

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      // Android URL / Go keyboards sometimes skip onSubmitEditing inside Modal.
      if (event.nativeEvent.key === 'Enter') {
        onSubmit();
      }
    },
    [onSubmit],
  );

  if (!visible) {
    return null;
  }

  const showEmpty = !loading && suggestions.length === 0 && query.trim().length > 0;
  const showClear = query.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleDismiss}
      statusBarTranslucent>
      <Box style={StyleSheet.absoluteFill} testID={testID}>
        <Pressable
          accessibilityLabel={t('browser.dismissSuggestions')}
          accessibilityRole="button"
          onPress={handleDismiss}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.colors.overlay },
          ]}
        />

        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              paddingTop: insets.top + 8,
              paddingHorizontal: 12,
              maxHeight: '78%',
            },
            panelStyle,
          ]}>
          <Box
            row
            style={{
              minHeight: BROWSER_TOUCH_TARGET,
              height: BROWSER_ADDRESS_BAR_HEIGHT,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.surface,
              borderWidth: 1.5,
              borderColor: theme.colors.primary,
              paddingHorizontal: 12,
              alignItems: 'center',
              gap: 8,
              ...theme.elevation.md,
            }}
            accessibilityRole="search">
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={onChangeText}
              onSubmitEditing={handleSubmit}
              onKeyPress={handleKeyPress}
              blurOnSubmit={false}
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
              accessibilityState={{ busy: loading }}
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
            <OmniboxTrailing showClear={showClear} isLoading={false} onClear={onClear} />
          </Box>

          <Box
            mt={8}
            style={{
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.card,
              borderWidth: 1,
              borderColor: theme.colors.border,
              overflow: 'hidden',
              maxHeight: '100%',
              ...theme.elevation.md,
            }}
            accessibilityRole="list"
            accessibilityLabel={t('browser.suggestionsA11y')}
            accessibilityLiveRegion="polite">
            {loading && suggestions.length === 0 ? (
              <Box center py={24} gap={8}>
                <Loader size="small" />
                <Text variant="caption" color="textSecondary">
                  Finding suggestions…
                </Text>
              </Box>
            ) : null}

            {showEmpty ? (
              <Box center py={28} px={20} gap={6}>
                <Text variant="bodySmall" align="center">
                  No matching pages
                </Text>
                <Text variant="caption" color="textSecondary" align="center">
                  Try a website address or search Google
                </Text>
              </Box>
            ) : null}

            {suggestions.length > 0 ? (
              <FlatList
                data={suggestions}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                removeClippedSubviews
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4, paddingBottom: 8 }}
              />
            ) : null}

            {!loading && suggestions.length === 0 && query.trim().length === 0 ? (
              <Box center py={24} px={20}>
                <Text variant="caption" color="textSecondary" align="center">
                  Start typing to search history, bookmarks, and the web
                </Text>
              </Box>
            ) : null}
          </Box>
        </Animated.View>
      </Box>
    </Modal>
  );
});
