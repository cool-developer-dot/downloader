import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsButton, DsButtonRow, DsIcon, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import {
  DAILY_LIMIT_MINUTES,
  SLEEP_TIMER_MINUTES,
  cancelSleepTimer,
  formatDuration,
  grantMoreTime,
  limitSecondsLeft,
  localDay,
  setDailyLimit,
  sleepAtEndOfVideo,
  sleepMinutesLeft,
  startSleepTimer,
  useLimitState,
  useSleepTimer,
} from '@/player/engine/sleep-limits';
import { AppLockPinInput } from '@/security/app-lock/AppLockPinInput';
import { selectAppLockEnabled, useAppLockStore } from '@/security/app-lock/app-lock.store';

import { PlayerSheetFrame } from '../page/PlayerSheetFrame';

/** "Off", "5 min" … for the sleep timer and the limit. */
function useDuration() {
  const { t } = useTranslation();
  return useCallback((minutes: number) => formatDuration(t, minutes), [t]);
}

// --- #644 --------------------------------------------------------------------------------------------------------

export const SleepTimerSheet = memo(function SleepTimerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const timer = useSleepTimer();
  const left = sleepMinutesLeft(timer);
  const choose = (action: () => void) => {
    action();
    onClose();
  };
  const tick = <DsIcon name="check" size={20} />;
  const spoken = (label: string, selected: boolean) => (selected ? `${label}, ${t('common.selected')}` : label);
  const minutesChosen = (minutes: number) => timer.mode === 'minutes' && timer.minutes === minutes;
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerEngine.sleepTitle')}
      subtitle={left != null ? t('playerEngine.sleepLeft', { time: duration(left) }) : t('playerEngine.sleepSubtitle')}
      onClose={onClose}
      testID="player-sleep-sheet">
      <DsRowGroup>
        <DsRow
          icon="x"
          title={t('playerEngine.sleepOff')}
          onPress={() => choose(cancelSleepTimer)}
          trailing={timer.mode === 'off' ? tick : 'none'}
          accessibilityLabel={spoken(t('playerEngine.sleepOff'), timer.mode === 'off')}
          testID="player-sleep-off"
        />
        {SLEEP_TIMER_MINUTES.map((minutes) => (
          <DsRow
            key={minutes}
            icon="timer"
            title={duration(minutes)}
            onPress={() => choose(() => startSleepTimer(minutes))}
            trailing={minutesChosen(minutes) ? tick : 'none'}
            accessibilityLabel={spoken(duration(minutes), minutesChosen(minutes))}
            testID={`player-sleep-${minutes}`}
          />
        ))}
        <DsRow
          icon="film"
          title={t('playerEngine.sleepEndOfVideo')}
          onPress={() => choose(sleepAtEndOfVideo)}
          trailing={timer.mode === 'endOfVideo' ? tick : 'none'}
          accessibilityLabel={spoken(t('playerEngine.sleepEndOfVideo'), timer.mode === 'endOfVideo')}
          testID="player-sleep-end"
        />
      </DsRowGroup>
    </PlayerSheetFrame>
  );
});

// --- #730: the parent's PIN (App Lock), when App Lock is on ------------------------------------------------------

/**
 * With App Lock on, changing the daily limit or giving more time asks for the App Lock PIN (so a child can't lift the
 * limit). Without App Lock the action runs at once (the sheet says how to protect it).
 */
export function useParentPin(): {
  protectedByPin: boolean;
  /** Runs `action` now, or after the PIN. */
  guard: (action: () => void) => void;
  pinSheet: ReactElement | null;
} {
  const protectedByPin = useAppLockStore(selectAppLockEnabled);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = useCallback(
    (action: () => void) => {
      if (protectedByPin) {
        setPending(() => action);
      } else {
        action();
      }
    },
    [protectedByPin],
  );
  const pinSheet = pending ? (
    <ParentPinSheet
      onVerified={() => {
        const action = pending;
        setPending(null);
        action();
      }}
      onClose={() => setPending(null)}
    />
  ) : null;
  return { protectedByPin, guard, pinSheet };
}

