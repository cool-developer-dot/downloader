import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Search from 'lucide-react-native/icons/search';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { useTranslation } from '@/localization';
import { fontFamilies } from '@/theme/typography';

import { useOnboardingSurfaces } from '../../onboarding-surfaces-context';
import { LIBRARY_COPY, LIBRARY_LAYOUT } from '../constants';

type SearchInteractionProps = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  typedLength: SharedValue<number>;
  converge: SharedValue<number>;
  width: number;
};

/**
 * Premium search field with automated typing — no keyboard.
 */
export const SearchInteraction = memo(function SearchInteraction({
  opacity,
  scale,
  typedLength,
  converge,
  width,
}: SearchInteractionProps) {
  const { t } = useTranslation();
  const surfaces = useOnboardingSurfaces();
  const [query, setQuery] = useState('');
  const [caretOn, setCaretOn] = useState(true);

  useAnimatedReaction(
    () => Math.round(typedLength.value),
    (length) => {
      runOnJS(setQuery)(LIBRARY_COPY.searchQuery.slice(0, Math.max(0, length)));
    },
    [typedLength],
  );

  useEffect(() => {
    const id = setInterval(() => setCaretOn((v) => !v), 480);
    return () => clearInterval(id);
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: converge.value * 6 },
      { scale: scale.value * (1 - converge.value * 0.03) },
    ],
  }));

  const showCaret = query.length > 0 && (query.length < LIBRARY_COPY.searchQuery.length || caretOn);

  return (
    <Animated.View
      style={[
        styles.field,
        {
          width,
          borderColor: surfaces.searchBorder,
          backgroundColor: surfaces.searchBg,
        },
        style,
      ]}
      accessibilityLabel={
        query
          ? `${t('onboarding.librarySearchPlaceholder')}. ${query}`
          : t('onboarding.librarySearchPlaceholder')
      }>
      <Search size={14} color={surfaces.chipIcon} strokeWidth={2} />
      <View style={styles.textRow}>
        {query.length === 0 ? (
          <Text
            style={[
              styles.placeholder,
              { fontFamily: fontFamilies.body, color: surfaces.searchPlaceholder },
            ]}
            maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
            numberOfLines={1}>
            {t('onboarding.librarySearchPlaceholder')}
          </Text>
        ) : (
          <Text
            style={[
              styles.query,
              { fontFamily: fontFamilies.body, color: surfaces.searchText },
            ]}
            maxFontSizeMultiplier={LIBRARY_LAYOUT.maxFontMultiplier}
            numberOfLines={1}>
            {query}
          </Text>
        )}
        {showCaret ? (
          <View style={[styles.caret, { backgroundColor: surfaces.caret }]} />
        ) : (
          <View style={styles.caretSpacer} />
        )}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  field: {
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth + 0.5,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: LIBRARY_LAYOUT.searchMaxWidth,
  },
  textRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeholder: {
    fontSize: 13,
    letterSpacing: 0.15,
  },
  query: {
    fontSize: 13,
    letterSpacing: 0.15,
  },
  caret: {
    width: 1.5,
    height: 14,
    marginLeft: 1,
    borderRadius: 1,
  },
  caretSpacer: {
    width: 1.5,
    height: 14,
    marginLeft: 1,
  },
});
