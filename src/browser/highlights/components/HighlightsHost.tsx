import { memo, useEffect, useState } from 'react';
import { Share, View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useBrowserStore } from '@/browser/stores';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslationKey } from '@/localization';
import type { Highlight } from '@/storage/repositories/annotate.repository';

import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_COLORS, shareTextFor, type HighlightColor } from '../highlights-core';
import {
  cancelHighlight,
  closePageHighlights,
  deleteHighlight,
  listPageHighlights,
  restoredFor,
  savePendingHighlight,
  useHighlightsVersion,
  usePageHighlightsTab,
  usePendingHighlight,
} from '../highlights.service';

export const COLOR_LABELS: Record<HighlightColor, TranslationKey> = {
  yellow: 'browserAnnotate.colorYellow',
  green: 'browserAnnotate.colorGreen',
  blue: 'browserAnnotate.colorBlue',
  pink: 'browserAnnotate.colorPink',
};

/** B23 #261 — the Highlight sheet (4 colours, an optional note) and "Highlights on this page". */
export const HighlightsHost = memo(function HighlightsHost() {
  return (
    <>
      <NewHighlightSheet />
      <PageHighlightsSheet />
    </>
  );
});

const NewHighlightSheet = memo(function NewHighlightSheet() {
  const { t, rtl } = useTranslation();
  const pending = usePendingHighlight();
  const [color, setColor] = useState<HighlightColor>('yellow');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (pending) setNote('');
  }, [pending?.tabId, pending?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SheetFrame
      visible={pending != null}
      title={t('browserAnnotate.highlightTitle')}
      onClose={cancelHighlight}
      testID="highlight-sheet"
      footer={<Button title={t('browserAnnotate.save')} onPress={() => void savePendingHighlight(color, note)} testID="highlight-save" />}>
      {pending ? (
        <View style={{ gap: 12 }}>
          <Text variant="body" numberOfLines={4} style={{ textAlign: rtl.textAlign, backgroundColor: HIGHLIGHT_COLORS[color], color: '#000', padding: 6 }}>
            {pending.anchor.exact.trim()}
          </Text>
          <ColorPicker value={color} onChange={setColor} />
          <TextField label={t('browserAnnotate.noteField')} value={note} onChangeText={setNote} multiline maxLength={2000} testID="highlight-note" />
        </View>
      ) : null}
    </SheetFrame>
  );
});

export const ColorPicker = memo(function ColorPicker({ value, onChange }: { value: HighlightColor; onChange: (c: HighlightColor) => void }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  return (
    <View style={{ flexDirection: rtl.rowDirection, gap: 12 }} accessibilityRole="radiogroup">
      {HIGHLIGHT_COLOR_IDS.map((id) => (
        <Pressable
          key={id}
          accessibilityRole="radio"
          accessibilityLabel={t(COLOR_LABELS[id])}
          accessibilityState={{ checked: value === id, selected: value === id }}
          onPress={() => onChange(id)}
          testID={`highlight-color-${id}`}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: HIGHLIGHT_COLORS[id],
            borderWidth: value === id ? 3 : 1,
            borderColor: value === id ? theme.colors.primary : theme.colors.border,
          }}
        />
      ))}
    </View>
  );
});

const PageHighlightsSheet = memo(function PageHighlightsSheet() {
  const { t, rtl } = useTranslation();
  const tabId = usePageHighlightsTab();
  const changes = useHighlightsVersion();
  const url = useBrowserStore((s) => s.tabs.find((tab) => tab.id === tabId)?.url ?? '');
  const [list, setList] = useState<Highlight[]>([]);
  useEffect(() => {
    if (!tabId || !url) return;
    let cancelled = false;
    void listPageHighlights(url).then((l) => {
      if (!cancelled) setList(l);
    });
    return () => {
      cancelled = true;
    };
  }, [changes, tabId, url]);
  const report = restoredFor(tabId);
  const missing = report && report.of > report.found ? report.of - report.found : 0;
  return (
    <SheetFrame visible={tabId != null} title={t('browserAnnotate.onThisPage')} onClose={closePageHighlights} testID="page-highlights-sheet">
      {list.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {t('browserAnnotate.noneOnPage')}
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {missing > 0 ? (
            <Text variant="caption" color="warning" style={{ textAlign: rtl.textAlign }}>
              {t('browserAnnotate.restoredMissing', { missing, total: report!.of })}
            </Text>
          ) : null}
          {list.map((h) => (
            <HighlightRow key={h.id} highlight={h} />
          ))}
        </View>
      )}
    </SheetFrame>
  );
});

export const HighlightRow = memo(function HighlightRow({ highlight: h, onOpen }: { highlight: Highlight; onOpen?: () => void }) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  return (
    <View style={{ gap: 4, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.card, borderStartWidth: 4, borderStartColor: HIGHLIGHT_COLORS[h.color] }}>
      <Text variant="body" numberOfLines={5} selectable style={{ textAlign: rtl.textAlign }}>
        {h.text.trim()}
      </Text>
      {h.note ? (
        <Text variant="bodySmall" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
          {h.note}
        </Text>
      ) : null}
      {onOpen ? (
        <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ textAlign: rtl.textAlign }}>
          {h.pageTitle || h.pageUrl}
        </Text>
      ) : null}
      <View style={{ flexDirection: rtl.rowDirection, gap: 8, flexWrap: 'wrap' }}>
        {onOpen ? <Button title={t('browserAnnotate.open')} variant="outline" size="small" onPress={onOpen} /> : null}
        <Button
          title={t('browserAnnotate.share')}
          variant="outline"
          size="small"
          onPress={() => void Share.share({ message: shareTextFor(h) }).catch(() => undefined)}
        />
        <Button title={t('browserAnnotate.delete')} variant="outline" size="small" onPress={() => void deleteHighlight(h)} testID={`highlight-delete-${h.id}`} />
      </View>
    </View>
  );
});
