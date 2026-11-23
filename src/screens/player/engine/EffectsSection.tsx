import { memo, useCallback, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, ToastAndroid, View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsChip, DsChipRow, DsRow, DsRowGroup, DsSectionLabel } from '@/design';
import { useTranslation, type TranslationKey } from '@/localization';
import type { AudioEffectsInfo } from '@modules/vidorax-media';
import {
  BUILT_IN_PRESETS,
  EQ_BANDS_HZ,
  EQ_MAX_DB,
  PRESET_NAME_MAX,
  choosePreset,
  deleteUserPreset,
  resetAudioEffects,
  saveUserPreset,
  setAudioEffects,
  setBandGain,
  useAudioEffects,
  type BuiltInPreset,
} from '@/player/engine/audio-effects';

import { EngineSlider } from './EngineSlider';

const PRESET_LABELS: Record<BuiltInPreset, TranslationKey> = {
  flat: 'playerEngine.eqPresetFlat',
  bass: 'playerEngine.eqPresetBass',
  vocal: 'playerEngine.eqPresetVocal',
  rock: 'playerEngine.eqPresetRock',
  pop: 'playerEngine.eqPresetPop',
  classical: 'playerEngine.eqPresetClassical',
  jazz: 'playerEngine.eqPresetJazz',
};

function bandName(hz: number): string {
  return hz >= 1000 ? `${Number((hz / 1000).toFixed(1))} kHz` : `${hz} Hz`;
}

