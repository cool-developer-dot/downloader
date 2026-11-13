import { memo, type ReactNode } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Switch } from '@/components/inputs/Switch';
import { PercentSlider } from '@/browser/tab-sound/components/PercentSlider';
import { RadioRow } from '@/browser/startup/components/RadioRow';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  BRIGHTNESS_MIN,
  BRIGHTNESS_SYSTEM,
  COLOR_FILTERS,
  FORCE_DARK_MODES,
  normalizeColorFilter,
  normalizeForceDark,
  normalizeNightLightStrength,
  normalizePageBrightness,
  normalizePageFontStyle,
  PAGE_FONT_STYLES,
  type ColorFilter,
  type ForceDarkMode,
  type PageFontStyle,
} from '../page-display-settings';

const DARK_LABELS: Record<ForceDarkMode, TranslationKey> = {
  off: 'browserPageDisplay.darkOff',
  on: 'browserPageDisplay.darkOn',
  app: 'browserPageDisplay.darkApp',
};
const FONT_LABELS: Record<PageFontStyle, TranslationKey> = {
  default: 'browserPageDisplay.fontDefault',
  sans: 'browserPageDisplay.fontSans',
  serif: 'browserPageDisplay.fontSerif',
  monospace: 'browserPageDisplay.fontMono',
};
const FILTER_LABELS: Record<ColorFilter, TranslationKey> = {
  none: 'browserPageDisplay.filterNone',
  grayscale: 'browserPageDisplay.filterGrayscale',
  protanopia: 'browserPageDisplay.filterProtanopia',
  deuteranopia: 'browserPageDisplay.filterDeuteranopia',
  tritanopia: 'browserPageDisplay.filterTritanopia',
};

/** A titled group of choices as buttons in a row (radio group; ≥ 48 dp; wraps). */
export function Segmented<T extends string>({
  title,
  options,
  selected,
  onSelect,
  testID,
}: {
  title: string;
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  testID: string;
}) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label" color="textSecondary">
        {title}
      </Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={option.label}
              onPress={() => onSelect(option.value)}
              testID={`${testID}-${option.value}`}
              style={{
                flexGrow: 1,
                minWidth: 72,
                minHeight: 48,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: theme.radius.md,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? theme.colors.primary : theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text variant="bodySmall" color={isSelected ? 'primary' : 'textPrimary'} style={{ textAlign: 'center' }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A label with − value + buttons (≥ 48 dp). */
export function Stepper({
  title,
  value,
  valueA11y,
  onStep,
  canDecrease,
  canIncrease,
  testID,
}: {
  title: string;
  value: string;
  valueA11y: string;
  onStep: (direction: 1 | -1) => void;
  canDecrease: boolean;
  canIncrease: boolean;
  testID: string;
}) {
  const { t, rtl } = useTranslation();
  const button = (direction: 1 | -1, icon: string, label: string, enabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={() => onStep(direction)}
      testID={`${testID}-${direction > 0 ? 'up' : 'down'}`}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: enabled ? 1 : 0.4 }}>
      <Icon name={icon} size={22} color="default" />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4, minHeight: 48 }}>
      <Text variant="body" style={{ flex: 1 }}>
        {title}
      </Text>
      {button(-1, 'minus', t('browserPageDisplay.decrease', { setting: title }), canDecrease)}
      <Text variant="body" accessibilityLabel={valueA11y} style={{ minWidth: 64, textAlign: 'center' }} testID={`${testID}-value`}>
        {value}
      </Text>
      {button(1, 'plus', t('browserPageDisplay.increase', { setting: title }), canIncrease)}
    </View>
  );
}

