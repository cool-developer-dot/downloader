import { memo, useCallback } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid, View } from 'react-native';

import { addToHomeScreen } from '@/browser/bookmarks/bookmarks.service';
import { announceMenuNotice } from '@/browser/highlights/menu-notice';
import { watchPage, type WatchOutcome } from '@/browser/page-alerts/page-alerts.service';
import { MAX_WATCHES } from '@/browser/page-alerts/page-alerts-core';
import { savePageNote } from '@/browser/notes/notes.service';
import { cityById, formatPrayerTime, placeDate, prayerTimesFor, resolvePlace } from '@/browser/prayer/prayer-times';
import { requestAddressBarFocus } from '@/browser/services/address-bar-focus';
import { openQrSheet, scanQrCode } from '@/browser/share-qr/share-qr.service';
import { selectActiveTab, selectCurrentUrl, selectPageTitle, useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { DsCard, DsHeader, DsRow, DsRowGroup, DsScreen, DsText, DsTile, DsTileGrid } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';
import { toUrduDigits } from '@/utils/text-direction';

const WATCH_KEYS: Record<WatchOutcome, TranslationKey> = {
  watching: 'browserAnnotate.watching',
  already: 'browserAnnotate.alreadyWatching',
  cannotWatch: 'browserAnnotate.cannotWatch',
  failed: 'browserAnnotate.watchFailed',
  limit: 'browserAnnotate.watchLimit',
  incognito: 'browserAnnotate.watchIncognito',
};

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** "5:12" / "12:30" / "4:05" — the design's short 12-hour time, from the computed HH:MM in the place's time zone. */
export function shortPrayerTime(when: Date, tz: string | null): string {
  const [hours, minutes] = formatPrayerTime(when, tz).split(':').map(Number);
  const h = Number.isFinite(hours) ? hours % 12 || 12 : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Design 38 "Utilities": nine tiles over the existing browser tools (address bar calculator, the dual calendar and
 * prayer cards of the start page, QR scan / create, Save to notes, Install web app = home-screen shortcut, Page
 * alert), the prayer times card for the chosen city, and the Dual calendar / Copy text from image / Voice commands
 * rows. Tools that work on the page in front need one open and say so otherwise.
 */
export const UtilitiesScreen = memo(function UtilitiesScreen() {
  const { t, language, rtl } = useTranslation();
  const update = useSettingsStore((state) => state.updateSetting);
  const showCalendar = useSettingsStore((state) => state.showHijriCalendar === true);
  const showPrayer = useSettingsStore((state) => state.showPrayerTimes === true);
  const cityId = useSettingsStore((state) => state.prayerCity || 'lahore');
  const coords = useSettingsStore((state) => state.prayerCoords ?? '');
  const asr = useSettingsStore((state) => (state.prayerAsr === 'shafi' ? 'shafi' : 'hanafi'));
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const pageTitle = useBrowserStore(selectPageTitle);
  const hasPage = isValidBrowserPageUrl(currentUrl);

  // The prayer times for today at the chosen place (the default city when prayer times are off).
  const place = resolvePlace(cityId, coords);
  const today = placeDate(new Date(), place.tz);
  const times = prayerTimesFor(place, today, asr);
  const digits = language === 'ur' ? toUrduDigits : (text: string) => text;
  const city = place.tz ? cityById(cityId) : undefined;
  const placeName = city ? (language === 'ur' ? city.ur : city.en) : t('browserUrdu.customPlace');
  const fajr = digits(shortPrayerTime(times.fajr, place.tz));
  const zuhr = digits(shortPrayerTime(times.dhuhr, place.tz));
  const asrTime = digits(shortPrayerTime(times.asr, place.tz));

  const notYet = useCallback(() => {
    ToastAndroid.show(t('common.notAvailableYet'), ToastAndroid.SHORT);
  }, [t]);
  const needsPage = useCallback(() => notify(t('lightUtilities.needsPage')), [t]);
  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  // B4 #268: the calculator is the address bar — open it with the keyboard up and say how to use it.
  const calculator = useCallback(() => {
    requestAddressBarFocus();
    notify(t('lightUtilities.calculatorHint'));
    navigation.back();
  }, [t]);

  // B24 #269: the dual calendar card lives on the start page (tap it for the month); make sure it is shown.
  const dualCalendar = useCallback(() => {
    if (!showCalendar) {
      update('showHijriCalendar', true);
      notify(t('lightUtilities.shownOnStartPage'));
    }
    navigation.back();
  }, [showCalendar, t, update]);

  // B24 #270: same for the prayer card.
  const prayerTimes = useCallback(() => {
    if (!showPrayer) {
      update('showPrayerTimes', true);
      notify(t('lightUtilities.shownOnStartPage'));
    }
    navigation.back();
  }, [showPrayer, t, update]);

  const scan = useCallback(() => {
    void scanQrCode();
  }, []);

  // B22 #249: the QR sheet is hosted by the browser screen, so go back to it once it is asked for.
  const createQr = useCallback(() => {
    if (!hasPage) return needsPage();
    openQrSheet(currentUrl, pageTitle);
    navigation.back();
  }, [currentUrl, hasPage, needsPage, pageTitle]);

  // B22 #252
  const saveToNotes = useCallback(() => {
    if (!hasPage) return needsPage();
    void savePageNote();
  }, [hasPage, needsPage]);

  // B9 #87: the launcher's own "add shortcut" dialog for the page in front.
  const installWebApp = useCallback(() => {
    if (!hasPage) return needsPage();
    void addToHomeScreen(currentUrl, pageTitle);
  }, [currentUrl, hasPage, needsPage, pageTitle]);

  // B23 #289
  const pageAlert = useCallback(() => {
    const tab = selectActiveTab(useBrowserStore.getState());
    if (!tab || !isValidBrowserPageUrl(tab.url)) return needsPage();
    void watchPage(tab.id, tab.url, tab.title).then((outcome) => {
      announceMenuNotice(t(WATCH_KEYS[outcome], { max: MAX_WATCHES }));
    });
  }, [needsPage, t]);

  return (
    <DsScreen testID="browser-utilities-screen">
      <DsHeader
        title={t('lightUtilities.title')}
        subtitle={t('lightUtilities.subtitle')}
        action={{ icon: 'settings', accessibilityLabel: t('lightUtilities.settingsA11y'), onPress: openSettings, testID: 'browser-utilities-settings' }}
      />
      <DsTileGrid testID="browser-utilities-tiles">
        <DsTile icon="cpu" label={t('lightUtilities.calculator')} onPress={calculator} testID="browser-utilities-calculator" />
        <DsTile icon="refresh-cw" label={t('lightUtilities.converter')} onPress={notYet} testID="browser-utilities-converter" />
        <DsTile icon="calendar" label={t('lightUtilities.dualCalendar')} onPress={dualCalendar} testID="browser-utilities-calendar" />
        <DsTile icon="star" label={t('lightUtilities.prayerTimes')} onPress={prayerTimes} testID="browser-utilities-prayer" />
        <DsTile icon="qr-code" label={t('lightUtilities.scanQr')} onPress={scan} testID="browser-utilities-scan-qr" />
        <DsTile icon="qr-code" label={t('lightUtilities.createQr')} onPress={createQr} testID="browser-utilities-create-qr" />
        <DsTile icon="file-text" label={t('lightUtilities.saveToNotes')} onPress={saveToNotes} testID="browser-utilities-notes" />
        <DsTile icon="smartphone" label={t('lightUtilities.installWebApp')} onPress={installWebApp} testID="browser-utilities-install" />
        <DsTile icon="bell" label={t('lightUtilities.pageAlert')} onPress={pageAlert} testID="browser-utilities-page-alert" />
      </DsTileGrid>

      <View accessible accessibilityLabel={t('lightUtilities.prayerCardA11y', { place: placeName, fajr, zuhr, asr: asrTime })}>
        <DsCard testID="browser-utilities-prayer-card">
          <DsText variant="cardTitle">{t('lightUtilities.prayerTimes')}</DsText>
          <View style={{ flexDirection: rtl.rowDirection, justifyContent: 'space-between', marginTop: 10 }}>
            <DsText variant="rowSub">{`${t('lightUtilities.fajr')} ${fajr}`}</DsText>
            <DsText variant="rowSub">{`${t('lightUtilities.zuhr')} ${zuhr}`}</DsText>
            <DsText variant="rowSub">{`${t('lightUtilities.asr')} ${asrTime}`}</DsText>
          </View>
        </DsCard>
      </View>

      <DsRowGroup testID="browser-utilities-rows">
        <DsRow
          icon="calendar"
          title={t('lightUtilities.dualCalendar')}
          subtitle={t('lightUtilities.dualCalendarHint')}
          toggle={{ value: showCalendar, onValueChange: (next) => update('showHijriCalendar', next) }}
          testID="browser-utilities-calendar-toggle"
        />
        <DsRow icon="image" title={t('lightUtilities.copyTextFromImage')} onPress={notYet} testID="browser-utilities-ocr" />
        <DsRow icon="mic" title={t('lightUtilities.voiceCommands')} onPress={notYet} testID="browser-utilities-voice" />
      </DsRowGroup>
    </DsScreen>
  );
});
