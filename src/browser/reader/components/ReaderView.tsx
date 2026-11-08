import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StatusBar, Text as RNText, View } from 'react-native';
import { Icon as PaperIcon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/base/Pressable';
import { Button } from '@/components/buttons/Button';
import { loadUrlActiveTab } from '@/browser/services';
import { NASTALIQ_FONT_FAMILY, useNastaliqFont } from '@/browser/fonts/urdu-font';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { readAloud, useReadAloud } from '../read-aloud.service';
import type { ReaderArticle } from '../reader-article';
import { readerMode, useReaderState } from '../reader-mode.service';
import {
  normalizeReaderFontFamily,
  normalizeReaderFontSize,
  normalizeReaderLineSpacing,
  normalizeReaderSpeechRate,
  normalizeReaderTheme,
  READER_SPEECH_RATES,
  readerLineHeight,
  readerPalette,
  type ReaderPalette,
} from '../reader-settings';
import { ReaderAppearanceSheet } from './ReaderAppearanceSheet';
import { ReaderBlocks } from './ReaderBlocks';

/**
 * B15 #161 / #172 / #173 — reader mode: the article in the app's own views over the page (a window of its own, so
 * the page underneath keeps its place; Back or ✕ closes it). Title, author, site and reading time on top; text in the
 * remembered colours, size, font and spacing (Urdu in Nastaliq); links open in the browser; Read aloud at the bottom.
 */
export const ReaderHost = memo(function ReaderHost() {
  useEffect(() => readerMode.start(), []);
  const { open } = useReaderState();
  if (!open) return null;
  return <ReaderView />;
});

const ReaderView = memo(function ReaderView() {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { open } = useReaderState();
  const readerTheme = normalizeReaderTheme(useSettingsStore((s) => s.readerTheme));
  const palette = readerPalette(readerTheme, theme.mode === 'dark');
  const [appearance, setAppearance] = useState(false);

  const close = useCallback(() => {
    readAloud.stop();
    readerMode.close();
  }, []);

  // Read aloud never outlives the reader.
  useEffect(() => () => readAloud.stop(), []);

  const darkPalette = palette.background === readerPalette('dark', true).background;

  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent={false} testID="reader-view">
      <StatusBar barStyle={darkPalette ? 'light-content' : 'dark-content'} backgroundColor={palette.background} />
      <View style={{ flex: 1, backgroundColor: palette.background, paddingBottom: insets.bottom }}>
        <ReaderTopBar palette={palette} onClose={close} onAppearance={() => setAppearance(true)} />
        {open?.status === 'ready' ? (
          <ArticleBody article={open.article} palette={palette} />
        ) : open?.status === 'failed' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
            <RNText accessibilityLiveRegion="polite" style={{ color: palette.text, fontSize: 16, textAlign: 'center' }}>
              {t('browserReader.failed')}
            </RNText>
            <Button title={t('browserReader.retry')} onPress={() => readerMode.open()} testID="reader-retry" />
            <Button title={t('browserReader.showPage')} variant="outline" onPress={close} testID="reader-show-page" />
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <ActivityIndicator color={palette.link} />
            <RNText accessibilityLiveRegion="polite" style={{ color: palette.secondary, fontSize: 15 }}>
              {t('browserReader.loading')}
            </RNText>
          </View>
        )}
      </View>
      <ReaderAppearanceSheet visible={appearance} onClose={() => setAppearance(false)} />
    </Modal>
  );
});

function ReaderTopBar({ palette, onClose, onAppearance }: { palette: ReaderPalette; onClose: () => void; onAppearance: () => void }) {
  const { t, rtl } = useTranslation();
  return (
    <View
      style={{
        flexDirection: rtl.rowDirection,
        alignItems: 'center',
        paddingHorizontal: 4,
        minHeight: 56,
        borderBottomWidth: 1,
        borderBottomColor: palette.rule,
      }}>
      <BarButton icon="close" label={t('browserReader.close')} color={palette.text} onPress={onClose} testID="reader-close" />
      <RNText accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: palette.text, fontSize: 18, fontWeight: '600', marginHorizontal: 8, textAlign: rtl.isRtl ? 'right' : 'left' }}>
        {t('browserReader.title')}
      </RNText>
      <BarButton icon="format-size" label={t('browserReader.appearance')} color={palette.text} onPress={onAppearance} testID="reader-appearance" />
    </View>
  );
}

