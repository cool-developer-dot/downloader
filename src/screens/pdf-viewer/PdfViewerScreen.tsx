import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, PixelRatio, ScrollView, View, useWindowDimensions, type ViewToken } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { pageHeight, pdfFailureKey, stepZoom } from '@/browser/capture/capture-core';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

const GAP = 8;

/**
 * B17 #264 — the in-app PDF viewer on Android's PdfRenderer: pages in a list whose layout is fixed from the page sizes
 * read at open (no jumps), each page drawn only when the list shows it (lazy: a 50-page file stays smooth), zoom by
 * steps (1×–3×, the page drawn again wider; Android's ScrollView has no pinch zoom), and the page number. The cached
 * PDF and its page pictures are deleted when the viewer closes.
 */
export const PdfViewerScreen = memo(function PdfViewerScreen() {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const { path, title } = useLocalSearchParams<{ path?: string; title?: string }>();
  const { width: screenWidth } = useWindowDimensions();
  const [doc, setDoc] = useState<{ id: number; pages: [number, number][] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!path || !isVidoraWebAvailable()) {
      setError(t('browserCapture.pdfFailed'));
      return undefined;
    }
    const web = getVidoraWeb();
    let opened: number | null = null;
    let cancelled = false;
    void web.openPdf?.(path).then((result) => {
      if (cancelled) {
        if (result.id != null) web.closePdf?.(result.id);
        return;
      }
      if (result.status === 'ok' && result.id != null && result.pages) {
        opened = result.id;
        setDoc({ id: result.id, pages: result.pages });
      } else setError(t(pdfFailureKey(result.status)));
    });
    return () => {
      cancelled = true;
      if (opened != null) web.closePdf?.(opened);
      web.deletePdf?.(path);
    };
  }, [path, t]);

  const pageWidth = Math.round((screenWidth - 2 * GAP) * zoom);
  const pixelWidth = Math.min(2400, Math.round(PixelRatio.getPixelSizeForLayoutSize(pageWidth)));
  const offsets = useMemo(() => {
    let y = 0;
    return (doc?.pages ?? []).map((p) => {
      const h = pageHeight(p, pageWidth);
      const item = { length: h + GAP, offset: y };
      y += h + GAP;
      return item;
    });
  }, [doc, pageWidth]);

  const viewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable);
    if (first?.index != null) setPage(first.index + 1);
  }).current;

  const renderItem = useCallback(
    ({ index }: { index: number }) => (
      <PdfPage id={doc!.id} index={index} total={doc!.pages.length} width={pageWidth} height={pageHeight(doc!.pages[index], pageWidth)} pixelWidth={pixelWidth} />
    ),
    [doc, pageWidth, pixelWidth],
  );

  const zoomButton = (icon: string, label: string, direction: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => setZoom((z) => stepZoom(z, direction))}
      style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon as never} size={22} color="default" />
    </Pressable>
  );

  const list = doc ? (
    <FlatList
      data={doc.pages}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderItem}
      getItemLayout={(_, index) => ({ ...offsets[index], index })}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
      onViewableItemsChanged={viewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
      contentContainerStyle={{ padding: GAP }}
      style={{ width: pageWidth + 2 * GAP }}
      testID="pdf-viewer-pages"
    />
  ) : null;

  return (
    <SafeAreaScreen testID="pdf-viewer" padded={false} edges={['top', 'left', 'right', 'bottom']} style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader title={title || 'PDF'} showBack onBackPress={() => navigation.back()} />
      {doc ? (
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 8 }}>
          <Text variant="label" accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: rtl.textAlign }}>
            {t('browserCapture.pdfPage', { page, total: doc.pages.length })}
          </Text>
          {zoomButton('magnify-minus-outline', t('browserCapture.pdfZoomOut'), -1)}
          <Text variant="caption" color="textSecondary">{`${Math.round(zoom * 100)}%`}</Text>
          {zoomButton('magnify-plus-outline', t('browserCapture.pdfZoomIn'), 1)}
        </View>
      ) : null}
      {error ? (
        <Text variant="body" color="textSecondary" style={{ padding: 24, textAlign: 'center' }}>
          {error}
        </Text>
      ) : !doc ? (
        <ActivityIndicator style={{ marginTop: 48 }} />
      ) : zoom > 1 ? (
        <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
          {list}
        </ScrollView>
      ) : (
        list
      )}
    </SafeAreaScreen>
  );
});

const PdfPage = memo(function PdfPage({ id, index, total, width, height, pixelWidth }: { id: number; index: number; total: number; width: number; height: number; pixelWidth: number }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getVidoraWeb()
      .renderPdfPage?.(id, index, pixelWidth)
      .then((u) => {
        if (!cancelled) setUri(u ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id, index, pixelWidth]);
  return (
    <View
      accessible
      accessibilityLabel={t('browserCapture.pdfPage', { page: index + 1, total })}
      style={{ width, height, marginBottom: GAP, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.colors.border }}>
      {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
    </View>
  );
});
