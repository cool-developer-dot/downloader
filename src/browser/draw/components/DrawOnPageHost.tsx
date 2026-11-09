import { memo, useMemo, useReducer, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Modal, PanResponder, Platform, ToastAndroid, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import {
  addStroke,
  EMPTY_DRAWING,
  eraseAt,
  PEN_COLORS,
  PEN_SIZES,
  redo,
  strokePath,
  strokesJson,
  undo,
  type DrawState,
} from '../draw-core';
import { canSaveDrawingToPictures, closeDrawing, exportDrawing, useDrawSession } from '../draw.service';

type Action =
  | { type: 'add'; color: string; width: number; points: number[] }
  | { type: 'erase'; x: number; y: number; radius: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset' };

function reducer(state: DrawState, action: Action): DrawState {
  switch (action.type) {
    case 'add':
      return addStroke(state, action.color, action.width, action.points);
    case 'erase':
      return eraseAt(state, action.x, action.y, action.radius);
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
    case 'reset':
      return EMPTY_DRAWING;
  }
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/** B23 #279 — Draw on page: the page picture with pen colours and sizes, eraser, undo / redo; save or share. */
export const DrawOnPageHost = memo(function DrawOnPageHost() {
  const session = useDrawSession();
  if (!session) return null;
  return <DrawScreen key={session.uri} />;
});

const DrawScreen = memo(function DrawScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();
  const session = useDrawSession()!;
  const [state, dispatch] = useReducer(reducer, EMPTY_DRAWING);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState<string>(PEN_COLORS[0]);
  const [size, setSize] = useState<number>(PEN_SIZES[1]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<number[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const livePoints = useRef<number[]>([]);
  const toolRef = useRef({ tool, color, size, scale: 1 });

  // The picture fits the area: one scale from screen points to picture pixels.
  const fit = useMemo(() => {
    if (!box.w || !box.h) return { w: 0, h: 0, scale: 1 };
    const scale = Math.max(session.width / box.w, session.height / box.h);
    return { w: session.width / scale, h: session.height / scale, scale };
  }, [box, session.height, session.width]);
  toolRef.current = { tool, color, size, scale: fit.scale };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          const r = toolRef.current;
          const x = locationX * r.scale;
          const y = locationY * r.scale;
          if (r.tool === 'eraser') {
            dispatch({ type: 'erase', x, y, radius: 12 * r.scale });
            return;
          }
          livePoints.current = [x, y];
          setLive(livePoints.current);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          const r = toolRef.current;
          const x = locationX * r.scale;
          const y = locationY * r.scale;
          if (r.tool === 'eraser') {
            dispatch({ type: 'erase', x, y, radius: 12 * r.scale });
            return;
          }
          livePoints.current = [...livePoints.current, x, y];
          setLive(livePoints.current);
        },
        onPanResponderRelease: () => {
          const r = toolRef.current;
          if (r.tool === 'pen' && livePoints.current.length >= 2) {
            dispatch({ type: 'add', color: r.color, width: r.size * r.scale, points: livePoints.current });
          }
          livePoints.current = [];
          setLive([]);
        },
        onPanResponderTerminate: () => {
          livePoints.current = [];
          setLive([]);
        },
      }),
    [],
  );

  const close = () => (state.strokes.length ? setConfirmDiscard(true) : closeDrawing());
  const doExport = async (mode: 'save' | 'share') => {
    const ok = await exportDrawing(mode, strokesJson(state));
    if (mode === 'save') notify(ok ? t('browserAnnotate.savedToPictures') : t('browserAnnotate.saveFailed'));
    else if (!ok) notify(t('browserAnnotate.shareFailed'));
  };
  const canSave = canSaveDrawingToPictures();

  const toolButton = (icon: string, label: string, onPress: () => void, opts: { selected?: boolean; disabled?: boolean; testID?: string } = {}) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: opts.selected, disabled: opts.disabled }}
      onPress={opts.disabled ? undefined : onPress}
      testID={opts.testID}
      style={{
        minWidth: 48,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: opts.selected ? theme.colors.primary : 'transparent',
        opacity: opts.disabled ? 0.4 : 1,
      }}>
      <Icon name={icon as never} size={22} color={opts.selected ? 'onPrimary' : 'default'} />
    </Pressable>
  );

  return (
    <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }} testID="draw-on-page">
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', paddingHorizontal: 4 }}>
          {toolButton('close', t('common.cancel'), close)}
          <Text variant="title" accessibilityRole="header" style={{ flex: 1, textAlign: rtl.textAlign }}>
            {t('browserAnnotate.drawTitle')}
          </Text>
          {toolButton('undo', t('browserAnnotate.undo'), () => dispatch({ type: 'undo' }), { disabled: !state.undo.length, testID: 'draw-undo' })}
          {toolButton('redo', t('browserAnnotate.redo'), () => dispatch({ type: 'redo' }), { disabled: !state.redo.length, testID: 'draw-redo' })}
          {canSave ? toolButton('content-save-outline', t('browserAnnotate.saveToPictures'), () => void doExport('save'), { testID: 'draw-save' }) : null}
          {toolButton('share-variant-outline', t('browserAnnotate.share'), () => void doExport('share'), { testID: 'draw-share' })}
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {fit.w > 0 ? (
            <View style={{ width: fit.w, height: fit.h }} {...responder.panHandlers}>
              <Image source={{ uri: session.uri }} style={{ width: fit.w, height: fit.h }} accessibilityIgnoresInvertColors />
              <Svg width={fit.w} height={fit.h} viewBox={`0 0 ${session.width} ${session.height}`} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
                {state.strokes.map((s) => (
                  <Path key={s.id} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                ))}
                {live.length >= 2 ? (
                  <Path d={strokePath(live)} stroke={color} strokeWidth={size * fit.scale} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                ) : null}
              </Svg>
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', flexWrap: 'wrap', gap: 4, paddingHorizontal: 8 }}>
          {toolButton('pen', t('browserAnnotate.pen'), () => setTool('pen'), { selected: tool === 'pen', testID: 'draw-pen' })}
          {toolButton('eraser', t('browserAnnotate.eraser'), () => setTool('eraser'), { selected: tool === 'eraser', testID: 'draw-eraser' })}
          {PEN_COLORS.map((c, i) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={t('browserAnnotate.penColor', { n: i + 1 })}
              accessibilityState={{ checked: color === c }}
              onPress={() => {
                setColor(c);
                setTool('pen');
              }}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? theme.colors.primary : theme.colors.border }} />
            </Pressable>
          ))}
          {PEN_SIZES.map((s) => (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityLabel={t('browserAnnotate.penSize', { size: s })}
              accessibilityState={{ checked: size === s }}
              onPress={() => setSize(s)}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: s + 6, height: s + 6, borderRadius: (s + 6) / 2, backgroundColor: theme.colors.textPrimary, opacity: size === s ? 1 : 0.35 }} />
            </Pressable>
          ))}
        </View>
      </View>
      <ConfirmModal
        visible={confirmDiscard}
        variant="delete"
        title={t('browserAnnotate.discardTitle')}
        message=""
        confirmLabel={t('browserAnnotate.discard')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setConfirmDiscard(false);
          closeDrawing();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Modal>
  );
});
