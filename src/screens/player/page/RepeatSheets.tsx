import { memo, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsIconButton, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { abLoopOf, type AbPoints } from '@/player/ab-repeat';
import { END_OF_PLAYBACK_ACTIONS, type EndOfPlaybackAction } from '@/player/end-of-playback';
import { formatPlaybackTime } from '@/player/format-time';
import { abPointsLabel, endOfPlaybackHint, endOfPlaybackLabel, loopSpanLabel } from '@/player/repeat-labels';
import { MAX_LOOP_NAME_LENGTH, normalizeLoopName, type SavedLoop } from '@/player/saved-loops';

import { PlayerSheetFrame } from './PlayerSheetFrame';

export type EndOfPlaybackSheetProps = {
  visible: boolean;
  selected: EndOfPlaybackAction;
  onSelect: (action: EndOfPlaybackAction) => void;
  onClose: () => void;
};

/** #535 When the video ends: Stop (as before), Repeat one (#539), Repeat all (#540). App-wide, remembered. */
export const EndOfPlaybackSheet = memo(function EndOfPlaybackSheet({ visible, selected, onSelect, onClose }: EndOfPlaybackSheetProps) {
  const { t } = useTranslation();
  const actions = useMemo<ActionSheetItem[]>(
    () =>
      END_OF_PLAYBACK_ACTIONS.map((action) => ({
        id: `player-end-${action}`,
        label: `${endOfPlaybackLabel(t, action)} · ${endOfPlaybackHint(t, action)}`,
        selected: action === selected,
        onPress: () => onSelect(action),
      })),
    [onSelect, selected, t],
  );
  return (
    <ActionSheetModal
      visible={visible}
      title={t('videoPlayer.endOfPlayback')}
      subtitle={t('videoPlayer.endOfPlaybackHint')}
      actions={actions}
      onClose={onClose}
      testID="player-end-of-playback-sheet"
    />
  );
});

export type AbRepeatSheetProps = {
  visible: boolean;
  points: AbPoints;
  positionSeconds: number;
  durationSeconds: number | null;
  /** The video can take commands (loaded, no error). */
  enabled: boolean;
  loops: readonly SavedLoop[];
  onSetA: () => void;
  onSetB: () => void;
  onClear: () => void;
  onSave: () => void;
  onPlayLoop: (loop: SavedLoop) => void;
  onRenameLoop: (loop: SavedLoop) => void;
  onDeleteLoop: (loop: SavedLoop) => void;
  onClose: () => void;
};

/**
 * #541 A-B repeat and #722 saved loops: set A and B at the playing position, clear them, save the loop with a name,
 * and play, rename or delete this video's saved loops. The video keeps playing behind the sheet.
 */
export const AbRepeatSheet = memo(function AbRepeatSheet({
  visible,
  points,
  positionSeconds,
  durationSeconds,
  enabled,
  loops,
  onSetA,
  onSetB,
  onClear,
  onSave,
  onPlayLoop,
  onRenameLoop,
  onDeleteLoop,
  onClose,
}: AbRepeatSheetProps) {
  const { t } = useTranslation();
  const loop = abLoopOf(points, durationSeconds);
  const anySet = points.a != null || points.b != null;
  const status = anySet ? abPointsLabel(t, points, durationSeconds) : t('videoPlayer.abNotSet');
  const here = formatPlaybackTime(positionSeconds);
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.tileAbRepeat')}
      subtitle={t('videoPlayer.abSheetHint')}
      onClose={onClose}
      testID="player-ab-repeat-sheet">
      <DsText
        variant="hero"
        align="center"
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="player-ab-repeat-status">
        {status}
      </DsText>
      {/* A on the left and B on the right in every language: they are points on a time line. */}
      <View style={[styles.row, { direction: 'ltr' }]}>
        <DsButton
          label={t('videoPlayer.abSetA')}
          variant="secondary"
          flex
          disabled={!enabled}
          accessibilityLabel={t('videoPlayer.abSetAA11y', { time: here })}
          onPress={onSetA}
          testID="player-ab-set-a"
        />
        <DsButton
          label={t('videoPlayer.abSetB')}
          variant="secondary"
          flex
          disabled={!enabled}
          accessibilityLabel={t('videoPlayer.abSetBA11y', { time: here })}
          onPress={onSetB}
          testID="player-ab-set-b"
        />
      </View>
      <View style={styles.row}>
        <DsButton
          label={t('videoPlayer.abClear')}
          variant="secondary"
          flex
          disabled={!anySet}
          accessibilityLabel={t('videoPlayer.abClearA11y')}
          onPress={onClear}
          testID="player-ab-clear"
        />
        <DsButton
          label={t('videoPlayer.abSave')}
          flex
          disabled={!loop}
          onPress={onSave}
          testID="player-ab-save"
        />
      </View>
      <DsText variant="section" accessibilityRole="header" style={styles.heading}>
        {t('videoPlayer.savedLoops')}
      </DsText>
      {loops.length === 0 ? (
        <DsText variant="rowSub" testID="player-saved-loops-empty">
          {t('videoPlayer.savedLoopsEmpty')}
        </DsText>
      ) : (
        <DsRowGroup testID="player-saved-loops">
          {loops.map((saved) => (
            <DsRow
              key={saved.id}
              icon="repeat"
              title={saved.name}
              subtitle={loopSpanLabel(saved.startMs / 1000, saved.endMs / 1000)}
              disabled={!enabled}
              onPress={() => onPlayLoop(saved)}
              accessibilityLabel={t('videoPlayer.loopPlayA11y', {
                name: saved.name,
                span: loopSpanLabel(saved.startMs / 1000, saved.endMs / 1000),
              })}
              trailing={
                <View style={styles.rowActions}>
                  <DsIconButton
                    icon="pencil"
                    variant="plain"
                    accessibilityLabel={t('videoPlayer.loopRenameA11y', { name: saved.name })}
                    onPress={() => onRenameLoop(saved)}
                    testID={`player-saved-loop-rename-${saved.id}`}
                  />
                  <DsIconButton
                    icon="trash-2"
                    variant="plain"
                    accessibilityLabel={t('videoPlayer.loopDeleteA11y', { name: saved.name })}
                    onPress={() => onDeleteLoop(saved)}
                    testID={`player-saved-loop-delete-${saved.id}`}
                  />
                </View>
              }
              testID={`player-saved-loop-${saved.id}`}
            />
          ))}
        </DsRowGroup>
      )}
    </PlayerSheetFrame>
  );
});

