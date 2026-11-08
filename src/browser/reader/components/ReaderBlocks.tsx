import { memo, useState } from 'react';
import { Text as RNText, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import { Image } from 'expo-image';

import { useTranslation } from '@/localization';

import type { ReaderBlock, ReaderSpan } from '../reader-sanitize';
import type { ReaderPalette } from '../reader-settings';

export type ReaderTypography = {
  fontSize: number;
  lineHeight: number;
  fontFamily: string | undefined;
  rtl: boolean;
};

/**
 * B15 #161 — the article's blocks drawn with the app's own views (no web content): paragraphs, headings, list items,
 * quotes, code, pictures (when on) and rules. Links are tappable text (role link); the paragraph being read aloud
 * gets a highlight.
 */
export const ReaderBlocks = memo(function ReaderBlocks({
  blocks,
  palette,
  type,
  showImages,
  activeBlock,
  onLink,
  onBlockLayout,
}: {
  blocks: readonly ReaderBlock[];
  palette: ReaderPalette;
  type: ReaderTypography;
  showImages: boolean;
  activeBlock: number;
  onLink: (url: string) => void;
  onBlockLayout: (index: number, y: number) => void;
}) {
  const base: TextStyle = {
    color: palette.text,
    fontSize: type.fontSize,
    lineHeight: Math.round(type.fontSize * type.lineHeight),
    fontFamily: type.fontFamily,
    writingDirection: type.rtl ? 'rtl' : 'ltr',
    textAlign: type.rtl ? 'right' : 'left',
  };
  return (
    <View style={{ gap: Math.round(type.fontSize * 0.9) }}>
      {blocks.map((block, index) => {
        if (block.type === 'img' && !showImages) return null;
        const active = index === activeBlock;
        return (
          <View
            // Blocks never move once shown; the index is their identity.
            key={index}
            onLayout={(event: LayoutChangeEvent) => onBlockLayout(index, event.nativeEvent.layout.y)}
            style={active ? { backgroundColor: palette.highlight, borderRadius: 6, marginHorizontal: -6, paddingHorizontal: 6 } : undefined}>
            <Block block={block} base={base} palette={palette} type={type} onLink={onLink} />
          </View>
        );
      })}
    </View>
  );
});

function Spans({ spans, palette, onLink }: { spans: readonly ReaderSpan[]; palette: ReaderPalette; onLink: (url: string) => void }) {
  return (
    <>
      {spans.map((span, i) => {
        const style: TextStyle = {};
        if (span.bold) style.fontWeight = '700';
        if (span.italic) style.fontStyle = 'italic';
        if (span.code) style.fontFamily = 'monospace';
        if (span.href) {
          const href = span.href;
          return (
            <RNText
              key={i}
              accessibilityRole="link"
              onPress={() => onLink(href)}
              suppressHighlighting={false}
              style={[style, { color: palette.link, textDecorationLine: 'underline' }]}>
              {span.text}
            </RNText>
          );
        }
        return (
          <RNText key={i} style={style}>
            {span.text}
          </RNText>
        );
      })}
    </>
  );
}

const Block = memo(function Block({
  block,
  base,
  palette,
  type,
  onLink,
}: {
  block: ReaderBlock;
  base: TextStyle;
  palette: ReaderPalette;
  type: ReaderTypography;
  onLink: (url: string) => void;
}) {
  const { t } = useTranslation();
  switch (block.type) {
    case 'h': {
      const scale = block.level === 1 ? 1.5 : block.level === 2 ? 1.3 : 1.15;
      return (
        <RNText
          accessibilityRole="header"
          style={[base, { fontWeight: '700', fontSize: Math.round(type.fontSize * scale), lineHeight: Math.round(type.fontSize * scale * type.lineHeight) }]}>
          <Spans spans={block.spans} palette={palette} onLink={onLink} />
        </RNText>
      );
    }
    case 'li':
      return (
        <View style={{ flexDirection: type.rtl ? 'row-reverse' : 'row', gap: 8, ...(type.rtl ? { paddingRight: block.depth * 20 } : { paddingLeft: block.depth * 20 }) }}>
          <RNText style={[base, { minWidth: type.fontSize * 1.2 }]} accessible={false}>
            {block.ordered ? `${block.index}.` : '•'}
          </RNText>
          <RNText style={[base, { flex: 1 }]}>
            <Spans spans={block.spans} palette={palette} onLink={onLink} />
          </RNText>
        </View>
      );
    case 'quote':
      return (
        <View
          style={{
            ...(type.rtl ? { borderRightWidth: 3, paddingRight: 12 } : { borderLeftWidth: 3, paddingLeft: 12 }),
            borderColor: palette.rule,
          }}>
          <RNText style={[base, { fontStyle: 'italic', color: palette.secondary }]}>
            <Spans spans={block.spans} palette={palette} onLink={onLink} />
          </RNText>
        </View>
      );
    case 'pre':
      return (
        <View style={{ borderWidth: 1, borderColor: palette.rule, borderRadius: 6, padding: 10 }}>
          <RNText selectable style={{ color: palette.text, fontFamily: 'monospace', fontSize: Math.round(type.fontSize * 0.85), writingDirection: 'ltr', textAlign: 'left' }}>
            {block.text}
          </RNText>
        </View>
      );
    case 'img':
      return <ReaderImage src={block.src} alt={block.alt} label={block.alt ? t('browserReader.imageA11y', { alt: block.alt }) : t('browserReader.imageNoAlt')} />;
    case 'hr':
      return <View style={{ height: 1, backgroundColor: palette.rule, marginVertical: 4 }} />;
    default:
      return (
        <RNText selectable style={base}>
          <Spans spans={block.spans} palette={palette} onLink={onLink} />
        </RNText>
      );
  }
});

const ReaderImage = memo(function ReaderImage({ src, alt, label }: { src: string; alt: string; label: string }) {
  const [ratio, setRatio] = useState(16 / 9);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri: src }}
      accessible
      accessibilityLabel={label}
      alt={alt}
      contentFit="contain"
      onLoad={(event) => {
        const { width, height } = event.source;
        if (width > 0 && height > 0) setRatio(Math.min(3, Math.max(0.3, width / height)));
      }}
      onError={() => setFailed(true)}
      style={{ width: '100%', aspectRatio: ratio, borderRadius: 6 }}
    />
  );
});