const ParentPinSheet = memo(function ParentPinSheet({
  onVerified,
  onClose,
}: {
  onVerified: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const error = useAppLockStore((state) => state.setupError);
  const busy = useAppLockStore((state) => state.isBusy);
  useEffect(() => () => useAppLockStore.getState().clearSetupError(), []);
  const check = useCallback(
    async (value: string) => {
      const ok = await useAppLockStore.getState().authenticatePin(value);
      setPin('');
      if (ok) {
        onVerified();
      }
    },
    [onVerified],
  );
  const message = error === 'mismatch' ? t('playerEngine.pinWrong') : error === 'throttled' ? t('playerEngine.pinThrottled') : null;
  return (
    <PlayerSheetFrame visible title={t('playerEngine.pinTitle')} subtitle={t('playerEngine.pinSubtitle')} onClose={onClose} testID="player-parent-pin">
      <View style={styles.pin}>
        <AppLockPinInput
          value={pin}
          onChange={setPin}
          onComplete={(value) => void check(value)}
          disabled={busy}
          error={message}
          accessibilityLabel={t('playerEngine.pinA11y')}
          autoFocus
          testID="player-parent-pin-input"
        />
      </View>
    </PlayerSheetFrame>
  );
});

// --- #730 --------------------------------------------------------------------------------------------------------

export const DailyLimitSheet = memo(function DailyLimitSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const limit = useLimitState();
  const { protectedByPin, guard, pinSheet } = useParentPin();
  const today = localDay(new Date());
  const used = limit.day === today ? limit.usedSeconds : 0;
  const choose = (minutes: number) =>
    guard(() => {
      setDailyLimit(minutes);
      onClose();
    });
  const tick = <DsIcon name="check" size={20} />;
  const choices = useMemo(() => [0, ...DAILY_LIMIT_MINUTES], []);
  const limitLabel = (minutes: number) =>
    minutes === 0 ? t('playerEngine.limitOff') : t('playerEngine.limitValue', { time: duration(minutes) });
  if (pinSheet) {
    return pinSheet;
  }
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('playerEngine.limitTitle')}
      subtitle={t('playerEngine.limitSubtitle')}
      onClose={onClose}
      testID="player-limit-sheet">
      <View style={styles.note}>
        <DsText variant="rowSub" testID="player-limit-used">
          {t('playerEngine.limitUsed', { time: duration(used / 60) })}
        </DsText>
        <DsText variant="rowSub">
          {protectedByPin ? t('playerEngine.limitProtected') : t('playerEngine.limitUnprotected')}
        </DsText>
      </View>
      <DsRowGroup>
        {choices.map((minutes) => (
          <DsRow
            key={minutes}
            icon={minutes === 0 ? 'x' : 'clock'}
            title={limitLabel(minutes)}
            onPress={() => choose(minutes)}
            trailing={limit.dailyMinutes === minutes ? tick : 'none'}
            accessibilityLabel={
              limit.dailyMinutes === minutes ? `${limitLabel(minutes)}, ${t('common.selected')}` : limitLabel(minutes)
            }
            testID={`player-limit-${minutes}`}
          />
        ))}
      </DsRowGroup>
    </PlayerSheetFrame>
  );
});

export const LimitReachedSheet = memo(function LimitReachedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const limit = useLimitState();
  const { guard, pinSheet } = useParentPin();
  const left = limitSecondsLeft(limit, localDay(new Date()));
  // More time given (or a new day): nothing to say any more.
  useEffect(() => {
    if (visible && left != null && left > 0) {
      onClose();
    }
  }, [left, onClose, visible]);
  if (pinSheet) {
    return pinSheet;
  }
  return (
    <PlayerSheetFrame visible={visible} title={t('playerEngine.limitReachedTitle')} onClose={onClose} testID="player-limit-reached">
      <View style={styles.note}>
        <DsText variant="body">{t('playerEngine.limitReachedBody', { time: duration(limit.dailyMinutes) })}</DsText>
      </View>
      <DsButtonRow>
        <DsButton
          label={t('playerEngine.limitMore')}
          variant="secondary"
          flex
          onPress={() => guard(() => grantMoreTime(15))}
          testID="player-limit-more"
        />
        <DsButton label={t('playerEngine.limitOk')} flex onPress={onClose} testID="player-limit-ok" />
      </DsButtonRow>
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  note: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  pin: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
