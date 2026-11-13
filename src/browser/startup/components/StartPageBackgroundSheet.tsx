import { memo, useState } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import {
  colorPreset,
  gradientPreset,
  normalizeStartPageBackground,
  readStartPagePhoto,
  START_PAGE_COLORS,
  START_PAGE_GRADIENTS,
  type StartPageBackgroundKind,
} from '../start-page-background';
import { pickStartPagePhoto, removeStartPagePhoto } from '../start-page-photo.service';
import { RadioRow } from './RadioRow';
import { SheetFrame } from './SheetFrame';

export const BACKGROUND_KIND_LABELS: Record<StartPageBackgroundKind, TranslationKey> = {
  theme: 'browserStartup.backgroundTheme',
  color: 'browserStartup.backgroundColor',
  gradient: 'browserStartup.backgroundGradient',
  photo: 'browserStartup.backgroundPhoto',
};

const COLOR_LABELS: Record<string, TranslationKey> = {
  night: 'browserStartup.colorNight',
  forest: 'browserStartup.colorForest',
  ocean: 'browserStartup.colorOcean',
  plum: 'browserStartup.colorPlum',
  rust: 'browserStartup.colorRust',
  slate: 'browserStartup.colorSlate',
};

const GRADIENT_LABELS: Record<string, TranslationKey> = {
  dusk: 'browserStartup.gradientDusk',
  lagoon: 'browserStartup.gradientLagoon',
  ember: 'browserStartup.gradientEmber',
  aurora: 'browserStartup.gradientAurora',
};

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** A 48 dp swatch with a ring when chosen; its name is what TalkBack reads. */
const Swatch = memo(function Swatch({
  label,
  selected,
  colors,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  colors: readonly string[];
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={selected ? t('browserSettings.selectedA11y', { label }) : label}
      onPress={onPress}
      style={{
        width: 52,
        height: 52,
        borderRadius: 26,
        padding: 3,
        borderWidth: 2,
        borderColor: selected ? theme.colors.primary : 'transparent',
      }}>
      <View style={{ flex: 1, borderRadius: 23, overflow: 'hidden', flexDirection: 'column' }}>
        {colors.map((color) => (
          <View key={color} style={{ flex: 1, backgroundColor: color }} />
        ))}
      </View>
    </Pressable>
  );
});

/**
 * B21 #245 — Start page background: Theme (default), a colour, a gradient, or a photo from Android's Photo Picker.
 */
export const StartPageBackgroundSheet = memo(function StartPageBackgroundSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const kind = normalizeStartPageBackground(useSettingsStore((s) => s.startPageBackground));
  const colorId = colorPreset(useSettingsStore((s) => s.startPageBackgroundColor)).id;
  const gradientId = gradientPreset(useSettingsStore((s) => s.startPageBackgroundGradient)).id;
  const photo = readStartPagePhoto(useSettingsStore((s) => s.startPageBackgroundPhoto));
  const [picking, setPicking] = useState(false);

  const pick = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const outcome = await pickStartPagePhoto();
      if (outcome === 'failed') notify(t('browserStartup.backgroundPhotoFailed'));
      else if (outcome === 'unavailable') notify(t('browserStartup.backgroundPhotoUnavailable'));
    } finally {
      setPicking(false);
    }
  };

  const choose = (next: StartPageBackgroundKind) => {
    if (next === 'photo' && !photo) {
      void pick();
      return;
    }
    update('startPageBackground', next);
  };

  const swatchRow = { flexDirection: rtl.rowDirection, flexWrap: 'wrap' as const, gap: 8, paddingVertical: 8 };

  return (
    <SheetFrame
      visible={visible}
      title={t('browserStartup.background')}
      onClose={onClose}
      testID="browser-settings-background-sheet">
      <Text variant="caption" color="textSecondary" style={{ marginBottom: 4 }}>
        {t('browserStartup.backgroundHint')}
      </Text>
      <View accessibilityRole="radiogroup">
        {(['theme', 'color', 'gradient', 'photo'] as const).map((value) => (
          <RadioRow
            key={value}
            label={t(BACKGROUND_KIND_LABELS[value])}
            selected={kind === value}
            onPress={() => choose(value)}
            testID={`background-kind-${value}`}
          />
        ))}
      </View>

      {kind === 'color' ? (
        <View style={swatchRow} accessibilityRole="radiogroup">
          {START_PAGE_COLORS.map((preset) => (
            <Swatch
              key={preset.id}
              label={t(COLOR_LABELS[preset.id])}
              selected={preset.id === colorId}
              colors={[preset.color]}
              onPress={() => update('startPageBackgroundColor', preset.id)}
              testID={`background-color-${preset.id}`}
            />
          ))}
        </View>
      ) : null}

      {kind === 'gradient' ? (
        <View style={swatchRow} accessibilityRole="radiogroup">
          {START_PAGE_GRADIENTS.map((preset) => (
            <Swatch
              key={preset.id}
              label={t(GRADIENT_LABELS[preset.id])}
              selected={preset.id === gradientId}
              colors={preset.colors}
              onPress={() => update('startPageBackgroundGradient', preset.id)}
              testID={`background-gradient-${preset.id}`}
            />
          ))}
        </View>
      ) : null}

      {kind === 'photo' ? (
        <View style={{ gap: 8, paddingVertical: 8 }}>
          <Text variant="caption" color="textSecondary">
            {t('browserStartup.backgroundPhotoHint')}
          </Text>
          <View style={{ flexDirection: rtl.rowDirection, gap: 12 }}>
            <Button
              title={photo ? t('browserStartup.backgroundChangePhoto') : t('browserStartup.backgroundChoosePhoto')}
              leftIcon="image-plus"
              loading={picking}
              onPress={() => void pick()}
              style={{ flex: 1 }}
              testID="background-photo-pick"
            />
            {photo ? (
              <Button
                title={t('common.remove')}
                variant="outline"
                onPress={() => void removeStartPagePhoto()}
                style={{ flex: 1 }}
                testID="background-photo-remove"
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </SheetFrame>
  );
});