function say(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * P19 in the Audio sheet (design screen 22): the equalizer with its presets and the user's own (#549, #550, #729),
 * bass boost, virtualizer and volume boost (#551, #552, #548), then balance, mono, night mode and normalization
 * (#556, #555, #557, #558). Every change applies at once and is kept app-wide.
 */
export const EffectsSection = memo(function EffectsSection({ info }: { info: AudioEffectsInfo | null }) {
  const { t } = useTranslation();
  const fx = useAudioEffects();
  const [naming, setNaming] = useState(false);
  // Unknown (no native module yet): offered; known: only what the phone has.
  const eqAvailable = info == null || info.equalizer;
  const bassAvailable = info == null || info.bassBoost;
  const virtualizerAvailable = info == null || info.virtualizer;

  const gainLabel = useCallback(
    (db: number) => t('playerEngine.eqGain', { gain: db > 0 ? `+${db}` : db === 0 ? '0' : `−${Math.abs(db)}` }),
    [t],
  );
  const percent = useCallback((n: number) => t('playerEngine.percent', { n }), [t]);
  const balanceLabel = useCallback(
    (n: number) =>
      n === 0
        ? t('playerEngine.balanceCentre')
        : n < 0
          ? t('playerEngine.balanceLeft', { n: Math.abs(n) })
          : t('playerEngine.balanceRight', { n }),
    [t],
  );

  return (
    <View testID="player-effects">
      <DsSectionLabel>{t('playerEngine.eqSection')}</DsSectionLabel>
      <DsRowGroup>
        <DsRow
          icon="sliders-horizontal"
          title={t('playerEngine.eqToggle')}
          subtitle={eqAvailable ? undefined : t('playerEngine.eqUnavailable')}
          disabled={!eqAvailable}
          toggle={{
            value: fx.eqEnabled && eqAvailable,
            onValueChange: (next) => setAudioEffects({ eqEnabled: next }),
            accessibilityLabel: t('playerEngine.eqToggle'),
          }}
          testID="player-eq-toggle"
        />
      </DsRowGroup>
      {eqAvailable ? (
        <>
          <DsChipRow testID="player-eq-presets">
            {BUILT_IN_PRESETS.map((preset) => (
              <DsChip
                key={preset}
                label={t(PRESET_LABELS[preset])}
                selected={fx.eqEnabled && fx.preset === preset}
                onPress={() => choosePreset(preset)}
                testID={`player-eq-preset-${preset}`}
              />
            ))}
            {fx.userPresets.map((preset) => (
              <DsChip
                key={preset.id}
                label={preset.name}
                selected={fx.eqEnabled && fx.preset === `user:${preset.id}`}
                onPress={() => choosePreset(`user:${preset.id}`)}
                testID={`player-eq-user-${preset.id}`}
              />
            ))}
            {fx.preset === 'custom' ? <DsChip label={t('playerEngine.eqPresetCustom')} selected={fx.eqEnabled} /> : null}
          </DsChipRow>
          {EQ_BANDS_HZ.map((hz, index) => (
            <EngineSlider
              key={hz}
              label={t('playerEngine.eqBand', { freq: bandName(hz) })}
              value={fx.gains[index] ?? 0}
              min={-EQ_MAX_DB}
              max={EQ_MAX_DB}
              step={1}
              origin={0}
              format={gainLabel}
              onCommit={(db) => setBandGain(index, db)}
              testID={`player-eq-band-${index}`}
            />
          ))}
          <DsRowGroup>
            <DsRow
              icon="save"
              title={t('playerEngine.eqSave')}
              subtitle={t('playerEngine.eqSaveSub')}
              onPress={() => setNaming(true)}
              testID="player-eq-save"
            />
            {fx.userPresets
              .filter((preset) => fx.preset === `user:${preset.id}`)
              .map((preset) => (
                <DsRow
                  key={preset.id}
                  icon="trash-2"
                  title={t('playerEngine.eqDelete', { name: preset.name })}
                  onPress={() => {
                    deleteUserPreset(preset.id);
                    say(t('playerEngine.eqDeleted'));
                  }}
                  testID={`player-eq-delete-${preset.id}`}
                />
              ))}
          </DsRowGroup>
        </>
      ) : null}

      <DsSectionLabel>{t('playerEngine.effectsSection')}</DsSectionLabel>
      <EngineSlider
        label={t('playerEngine.bassBoost')}
        value={fx.bassBoost}
        min={0}
        max={100}
        step={5}
        format={(n) => (bassAvailable ? percent(n) : t('playerEngine.effectUnavailable'))}
        onCommit={(n) => setAudioEffects({ bassBoost: n })}
        disabled={!bassAvailable}
        testID="player-fx-bass"
      />
      <EngineSlider
        label={t('playerEngine.virtualizer')}
        value={fx.virtualizer}
        min={0}
        max={100}
        step={5}
        format={(n) => (virtualizerAvailable ? percent(n) : t('playerEngine.effectUnavailable'))}
        onCommit={(n) => setAudioEffects({ virtualizer: n })}
        disabled={!virtualizerAvailable}
        testID="player-fx-virtualizer"
      />
      <EngineSlider
        label={t('playerEngine.volumeBoost')}
        value={fx.volumeBoost}
        min={100}
        max={200}
        step={10}
        format={(n) => (n <= 100 ? t('playerEngine.volumeBoostOff') : percent(n))}
        onCommit={(n) => setAudioEffects({ volumeBoost: n })}
        testID="player-fx-boost"
      />

      <DsSectionLabel>{t('playerEngine.soundSection')}</DsSectionLabel>
      <EngineSlider
        label={t('playerEngine.balance')}
        value={fx.balance}
        min={-100}
        max={100}
        step={10}
        origin={0}
        format={balanceLabel}
        onCommit={(n) => setAudioEffects({ balance: n })}
        testID="player-fx-balance"
      />
      <DsRowGroup>
        <DsRow
          icon="volume-2"
          title={t('playerEngine.mono')}
          subtitle={t('playerEngine.monoSub')}
          toggle={{ value: fx.mono, onValueChange: (mono) => setAudioEffects({ mono }), accessibilityLabel: t('playerEngine.mono') }}
          testID="player-fx-mono"
        />
        <DsRow
          icon="moon"
          title={t('playerEngine.nightMode')}
          subtitle={t('playerEngine.nightModeSub')}
          toggle={{
            value: fx.nightMode,
            onValueChange: (nightMode) => setAudioEffects({ nightMode }),
            accessibilityLabel: t('playerEngine.nightMode'),
          }}
          testID="player-fx-night"
        />
        <DsRow
          icon="gauge"
          title={t('playerEngine.normalize')}
          subtitle={t('playerEngine.normalizeSub')}
          toggle={{
            value: fx.normalize,
            onValueChange: (normalize) => setAudioEffects({ normalize }),
            accessibilityLabel: t('playerEngine.normalize'),
          }}
          testID="player-fx-normalize"
        />
        <DsRow icon="undo-2" title={t('playerEngine.effectsReset')} onPress={resetAudioEffects} testID="player-fx-reset" />
      </DsRowGroup>
      {/* #729: the name in a dialog of its own, so the keyboard never covers it. */}
      {naming ? <PresetNameModal onClose={() => setNaming(false)} /> : null}
    </View>
  );
});

function PresetNameModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const save = () => {
    const clean = name.trim();
    if (saveUserPreset(clean)) {
      say(t('playerEngine.eqSaved', { name: clean }));
      onClose();
    }
  };
  return (
    <AppModal visible onClose={onClose} title={t('playerEngine.eqSave')} subtitle={t('playerEngine.eqSaveSub')} testID="player-eq-save-modal">
      <View style={styles.form}>
        <TextField
          label={t('playerEngine.eqSaveName')}
          value={name}
          onChangeText={setName}
          maxLength={PRESET_NAME_MAX}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
          accessibilityLabel={t('playerEngine.eqSaveName')}
          testID="player-eq-save-name"
        />
        <DsButtonRow>
          <DsButton label={t('playerEngine.eqSaveButton')} flex disabled={!name.trim()} onPress={save} testID="player-eq-save-button" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="player-eq-save-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 12,
  },
});
