import { memo, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { toUrduDigits } from '@/utils/text-direction';

import {
  cityById,
  formatCountdown,
  formatPrayerTime,
  nextPrayer,
  placeDate,
  prayerTimesFor,
  resolvePlace,
  type PrayerName,
} from '../../prayer/prayer-times';
import {
  GREGORIAN_MONTHS_EN,
  GREGORIAN_MONTHS_UR,
  HIJRI_MONTHS_EN,
  HIJRI_MONTHS_UR,
  makeHijriConverter,
  monthGrid,
  type HijriDate,
} from '../hijri';

/** One converter for the app's run (Intl checked once). */
const hijri = makeHijriConverter();

export function hijriSource(): 'intl' | 'bundled' {
  return hijri.source;
}

function useNow(stepMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}

/** B24 #269 / #270 — the start page's date and prayer cards (each only when switched on in Browser settings). */
export const StartPageCards = memo(function StartPageCards() {
  const showCalendar = useSettingsStore((s) => s.showHijriCalendar === true);
  const showPrayer = useSettingsStore((s) => s.showPrayerTimes === true);
  if (!showCalendar && !showPrayer) return null;
  return (
    <View style={{ gap: 12, marginTop: 16 }} testID="start-page-cards">
      {showCalendar ? <CalendarCard /> : null}
      {showPrayer ? <PrayerCard /> : null}
    </View>
  );
});

function useDigits() {
  const { language } = useTranslation();
  return language === 'ur' ? toUrduDigits : (s: string) => s;
}

const CalendarCard = memo(function CalendarCard() {
  const theme = useTheme();
  const { t, rtl, language } = useTranslation();
  const digits = useDigits();
  const adjust = useSettingsStore((s) => s.hijriAdjust ?? 0);
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const h = hijri.convert(y, m, d, adjust);
  const ur = language === 'ur';
  const gregorian = t('browserUrdu.gregorianDate', { day: digits(String(d)), month: (ur ? GREGORIAN_MONTHS_UR : GREGORIAN_MONTHS_EN)[m - 1], year: digits(String(y)) });
  const hijriText = hijriLabel(h, ur, digits, t);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserUrdu.calendarCardA11y', { gregorian, hijri: hijriText })}
        onPress={() => setOpen(true)}
        testID="start-page-calendar"
        style={{ minHeight: 48, padding: 12, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
        <Icon name="calendar-month-outline" size={24} color="primary" />
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ textAlign: rtl.textAlign }}>
            {gregorian}
          </Text>
          <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {hijriText}
          </Text>
        </View>
      </Pressable>
      {open ? <MonthSheet visible onClose={() => setOpen(false)} today={{ y, m, d }} adjust={adjust} /> : null}
    </>
  );
});

function hijriLabel(h: HijriDate, ur: boolean, digits: (s: string) => string, t: ReturnType<typeof useTranslation>['t']): string {
  return t('browserUrdu.hijriDate', { day: digits(String(h.day)), month: (ur ? HIJRI_MONTHS_UR : HIJRI_MONTHS_EN)[h.month - 1], year: digits(String(h.year)) });
}

