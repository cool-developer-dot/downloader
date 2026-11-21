import { memo, useCallback, useMemo, useState } from 'react';
import { AccessibilityInfo, ToastAndroid, View } from 'react-native';

import { Text } from '@/components/base/Text';
import { DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { RadioRow } from '@/browser/startup/components/RadioRow';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { StartPageBackgroundSheet } from '@/browser/startup/components/StartPageBackgroundSheet';
import { PercentSlider } from '@/browser/tab-sound/components/PercentSlider';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { ChoiceSheet, type ChoiceOption } from '@/screens/settings/browser-settings/ChoiceSheet';
import { useSettingsStore } from '@/store/settings';

import {
  BRIGHTNESS_MIN,
  BRIGHTNESS_SYSTEM,
  COLOR_FILTERS,
  normalizeColorFilter,
  normalizeForceDark,
  normalizeNightLightStrength,
  normalizePageBrightness,
  normalizePageFontStyle,
  normalizeTextZoom,
  PAGE_FONT_STYLES,
  TEXT_ZOOM_MAX,
  TEXT_ZOOM_MIN,
  TEXT_ZOOM_STEP,
  type ColorFilter,
  type PageFontStyle,
} from '../page-display-settings';
import { SwitchLine } from './PageDisplayControls';

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

/** Every text size the stepper offers (B16 #164), as choice values. */
const TEXT_ZOOM_CHOICES: string[] = [];
for (let zoom = TEXT_ZOOM_MIN; zoom <= TEXT_ZOOM_MAX; zoom += TEXT_ZOOM_STEP) TEXT_ZOOM_CHOICES.push(String(zoom));

type Sheet = 'fontSize' | 'fontStyle' | 'filters' | 'brightness' | 'background' | null;

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Design 39 "Display & Urdu" — the browser's reading-comfort settings (B16 Page display, B21 start page background)
 * as the design's rows. Every value is the settings store's; the pickers are the ones Browser settings uses.
 */
export const DisplayScreen = memo(function DisplayScreen() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const textZoom = normalizeTextZoom(useSettingsStore((s) => s.pageTextZoom));
  const fontStyle = normalizePageFontStyle(useSettingsStore((s) => s.pageFontStyle));
  const urdu = useSettingsStore((s) => s.pageUrduNastaliq !== false);
  const forceZoom = useSettingsStore((s) => s.pageForceZoom === true);
  const reflow = useSettingsStore((s) => s.pageTextReflow === true);
  const forceDark = normalizeForceDark(useSettingsStore((s) => s.pageForceDark));
  const filter = normalizeColorFilter(useSettingsStore((s) => s.pageColorFilter));
  const night = useSettingsStore((s) => s.pageNightLight === true);
  const strength = normalizeNightLightStrength(useSettingsStore((s) => s.pageNightLightStrength));
  const brightness = normalizePageBrightness(useSettingsStore((s) => s.pageBrightness));

  const [sheet, setSheet] = useState<Sheet>(null);
  const close = useCallback(() => setSheet(null), []);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  const zoomOptions = useMemo(
    (): ChoiceOption<string>[] => TEXT_ZOOM_CHOICES.map((value) => ({ value, label: `${value}%` })),
    [],
  );
  const fontOptions = useMemo(
    (): ChoiceOption<PageFontStyle>[] => PAGE_FONT_STYLES.map((value) => ({ value, label: t(FONT_LABELS[value]) })),
    [t],
  );

  return (
    <DsScreen testID="display-screen">
      <DsHeader
        title={t('lightDisplay.title')}
        subtitle={t('lightDisplay.subtitle')}
        action={{ icon: 'settings', accessibilityLabel: t('lightDisplay.settingsA11y'), onPress: openSettings, testID: 'display-settings' }}
      />
      <DsRowGroup testID="display-rows">
        <DsRow
          icon="type"
          title={t('lightDisplay.fontSize')}
          subtitle={`${textZoom}%`}
          onPress={() => setSheet('fontSize')}
          accessibilityLabel={`${t('lightDisplay.fontSize')}, ${t('browserPageDisplay.percentA11y', { value: textZoom })}`}
          testID="display-font-size"
        />
        <DsRow
          icon="type"
          title={t('lightDisplay.fontStyle')}
          subtitle={t(FONT_LABELS[fontStyle])}
          onPress={() => setSheet('fontStyle')}
          testID="display-font-style"
        />
        <DsRow
          icon="pencil"
          title={t('lightDisplay.urduFont')}
          toggle={{ value: urdu, onValueChange: (next) => update('pageUrduNastaliq', next), accessibilityLabel: t('browserPageDisplay.urdu') }}
          testID="display-urdu-font"
        />
        {/* Urdu typing works in every field (the keyboard's job); there is no off state, so the switch stays on. */}
        <DsRow
          icon="terminal"
          title={t('lightDisplay.urduInput')}
          toggle={{ value: true, onValueChange: () => toast(t('lightDisplay.urduInputAlwaysOn')), accessibilityLabel: t('lightDisplay.urduInput') }}
          testID="display-urdu-input"
        />
        <DsRow
          icon="search"
          title={t('lightDisplay.zoomReflow')}
          toggle={{
            value: forceZoom && reflow,
            onValueChange: (next) => {
              update('pageForceZoom', next);
              update('pageTextReflow', next);
            },
          }}
          testID="display-zoom-reflow"
        />
        <DsRow
          icon="moon"
          title={t('lightDisplay.forceDark')}
          toggle={{ value: forceDark !== 'off', onValueChange: (next) => update('pageForceDark', next ? 'on' : 'off') }}
          testID="display-force-dark"
        />
        <DsRow icon="sliders-vertical" title={t('lightDisplay.filters')} onPress={() => setSheet('filters')} testID="display-filters" />
        <DsRow icon="sun" title={t('lightDisplay.brightness')} onPress={() => setSheet('brightness')} testID="display-brightness" />
        <DsRow icon="image" title={t('lightDisplay.background')} onPress={() => setSheet('background')} testID="display-background" />
      </DsRowGroup>

      <ChoiceSheet
        visible={sheet === 'fontSize'}
        title={t('lightDisplay.fontSize')}
        options={zoomOptions}
        value={String(textZoom)}
        onSelect={(value) => update('pageTextZoom', normalizeTextZoom(Number(value)))}
        onClose={close}
        testID="display-font-size-sheet"
      />
      <ChoiceSheet
        visible={sheet === 'fontStyle'}
        title={t('lightDisplay.fontStyle')}
        options={fontOptions}
        value={fontStyle}
        onSelect={(value) => update('pageFontStyle', value)}
        onClose={close}
        testID="display-font-style-sheet"
      />
      <SheetFrame visible={sheet === 'filters'} title={t('lightDisplay.filters')} onClose={close} testID="display-filters-sheet">
        <View style={{ gap: 16 }}>
          <View style={{ gap: 8 }}>
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
                  testID={`display-filter-${value}`}
                />
              ))}
            </View>
          </View>
          <SwitchLine
            title={t('browserPageDisplay.nightLight')}
            hint={t('browserPageDisplay.nightLightHint')}
            value={night}
            onChange={(value) => update('pageNightLight', value)}
            testID="display-night"
          />
          {night ? (
            <PercentSlider
              value={strength}
              onChange={(value) => update('pageNightLightStrength', normalizeNightLightStrength(value))}
              accessibilityLabel={t('browserPageDisplay.nightStrength', { value: strength })}
              testID="display-night-strength"
            />
          ) : null}
        </View>
      </SheetFrame>
      <SheetFrame visible={sheet === 'brightness'} title={t('lightDisplay.brightness')} onClose={close} testID="display-brightness-sheet">
        <View style={{ gap: 12 }}>
          <SwitchLine
            title={t('browserPageDisplay.phoneBrightness')}
            hint={t('browserPageDisplay.brightnessHint')}
            value={brightness === BRIGHTNESS_SYSTEM}
            onChange={(value) => update('pageBrightness', value ? BRIGHTNESS_SYSTEM : 60)}
            testID="display-brightness-system"
          />
          {brightness !== BRIGHTNESS_SYSTEM ? (
            <PercentSlider
              value={brightness}
              onChange={(value) => update('pageBrightness', Math.max(BRIGHTNESS_MIN, value))}
              accessibilityLabel={t('browserPageDisplay.brightness', { value: brightness })}
              testID="display-brightness-slider"
            />
          ) : null}
        </View>
      </SheetFrame>
      <StartPageBackgroundSheet visible={sheet === 'background'} onClose={close} />
    </DsScreen>
  );
});
