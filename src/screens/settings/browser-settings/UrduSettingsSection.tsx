import { memo, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, ToastAndroid, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Switch } from '@/components/inputs/Switch';
import { TextField } from '@/components/inputs/TextField';
import { hijriSource } from '@/browser/calendar/components/StartPageCards';
import { clampHijriAdjust } from '@/browser/calendar/hijri';
import { CITIES, parseCoordinates } from '@/browser/prayer/prayer-times';
import { hasUrduKeyboard, openKeyboardSettings } from '@/browser/urdu/search-widget.service';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

import { SettingsRow, SettingsSection } from '../components';

/** B24 — Browser settings: Language input (#271 keyboard hint) and the start page's calendar and prayer times. */
export const UrduSettingsSection = memo(function UrduSettingsSection() {
  return (
    <>
      <LanguageInputSection />
      <StartCardsSection />
    </>
  );
});

const LanguageInputSection = memo(function LanguageInputSection() {
  const { t } = useTranslation();
  const [urdu, setUrdu] = useState<boolean | null>(() => hasUrduKeyboard());
  // Checked again when the user comes back from Android's keyboard settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setUrdu(hasUrduKeyboard());
    });
    return () => sub.remove();
  }, []);
  if (urdu === null) return null;
  return (
    <SettingsSection testID="browser-settings-language-input" title={t('browserUrdu.inputSection')} icon="keyboard-outline">
      {urdu ? (
        <SettingsRow title={t('browserUrdu.keyboardOn')} description={t('browserUrdu.keyboardOnHint')} icon="check-circle-outline" showDivider={false} />
      ) : (
        <SettingsRow
          title={t('browserUrdu.addKeyboard')}
          description={t('browserUrdu.addKeyboardHint')}
          icon="keyboard-outline"
          showDivider={false}
          testID="browser-settings-add-urdu-keyboard"
          onPress={() => {
            void withExpectedSystemScreen(async () => {
              const ok = openKeyboardSettings();
              if (!ok) {
                const message = t('browserUrdu.keyboardSettingsFailed');
                if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
                AccessibilityInfo.announceForAccessibility(message);
              }
              await new Promise((resolve) => setTimeout(resolve, 1500));
            });
          }}
        />
      )}
    </SettingsSection>
  );
});

const StartCardsSection = memo(function StartCardsSection() {
  const { t, language } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const showCalendar = useSettingsStore((s) => s.showHijriCalendar === true);
  const adjust = useSettingsStore((s) => clampHijriAdjust(s.hijriAdjust));
  const showPrayer = useSettingsStore((s) => s.showPrayerTimes === true);
  const city = useSettingsStore((s) => s.prayerCity || 'lahore');
  const coords = useSettingsStore((s) => s.prayerCoords ?? '');
  const asr = useSettingsStore((s) => (s.prayerAsr === 'shafi' ? 'shafi' : 'hanafi'));
  const [coordsDraft, setCoordsDraft] = useState(coords);
  const coordsInvalid = coordsDraft.trim() !== '' && parseCoordinates(coordsDraft) == null;

  return (
    <SettingsSection testID="browser-settings-start-cards" title={t('browserUrdu.startCardsSection')} icon="calendar-month-outline">
      <SettingsRow
        title={t('browserUrdu.showCalendar')}
        description={`${t('browserUrdu.showCalendarHint')} · ${t(hijriSource() === 'intl' ? 'browserUrdu.hijriSourceIntl' : 'browserUrdu.hijriSourceBundled')}`}
        icon="calendar-month-outline"
        trailing={<Switch value={showCalendar} onValueChange={(v) => update('showHijriCalendar', v)} accessibilityLabel={t('browserUrdu.showCalendar')} />}
      />
      {showCalendar ? (
        <ChoiceRow
          label={t('browserUrdu.hijriAdjust')}
          hint={t('browserUrdu.hijriAdjustHint')}
          options={[-2, -1, 0, 1, 2].map((d) => ({ id: String(d), label: t('browserUrdu.hijriAdjustValue', { days: d > 0 ? `+${d}` : String(d) }) }))}
          value={String(adjust)}
          onChange={(v) => update('hijriAdjust', Number(v))}
        />
      ) : null}
      <SettingsRow
        title={t('browserUrdu.showPrayer')}
        description={`${t('browserUrdu.showPrayerHint')} · ${t('browserUrdu.prayerMethod')}`}
        icon="mosque"
        showDivider={showPrayer}
        trailing={<Switch value={showPrayer} onValueChange={(v) => update('showPrayerTimes', v)} accessibilityLabel={t('browserUrdu.showPrayer')} />}
      />
      {showPrayer ? (
        <>
          <ChoiceRow
            label={t('browserUrdu.prayerCity')}
            options={CITIES.map((c) => ({ id: c.id, label: language === 'ur' ? c.ur : c.en }))}
            value={city}
            onChange={(v) => update('prayerCity', v)}
          />
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <TextField
              label={t('browserUrdu.prayerCoords')}
              helperText={coordsInvalid ? t('browserUrdu.prayerCoordsInvalid') : t('browserUrdu.prayerCoordsHint')}
              value={coordsDraft}
              onChangeText={setCoordsDraft}
              onEndEditing={() => update('prayerCoords', coordsDraft.trim().slice(0, 60))}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              testID="browser-settings-prayer-coords"
            />
          </View>
          <ChoiceRow
            label={t('browserUrdu.prayerAsr')}
            options={[
              { id: 'hanafi', label: t('browserUrdu.asrHanafi') },
              { id: 'shafi', label: t('browserUrdu.asrShafi') },
            ]}
            value={asr}
            onChange={(v) => update('prayerAsr', v === 'shafi' ? 'shafi' : 'hanafi')}
          />
        </>
      ) : null}
    </SettingsSection>
  );
});

function ChoiceRow({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { rtl } = useTranslation();
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 4 }}>
      <Text variant="body" style={{ textAlign: rtl.textAlign }}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {hint}
        </Text>
      ) : null}
      <View style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 4 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === o.id, selected: value === o.id }}
            onPress={() => onChange(o.id)}
            style={{ minHeight: 48, minWidth: 48, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="label" color={value === o.id ? 'primary' : 'textSecondary'}>
              {value === o.id ? `● ${o.label}` : o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