function BarButton({ icon, label, color, onPress, testID, disabled }: { icon: string; label: string; color: string; onPress: () => void; testID: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}>
      <PaperIcon source={icon} size={24} color={color} />
    </Pressable>
  );
}

const ArticleBody = memo(function ArticleBody({ article, palette }: { article: ReaderArticle; palette: ReaderPalette }) {
  const { t } = useTranslation();
  const fontSize = Number(normalizeReaderFontSize(useSettingsStore((s) => s.readerFontSize)));
  const fontFamily = normalizeReaderFontFamily(useSettingsStore((s) => s.readerFontFamily));
  const spacing = normalizeReaderLineSpacing(useSettingsStore((s) => s.readerLineSpacing));
  const showImages = useSettingsStore((s) => s.readerImages);
  const nastaliqReady = useNastaliqFont(article.urdu);
  const nastaliq = article.urdu && nastaliqReady;
  const speech = useReadAloud();
  const reading = speech.url === article.url && speech.status !== 'idle';

  const scrollRef = useRef<ScrollView>(null);
  const blockTops = useRef<Map<number, number>>(new Map());
  const contentTop = useRef(0);
  const onBlockLayout = useCallback((index: number, y: number) => {
    blockTops.current.set(index, y);
  }, []);

  // Keep the paragraph being read on screen.
  useEffect(() => {
    if (!reading || speech.blockIndex < 0) return;
    const y = blockTops.current.get(speech.blockIndex);
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, contentTop.current + y - 80), animated: true });
  }, [reading, speech.blockIndex]);

  const openLink = useCallback((url: string) => {
    readAloud.stop();
    readerMode.close();
    loadUrlActiveTab(url);
  }, []);

  const type = {
    fontSize,
    lineHeight: readerLineHeight(spacing, nastaliq),
    fontFamily: nastaliq ? NASTALIQ_FONT_FAMILY : fontFamily === 'serif' ? 'serif' : 'sans-serif',
    rtl: article.rtl,
  };
  const align = article.rtl ? ('right' as const) : ('left' as const);
  const direction = article.rtl ? ('rtl' as const) : ('ltr' as const);
  const meta = [article.byline, article.siteName].filter(Boolean).join(' · ');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }} testID="reader-scroll">
        <View style={{ gap: 6, marginBottom: 20 }}>
          {article.title ? (
            <RNText
              accessibilityRole="header"
              style={{
                color: palette.text,
                fontSize: Math.round(fontSize * 1.6),
                lineHeight: Math.round(fontSize * 1.6 * type.lineHeight * 0.9),
                fontWeight: nastaliq ? undefined : '700',
                fontFamily: type.fontFamily,
                textAlign: align,
                writingDirection: direction,
              }}>
              {article.title}
            </RNText>
          ) : null}
          {meta ? <RNText style={{ color: palette.secondary, fontSize: 14, textAlign: align, writingDirection: direction }}>{meta}</RNText> : null}
          <RNText style={{ color: palette.secondary, fontSize: 14, textAlign: align }}>{t('browserReader.minutes', { count: article.minutes })}</RNText>
        </View>
        <View onLayout={(event) => (contentTop.current = event.nativeEvent.layout.y)}>
          <ReaderBlocks
            blocks={article.blocks}
            palette={palette}
            type={type}
            showImages={showImages}
            activeBlock={reading ? speech.blockIndex : -1}
            onLink={openLink}
            onBlockLayout={onBlockLayout}
          />
        </View>
        {article.truncated ? (
          <RNText style={{ color: palette.secondary, fontSize: 14, marginTop: 24, textAlign: align }}>{t('browserReader.truncated')}</RNText>
        ) : null}
      </ScrollView>
      <ReadAloudBar article={article} palette={palette} />
    </View>
  );
});

