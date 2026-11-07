import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { AccessibilityInfo, TextInput, View } from 'react-native';

import { Icon, type IconName } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { FIND_QUERY_MAX } from './find-in-page-script';
import { findCountLabel } from './find-in-page-state';
import { findInPage } from './find-in-page.service';

const ToolButton = memo(function ToolButton({
  icon,
  label,
  hint,
  onPress,
  disabled,
  toggled,
  testID,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** A toggle (Match case, Whole word): announced as a switch with its state. */
  toggled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const isToggle = toggled !== undefined;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={isToggle ? 'switch' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={isToggle ? { checked: toggled, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minWidth: 48,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: toggled ? theme.colors.primary : 'transparent',
        opacity: disabled ? 0.4 : 1,
      }}>
      <Icon name={icon} size={22} color={toggled ? 'onPrimary' : 'secondary'} />
    </Pressable>
  );
});

/**
 * B7 #66–#71 — the find bar over the top of the page: the field and the count ("3 of 12" / "No matches"), then
 * previous, next, Match case, Whole word and close. Enter goes to the next match. Shown while the bar is open.
 */
export const FindInPageBar = memo(function FindInPageBar({ testID = 'find-in-page-bar' }: { testID?: string }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const state = useSyncExternalStore(findInPage.subscribe, findInPage.getState, findInPage.getState);
  const inputRef = useRef<TextInput>(null);
  const label = findCountLabel(state);

  useEffect(() => {
    if (state.open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state.open, state.tabId]);

  // The count is announced as it changes (TalkBack users hear "3 of 12" / "No matches").
  const countText =
    label.kind === 'count'
      ? t('browserFind.count', { current: label.current, total: label.total })
      : label.kind === 'none'
        ? t('browserFind.noMatches')
        : label.kind === 'searching'
          ? t('browserFind.searching')
          : '';
  useEffect(() => {
    if (label.kind === 'count') {
      AccessibilityInfo.announceForAccessibility(
        t('browserFind.countA11y', { current: label.current, total: label.total }),
      );
    } else if (label.kind === 'none') {
      AccessibilityInfo.announceForAccessibility(t('browserFind.noMatches'));
    }
    // Announce each new answer once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label.kind, state.current, state.total]);

  if (!state.open) return null;

  const hasMatches = state.total > 0;
  const unavailable = state.unavailable === 'javascriptOff';

  return (
    <View
      testID={testID}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        elevation: 8,
        backgroundColor: theme.colors.card,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
        <Icon name="text-search" size={20} color="secondary" />
        <TextInput
          ref={inputRef}
          testID={`${testID}-field`}
          value={state.query}
          onChangeText={(text) => findInPage.setQuery(text)}
          onSubmitEditing={() => findInPage.step(1)}
          blurOnSubmit={false}
          returnKeyType="search"
          placeholder={t('browserFind.placeholder')}
          placeholderTextColor={theme.colors.textDisabled}
          accessibilityLabel={t('browserFind.fieldA11y')}
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={FIND_QUERY_MAX}
          editable={!unavailable}
          style={[
            theme.typography.body,
            {
              flex: 1,
              minHeight: 48,
              color: theme.colors.textPrimary,
              textAlign: rtl.textAlign,
              writingDirection: rtl.writingDirection,
            },
          ]}
        />
        {countText ? (
          <Text
            testID={`${testID}-count`}
            variant="caption"
            color={label.kind === 'none' ? 'error' : 'textSecondary'}
            accessibilityLiveRegion="polite">
            {countText}
          </Text>
        ) : null}
        <ToolButton icon="close" label={t('browserFind.close')} onPress={() => findInPage.close()} testID={`${testID}-close`} />
      </View>
      {unavailable ? (
        <Text variant="caption" color="textSecondary" style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
          {t('browserFind.javascriptOff')}
        </Text>
      ) : (
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
          <ToolButton
            icon="chevron-up"
            label={t('browserFind.previous')}
            onPress={() => findInPage.step(-1)}
            disabled={!hasMatches}
            testID={`${testID}-previous`}
          />
          <ToolButton
            icon="chevron-down"
            label={t('browserFind.next')}
            onPress={() => findInPage.step(1)}
            disabled={!hasMatches}
            testID={`${testID}-next`}
          />
          <View style={{ flex: 1 }} />
          <ToolButton
            icon="format-letter-case"
            label={t('browserFind.matchCase')}
            hint={t('browserFind.matchCaseHint')}
            toggled={state.matchCase}
            onPress={() => findInPage.setMatchCase(!state.matchCase)}
            testID={`${testID}-match-case`}
          />
          <ToolButton
            icon="format-letter-matches"
            label={t('browserFind.wholeWord')}
            hint={t('browserFind.wholeWordHint')}
            toggled={state.wholeWord}
            onPress={() => findInPage.setWholeWord(!state.wholeWord)}
            testID={`${testID}-whole-word`}
          />
        </View>
      )}
    </View>
  );
});