const MonthSheet = memo(function MonthSheet({
  visible,
  onClose,
  today,
  adjust,
}: {
  visible: boolean;
  onClose: () => void;
  today: { y: number; m: number; d: number };
  adjust: number;
}) {
  const theme = useTheme();
  const { t, rtl, language } = useTranslation();
  const digits = useDigits();
  const ur = language === 'ur';
  // Mounted only while open, so it always starts on today's month.
  const [shown, setShown] = useState({ y: today.y, m: today.m });
  const weeks = useMemo(() => monthGrid(shown.y, shown.m, (y, m, d) => hijri.convert(y, m, d, adjust)), [adjust, shown.m, shown.y]);
  const hijriMonths = useMemo(() => {
    const names = new Set<string>();
    for (const c of weeks.flat()) if (c) names.add(`${(ur ? HIJRI_MONTHS_UR : HIJRI_MONTHS_EN)[c.hijri.month - 1]} ${digits(String(c.hijri.year))}`);
    return [...names].join(' – ');
  }, [digits, ur, weeks]);
  const move = (delta: number) =>
    setShown((s) => {
      const next = new Date(Date.UTC(s.y, s.m - 1 + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 };
    });
  const weekdays = t('browserUrdu.weekdays').split('|');
  const title = t('browserUrdu.monthTitle', { month: (ur ? GREGORIAN_MONTHS_UR : GREGORIAN_MONTHS_EN)[shown.m - 1], year: digits(String(shown.y)) });
  return (
    <SheetFrame visible={visible} title={title} onClose={onClose} testID="calendar-month-sheet">
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('browserUrdu.prevMonth')} onPress={() => move(-1)} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={rtl.isRtl ? 'chevron-right' : 'chevron-left'} size={24} color="secondary" />
          </Pressable>
          <Text variant="bodySmall" color="textSecondary" style={{ flex: 1, textAlign: 'center' }}>
            {hijriMonths}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('browserUrdu.nextMonth')} onPress={() => move(1)} style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={rtl.isRtl ? 'chevron-left' : 'chevron-right'} size={24} color="secondary" />
          </Pressable>
        </View>
        <View style={{ flexDirection: rtl.rowDirection }}>
          {weekdays.map((w) => (
            <Text key={w} variant="caption" color="textSecondary" style={{ flex: 1, textAlign: 'center' }}>
              {w}
            </Text>
          ))}
        </View>
        {weeks.map((week, i) => (
          <View key={i} style={{ flexDirection: rtl.rowDirection }}>
            {week.map((cell, j) => {
              const isToday = cell != null && shown.y === today.y && shown.m === today.m && cell.day === today.d;
              return (
                <View
                  key={j}
                  accessible={cell != null}
                  accessibilityLabel={cell ? `${digits(String(cell.day))}, ${hijriLabel(cell.hijri, ur, digits, t)}${isToday ? `, ${t('browserUrdu.today')}` : ''}` : undefined}
                  style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, backgroundColor: isToday ? theme.colors.primary : 'transparent' }}>
                  {cell ? (
                    <>
                      <Text variant="body" color={isToday ? 'textOnPrimary' : undefined}>
                        {digits(String(cell.day))}
                      </Text>
                      <Text variant="caption" color={isToday ? 'textOnPrimary' : 'textSecondary'}>
                        {digits(String(cell.hijri.day))}
                      </Text>
                    </>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </SheetFrame>
  );
});

const PRAYER_KEYS: Record<PrayerName, 'browserUrdu.fajr' | 'browserUrdu.sunrise' | 'browserUrdu.dhuhr' | 'browserUrdu.asr' | 'browserUrdu.maghrib' | 'browserUrdu.isha'> = {
  fajr: 'browserUrdu.fajr',
  sunrise: 'browserUrdu.sunrise',
  dhuhr: 'browserUrdu.dhuhr',
  asr: 'browserUrdu.asr',
  maghrib: 'browserUrdu.maghrib',
  isha: 'browserUrdu.isha',
};

const PrayerCard = memo(function PrayerCard() {
  const theme = useTheme();
  const { t, rtl, language } = useTranslation();
  const digits = useDigits();
  const cityId = useSettingsStore((s) => s.prayerCity || 'lahore');
  const coords = useSettingsStore((s) => s.prayerCoords ?? '');
  const asr = useSettingsStore((s) => (s.prayerAsr === 'shafi' ? 'shafi' : 'hanafi'));
  const now = useNow(30_000);
  const place = useMemo(() => resolvePlace(cityId, coords), [cityId, coords]);
  const date = placeDate(now, place.tz);
  const dayKey = `${date.year}-${date.month}-${date.day}`;
  const { today, tomorrowFajr } = useMemo(() => {
    const tomorrow = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    return {
      today: prayerTimesFor(place, date, asr),
      tomorrowFajr: prayerTimesFor(place, { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() }, asr).fajr,
    };
  }, [asr, dayKey, place]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = nextPrayer(today, tomorrowFajr, now);
  const city = place.tz ? cityById(cityId) : undefined;
  const placeName = city ? (language === 'ur' ? city.ur : city.en) : t('browserUrdu.customPlace');
  return (
    <View
      accessible
      accessibilityLabel={t('browserUrdu.prayerCardA11y', { place: placeName })}
      testID="start-page-prayer"
      style={{ padding: 12, gap: 8, borderRadius: theme.radius.lg, backgroundColor: theme.colors.card }}>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 12 }}>
        <Icon name="mosque" size={24} color="primary" />
        <Text variant="label" style={{ flex: 1, textAlign: rtl.textAlign }}>
          {placeName}
        </Text>
        <Text variant="label" color="primary">
          {t('browserUrdu.nextPrayer', { prayer: t(PRAYER_KEYS[next.name]), time: digits(formatCountdown(next.minutesLeft)) })}
        </Text>
      </View>
      <View style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', rowGap: 6 }}>
        {(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((name) => (
          <View key={name} style={{ width: '33.3%', alignItems: 'center' }}>
            <Text variant="caption" color={next.name === name ? 'primary' : 'textSecondary'}>
              {t(PRAYER_KEYS[name])}
            </Text>
            <Text variant="body" color={next.name === name ? 'primary' : undefined}>
              {digits(formatPrayerTime(today[name], place.tz))}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});
