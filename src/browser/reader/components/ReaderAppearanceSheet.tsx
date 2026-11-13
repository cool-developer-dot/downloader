import { memo } from 'react';
import { Switch, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  normalizeReaderFontFamily,
  normalizeReaderFontSize,
  normalizeReaderLineSpacing,
  normalizeReaderTheme,
  READER_FONT_FAMILIES,
  READER_LINE_SPACINGS,
  READER_PALETTES,
  READER_THEMES,
  readerPalette,
  stepReaderFontSize,
  type ReaderTheme,
} from '../reader-settings';

const THEME_KEYS = { app: 'themeApp', light: 'themeLight', sepia: 'themeSepia', dark: 'themeDark' } as const;
const FONT_KEYS = { sans: 'fontSans', serif: 'fontSerif' } as const;
const SPACING_KEYS = { compact: 'spacingCompact', normal: 'spacingNormal', wide: 'spacingWide' } as const;

/** B15 #172 — the reader's Aa sheet: colours, text size, font, line spacing, pictures. Every change is remembered. */
export const ReaderAppearanceSheet = memo(function ReaderAppearanceSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const readerTheme = normalizeReaderTheme(useSettingsStore((s) => s.readerTheme));
  const fontSize = normalizeReaderFontSize(useSettingsStore((s) => s.readerFontSize));
  const fontFamily = normalizeReaderFontFamily(useSettingsStore((s) => s.readerFontFamily));
  const spacing = normalizeReaderLineSpacing(useSettingsStore((s) => s.readerLineSpacing));
  const images = useSettingsStore((s) => s.readerImages);

  const swatch = (choice: ReaderTheme) => readerPalette(choice, theme.mode === 'dark');

  return (
    <SheetFrame visible={visible} title={t('browserReader.appearance')} onClose={onClose} testID="reader-appearance-sheet">
      <View style={{ gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Text variant="label" color="textSecondary">
            {t('browserReader.colours')}
          </Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
            {READER_THEMES.map((choice) => {
              const palette = choice === 'app' ? null : READER_PALETTES[choice];
              const selected = choice === readerTheme;
              const label = t(`browserReader.${THEME_KEYS[choice]}`);
              return (
                <Pressable
                  key={choice}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={label}
                  onPress={() => update('readerTheme', choice)}
                  testID={`reader-theme-${choice}`}
                  style={{
                    minHeight: 48,
                    minWidth: 72,
                    flexGrow: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: theme.radius.md,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? theme.colors.primary : theme.colors.border,
                    backgroundColor: (palette ?? swatch('app')).background,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <Text variant="bodySmall" style={{ color: (palette ?? swatch('app')).text, textAlign: 'center' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
          <Text variant="body" style={{ flex: 1 }}>
            {t('browserReader.fontSize')}
          </Text>
          <StepButton icon="format-font-size-decrease" label={t('browserReader.smaller')} onPress={() => update('readerFontSize', stepReaderFontSize(fontSize, -1))} testID="reader-font-smaller" />
          <Text variant="body" accessibilityLabel={t('browserReader.fontSizeA11y', { size: fontSize })} style={{ minWidth: 32, textAlign: 'center' }}>
            {fontSize}
          </Text>
          <StepButton icon="format-font-size-increase" label={t('browserReader.bigger')} onPress={() => update('readerFontSize', stepReaderFontSize(fontSize, 1))} testID="reader-font-bigger" />
        </View>

        <Segmented
          title={t('browserReader.font')}
          options={READER_FONT_FAMILIES.map((value) => ({ value, label: t(`browserReader.${FONT_KEYS[value]}`) }))}
          selected={fontFamily}
          onSelect={(value) => update('readerFontFamily', value)}
          testID="reader-font-family"
        />
        <Segmented
          title={t('browserReader.spacing')}
          options={READER_LINE_SPACINGS.map((value) => ({ value, label: t(`browserReader.${SPACING_KEYS[value]}`) }))}
          selected={spacing}
          onSelect={(value) => update('readerLineSpacing', value)}
          testID="reader-spacing"
        />

        <Box style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 12 }}>
          <Text variant="body" style={{ flex: 1 }}>
            {t('browserReader.images')}
          </Text>
          <Switch
            value={images}
            onValueChange={(value) => update('readerImages', value)}
            accessibilityLabel={t('browserReader.images')}
            testID="reader-images-switch"
          />
        </Box>
      </View>
    </SheetFrame>
  );
});

function StepButton({ icon, label, onPress, testID }: { icon: string; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={22} color="default" />
    </Pressable>
  );
}

function Segmented<T extends string>({
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
      <View accessibilityRole="radiogroup" style={{ flexDirection: rtl.rowDirection, gap: 8 }}>
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
                flex: 1,
                minHeight: 48,
                paddingHorizontal: 8,
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