const ReadAloudBar = memo(function ReadAloudBar({ article, palette }: { article: ReaderArticle; palette: ReaderPalette }) {
  const { t, rtl } = useTranslation();
  const speech = useReadAloud();
  const update = useSettingsStore((s) => s.updateSetting);
  const rateSetting = normalizeReaderSpeechRate(useSettingsStore((s) => s.readerSpeechRate));
  const rate = Number(rateSetting);
  const mine = speech.url === article.url;
  const active = mine && speech.status !== 'idle';

  const cycleRate = () => {
    const at = READER_SPEECH_RATES.indexOf(rateSetting);
    const next = READER_SPEECH_RATES[(at + 1) % READER_SPEECH_RATES.length];
    update('readerSpeechRate', next);
    readAloud.setRate(Number(next));
  };

  const openSettings = async () => {
    readAloud.dismissNoVoice();
    await readAloud.openSpeechSettings();
  };

  if (mine && speech.noVoice) {
    return (
      <View style={{ borderTopWidth: 1, borderTopColor: palette.rule, padding: 12, gap: 10 }} testID="reader-no-voice">
        <RNText accessibilityLiveRegion="polite" style={{ color: palette.text, fontSize: 15, textAlign: rtl.isRtl ? 'right' : 'left' }}>
          {t('browserReader.noUrduVoice')}
        </RNText>
        <View style={{ flexDirection: rtl.rowDirection, gap: 12 }}>
          <Button title={t('browserReader.speechSettings')} variant="outline" onPress={() => void openSettings()} style={{ flex: 1 }} testID="reader-speech-settings" />
          <Button
            title={t('browserReader.defaultVoice')}
            onPress={() => void readAloud.play(article, rate, { anyVoice: true })}
            style={{ flex: 1 }}
            testID="reader-default-voice"
          />
        </View>
      </View>
    );
  }

  if (!active) {
    return (
      <View style={{ borderTopWidth: 1, borderTopColor: palette.rule, flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('browserReader.readAloud')}
          onPress={() => void readAloud.play(article, rate)}
          testID="reader-read-aloud"
          style={{ minHeight: 48, flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8, paddingHorizontal: 8 }}>
          <PaperIcon source="text-to-speech" size={24} color={palette.link} />
          <RNText style={{ color: palette.link, fontSize: 16 }}>{t('browserReader.readAloud')}</RNText>
        </Pressable>
      </View>
    );
  }

  const playing = speech.status === 'playing';
  return (
    <View
      testID="reader-read-aloud-bar"
      style={{ borderTopWidth: 1, borderTopColor: palette.rule, flexDirection: rtl.rowDirection, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
      <BarButton icon="stop" label={t('browserReader.stop')} color={palette.text} onPress={() => readAloud.stop()} testID="reader-speech-stop" />
      {/* Paragraph order follows the article: "previous" is towards its start. */}
      <BarButton icon={rtl.isRtl ? 'skip-next' : 'skip-previous'} label={t('browserReader.previous')} color={palette.text} onPress={() => readAloud.step(-1)} testID="reader-speech-previous" />
      <BarButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? t('browserReader.pause') : t('browserReader.play')}
        color={palette.link}
        onPress={() => (playing ? readAloud.pause() : readAloud.resume())}
        testID="reader-speech-play"
      />
      <BarButton icon={rtl.isRtl ? 'skip-previous' : 'skip-next'} label={t('browserReader.next')} color={palette.text} onPress={() => readAloud.step(1)} testID="reader-speech-next" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('browserReader.speedA11y', { rate: rateSetting })}
        onPress={cycleRate}
        testID="reader-speech-rate"
        style={{ minWidth: 56, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={{ color: palette.text, fontSize: 15, fontWeight: '600' }}>{t('browserReader.speed', { rate: rateSetting })}</RNText>
      </Pressable>
    </View>
  );
});
