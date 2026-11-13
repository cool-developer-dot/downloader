import { memo, useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  type ListRenderItem,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
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
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';
import type { OmniboxSuggestion } from '@/browser/suggestions';
import {
  BROWSER_ADDRESS_BAR_HEIGHT,
  BROWSER_OMNIBOX_FOCUS_DURATION_MS,
  BROWSER_TOUCH_TARGET,
} from '@/browser/constants';
import { EngineBadge } from '@/browser/components/EngineBadge';
import { useSearchEngineDefinition } from '@/browser/hooks/useSearchEngineDefinition';

import { OmniboxTrailing } from './OmniboxTrailing';
import { SuggestionItem } from './SuggestionItem';
import { inputDirectionStyle } from '@/utils/text-direction';

export type SuggestionOverlayProps = {
  visible: boolean;
  suggestions: OmniboxSuggestion[];
  loading: boolean;
  /** What the user typed (suggestions, highlight, clear button). */
  query: string;
  /** What the field shows: `query`, or `query` + an inline completion (B4 #24). Defaults to `query`. */
  inputValue?: string;
  /** The completed part, selected. */
  inputSelection?: { start: number; end: number };
  /** The field was prefilled (B5 Search this site): caret at the end, nothing selected. */
  caretAtEnd?: boolean;
  /** B4 #28: with the address bar at the bottom, the field sits above the keyboard and suggestions open upward. */
  position?: 'top' | 'bottom';
  inputRef: RefObject<TextInputType | null>;
  onChangeText: (text: string) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onSubmit: () => void;
  onClear: () => void;
  onSelect: (item: OmniboxSuggestion) => void;
  onDismiss: () => void;
  testID?: string;
};

const PANEL_GAP = 8;

/**
 * Focused omnibox sheet — owns the TextInput so suggestions never steal typing focus. The suggestion list is sized
 * to the space the keyboard leaves, so no row sits behind the keyboard.
 */
export const SuggestionOverlay = memo(function SuggestionOverlay({
  visible,
  suggestions,
  loading,
  query,
  inputValue,
  inputSelection,
  caretAtEnd = false,
  position = 'top',
  inputRef,
  onChangeText,
  onSelectionChange,
  onSubmit,
  onClear,
  onSelect,
  onDismiss,
  testID = 'suggestion-overlay',
}: SuggestionOverlayProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const progress = useSharedValue(0);
  const focusedOnceRef = useRef(false);
  // A Modal window is not resized for the keyboard: the field and list stay above it.
  const keyboardHeight = useKeyboardHeight(visible);
  const bottom = position === 'bottom';
  const engine = useSearchEngineDefinition();

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
    transform: [{ translateY: (1 - progress.value) * (bottom ? 8 : -8) }],
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

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      onSelectionChange?.(event.nativeEvent.selection);
    },
    [onSelectionChange],
  );

  useTourBlocker(visible);

  if (!visible) {
    return null;
  }

  const showEmpty = !loading && suggestions.length === 0 && query.trim().length > 0;
  const showClear = query.length > 0;
  const bottomInset = keyboardHeight > 0 ? keyboardHeight : insets.bottom;
  // Room for the list: the window minus the field, the keyboard and the safe areas.
  const listMaxHeight = Math.max(
    120,
    window.height - insets.top - bottomInset - BROWSER_ADDRESS_BAR_HEIGHT - PANEL_GAP * 4,
  );

  const field = (
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
      <Box accessibilityLabel={t('browserAddress.engineA11y', { engine: engine.name })} accessible>
        <EngineBadge engine={engine.id} size={22} />
      </Box>
      <TextInput
        ref={inputRef}
        value={inputValue ?? query}
        selection={inputSelection}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange ? handleSelectionChange : undefined}
        onSubmitEditing={handleSubmit}
        onKeyPress={handleKeyPress}
        blurOnSubmit={false}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="web-search"
        returnKeyType="go"
        enablesReturnKeyAutomatically
        selectTextOnFocus={!caretAtEnd}
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
          // B24 #271: caret and alignment follow what is typed (an Urdu search right, an address left).
          ...inputDirectionStyle(inputValue ?? query, rtl.isRtl),
        }}
      />
      <OmniboxTrailing showClear={showClear} isLoading={false} onClear={onClear} />
    </Box>
  );

  const list = (
    <Box
      style={{
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: 'hidden',
        maxHeight: listMaxHeight,
        ...theme.elevation.md,
      }}
      accessibilityRole="list"
      accessibilityLabel={t('browser.suggestionsA11y')}
      accessibilityLiveRegion="polite">
      {loading && suggestions.length === 0 ? (
        <Box center py={24} gap={8}>
          <Loader size="small" />
          <Text variant="caption" color="textSecondary">
            {t('browserAddress.finding')}
          </Text>
        </Box>
      ) : null}

      {showEmpty ? (
        <Box center py={28} px={20} gap={6}>
          <Text variant="bodySmall" align="center">
            {t('browserAddress.noMatches')}
          </Text>
          <Text variant="caption" color="textSecondary" align="center">
            {t('browserAddress.noMatchesHint', { engine: engine.name })}
          </Text>
        </Box>
      ) : null}

      {suggestions.length > 0 ? (
        <FlatList
          data={suggestions}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          // At the bottom the best match sits next to the field.
          inverted={bottom}
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
            {t('browserAddress.startTyping')}
          </Text>
        </Box>
      ) : null}
    </Box>
  );

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
            bottom
              ? {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: bottomInset + PANEL_GAP,
                  paddingHorizontal: 12,
                }
              : {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  paddingTop: insets.top + PANEL_GAP,
                  paddingHorizontal: 12,
                },
            panelStyle,
          ]}>
          {bottom ? (
            <>
              {list}
              <Box mt={PANEL_GAP}>{field}</Box>
            </>
          ) : (
            <>
              {field}
              <Box mt={PANEL_GAP}>{list}</Box>
            </>
          )}
        </Animated.View>
      </Box>
    </Modal>
  );
});