export type LoopNameModalProps = {
  visible: boolean;
  title: string;
  /** The name the field starts with (a suggested "Loop 3", or the loop's name when renaming). */
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
};

/** #722: the name of a loop being saved or renamed. */
export const LoopNameModal = memo(function LoopNameModal(props: LoopNameModalProps) {
  if (!props.visible) {
    return null;
  }
  // Keyed: each opening starts from its own initial name.
  return <LoopNameForm key={`${props.title}:${props.initialName}`} {...props} />;
});

function LoopNameForm({ title, initialName, onSave, onClose }: LoopNameModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialName);
  const clean = normalizeLoopName(draft);
  return (
    <AppModal visible onClose={onClose} title={title} testID="player-loop-name-modal">
      <View style={styles.form}>
        <TextField
          label={t('videoPlayer.loopName')}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_LOOP_NAME_LENGTH}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          onSubmitEditing={() => {
            if (clean) {
              onSave(clean);
            }
          }}
          accessibilityLabel={t('videoPlayer.loopName')}
          testID="player-loop-name-field"
        />
        <DsButtonRow>
          <DsButton
            label={t('common.save')}
            flex
            disabled={!clean}
            onPress={() => {
              if (clean) {
                onSave(clean);
              }
            }}
            testID="player-loop-name-save"
          />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="player-loop-name-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  status: {
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  heading: {
    marginTop: 8,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  form: {
    gap: 12,
  },
});