export function SwitchLine({
  title,
  hint,
  value,
  onChange,
  testID,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID: string;
}) {
  const { rtl } = useTranslation();
  return (
    <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text variant="body">{title}</Text>
        {hint ? (
          <Text variant="caption" color="textSecondary">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} accessibilityHint={hint} testID={testID} />
    </View>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <View style={{ gap: 12 }}>{children}</View>;
}

/**
 * B16 — the Page display choices that apply to every site (Browser settings → Page display, and the browser's Aa panel):
 * force dark, font style, Urdu in Nastaliq, colour filter, night light, brightness, text reflow, force enable zoom.
 */
export const PageDisplayGlobalControls = memo(function PageDisplayGlobalControls({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const forceDark = normalizeForceDark(useSettingsStore((s) => s.pageForceDark));
  const fontStyle = normalizePageFontStyle(useSettingsStore((s) => s.pageFontStyle));
  const urdu = useSettingsStore((s) => s.pageUrduNastaliq !== false);
  const filter = normalizeColorFilter(useSettingsStore((s) => s.pageColorFilter));
  const night = useSettingsStore((s) => s.pageNightLight === true);
  const strength = normalizeNightLightStrength(useSettingsStore((s) => s.pageNightLightStrength));
  const brightness = normalizePageBrightness(useSettingsStore((s) => s.pageBrightness));
  const reflow = useSettingsStore((s) => s.pageTextReflow === true);
  const forceZoom = useSettingsStore((s) => s.pageForceZoom === true);

  return (
    <View style={{ gap: 20 }}>
      <Segmented
        title={t('browserPageDisplay.forceDark')}
        options={FORCE_DARK_MODES.map((value) => ({ value, label: t(DARK_LABELS[value]) }))}
        selected={forceDark}
        onSelect={(value) => update('pageForceDark', value)}
        testID={`${testID}-dark`}
      />
      <Segmented
        title={t('browserPageDisplay.fontStyle')}
        options={PAGE_FONT_STYLES.map((value) => ({ value, label: t(FONT_LABELS[value]) }))}
        selected={fontStyle}
        onSelect={(value) => update('pageFontStyle', value)}
        testID={`${testID}-font`}
      />
      <SwitchLine
        title={t('browserPageDisplay.urdu')}
        hint={t('browserPageDisplay.urduHint')}
        value={urdu}
        onChange={(value) => update('pageUrduNastaliq', value)}
        testID={`${testID}-urdu`}
      />
      <Group>
        <Text variant="label" color="textSecondary">
          {t('browserPageDisplay.colorFilter')}
        </Text>
        <View accessibilityRole="radiogroup">
          {COLOR_FILTERS.map((value) => (
            <RadioRow
              key={value}
              label={t(FILTER_LABELS[value])}
              selected={filter === value}
              onPress={() => update('pageColorFilter', value)}
              testID={`${testID}-filter-${value}`}
            />
          ))}
        </View>
      </Group>
      <Group>
        <SwitchLine
          title={t('browserPageDisplay.nightLight')}
          hint={t('browserPageDisplay.nightLightHint')}
          value={night}
          onChange={(value) => update('pageNightLight', value)}
          testID={`${testID}-night`}
        />
        {night ? (
          <PercentSlider
            value={strength}
            onChange={(value) => update('pageNightLightStrength', normalizeNightLightStrength(value))}
            accessibilityLabel={t('browserPageDisplay.nightStrength', { value: strength })}
            testID={`${testID}-night-strength`}
          />
        ) : null}
      </Group>
      <Group>
        <SwitchLine
          title={t('browserPageDisplay.phoneBrightness')}
          hint={t('browserPageDisplay.brightnessHint')}
          value={brightness === BRIGHTNESS_SYSTEM}
          onChange={(value) => update('pageBrightness', value ? BRIGHTNESS_SYSTEM : 60)}
          testID={`${testID}-brightness-system`}
        />
        {brightness !== BRIGHTNESS_SYSTEM ? (
          <PercentSlider
            value={brightness}
            onChange={(value) => update('pageBrightness', Math.max(BRIGHTNESS_MIN, value))}
            accessibilityLabel={t('browserPageDisplay.brightness', { value: brightness })}
            testID={`${testID}-brightness`}
          />
        ) : null}
      </Group>
      <SwitchLine
        title={t('browserPageDisplay.reflow')}
        hint={t('browserPageDisplay.reflowHint')}
        value={reflow}
        onChange={(value) => update('pageTextReflow', value)}
        testID={`${testID}-reflow`}
      />
      <SwitchLine
        title={t('browserPageDisplay.forceZoom')}
        hint={t('browserPageDisplay.forceZoomHint')}
        value={forceZoom}
        onChange={(value) => update('pageForceZoom', value)}
        testID={`${testID}-force-zoom`}
      />
    </View>
  );
});
