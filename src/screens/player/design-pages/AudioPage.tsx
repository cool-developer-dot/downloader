import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsCard, DsChip, DsChipRow, DsRow, DsRowGroup, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useRtl, useTranslation, type TranslationKey } from '@/localization';
import {
  BUILT_IN_PRESETS,
  choosePreset,
  EQ_BANDS_HZ,
  EQ_MAX_DB,
  setAudioEffects,
  useAudioEffects,
  type BuiltInPreset,
} from '@/player/engine/audio-effects';
import type { PlayerOptionContext } from '@/player/options';

import { PlayerDesignPage } from './PlayerDesignPage';
import { PlayerOptionRows } from './PlayerOptionRows';

const PRESET_LABELS: Record<BuiltInPreset, TranslationKey> = {
  flat: 'playerEngine.eqPresetFlat',
  bass: 'playerEngine.eqPresetBass',
  vocal: 'playerEngine.eqPresetVocal',
  rock: 'playerEngine.eqPresetRock',
  pop: 'playerEngine.eqPresetPop',
  classical: 'playerEngine.eqPresetClassical',
  jazz: 'playerEngine.eqPresetJazz',
};

/** Design 22's band labels: 60 · 230 · 910 · 3k · 14k. */
function bandLabel(hz: number): string {
  return hz >= 1000 ? `${Math.round(hz / 1000)}k` : String(hz);
}

/** "Bass boost · Virtualizer" on: both at half strength (the Audio sheet sets each exactly). */
const BASS_VIRT_ON = 50;

export type AudioPageProps = {
  visible: boolean;
  context: PlayerOptionContext;
  /** Faran's Audio sheet: every band, bass boost, virtualizer, balance, the sound settings. */
  onOpenAudioSheet: () => void;
  onBack: () => void;
  onSettings: () => void;
};

/** Design 22: the presets, the five bands, then P19's effects and P17's / P15's audio rows. */
export const AudioPage = memo(function AudioPage({ visible, context, onOpenAudioSheet, onBack, onSettings }: AudioPageProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const rtl = useRtl();
  const fx = useAudioEffects();
  const userPreset = fx.preset.startsWith('user:') ? fx.userPresets.find((p) => `user:${p.id}` === fx.preset) : null;
  const bassVirtOn = fx.bassBoost > 0 || fx.virtualizer > 0;
  const balanceMono = fx.mono
    ? t('playerDesign.valueMono')
    : fx.balance === 0
      ? t('playerDesign.valueStereo')
      : fx.balance < 0
        ? t('playerEngine.balanceLeft', { n: Math.abs(fx.balance) })
        : t('playerEngine.balanceRight', { n: fx.balance });

  return (
    <PlayerDesignPage
      visible={visible}
      title={t('playerEngine.audioTitle')}
      subtitle={t('playerDesign.audioSub')}
      onBack={onBack}
      onSettings={onSettings}
      testID="player-audio-page">
      <DsChipRow testID="player-audio-presets">
        {BUILT_IN_PRESETS.map((preset) => (
          <DsChip
            key={preset}
            label={t(PRESET_LABELS[preset])}
            selected={fx.eqEnabled && fx.preset === preset}
            onPress={() => choosePreset(preset)}
            testID={`player-audio-preset-${preset}`}
          />
        ))}
        {fx.userPresets.map((preset) => (
          <DsChip
            key={preset.id}
            label={preset.name}
            selected={fx.eqEnabled && userPreset?.id === preset.id}
            onPress={() => choosePreset(`user:${preset.id}`)}
          />
        ))}
        <DsChip
          label={t('playerEngine.eqPresetCustom')}
          selected={fx.eqEnabled && fx.preset === 'custom'}
          onPress={onOpenAudioSheet}
          testID="player-audio-preset-custom"
        />
      </DsChipRow>

      <DsCard>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playerDesign.eqChartA11y')}
          onPress={onOpenAudioSheet}
          style={{ margin: -ds.space.cardPad, padding: ds.space.cardPad, paddingTop: 18 }}
          testID="player-audio-eq-chart">
          <View style={{ flexDirection: rtl.rowDirection, justifyContent: 'space-between', alignItems: 'flex-end', height: 86 }}>
            {EQ_BANDS_HZ.map((hz, index) => {
              const gain = fx.eqEnabled ? (fx.gains[index] ?? 0) : 0;
              const height = 14 + ((gain + EQ_MAX_DB) / (2 * EQ_MAX_DB)) * 70;
              return (
                <View key={hz} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 86 }}>
                  <View
                    style={{
                      width: 6,
                      height,
                      borderRadius: 3,
                      backgroundColor: fx.eqEnabled ? theme.colors.primary : theme.colors.border,
                    }}
                  />
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: rtl.rowDirection, marginTop: 10 }}>
            {EQ_BANDS_HZ.map((hz) => (
              <DsText key={hz} variant="rowSub" align="center" style={{ flex: 1 }}>
                {bandLabel(hz)}
              </DsText>
            ))}
          </View>
        </Pressable>
      </DsCard>

      <DsRowGroup testID="player-audio-effects">
        <DsRow
          icon="sliders-horizontal"
          title={t('playerDesign.eqToggle')}
          toggle={{ value: fx.eqEnabled, onValueChange: (on) => setAudioEffects({ eqEnabled: on }) }}
          testID="player-audio-eq-toggle"
        />
        <DsRow
          icon="volume-2"
          title={t('playerDesign.rowBassVirt')}
          toggle={{
            value: bassVirtOn,
            onValueChange: (on) =>
              setAudioEffects(on ? { bassBoost: BASS_VIRT_ON, virtualizer: BASS_VIRT_ON } : { bassBoost: 0, virtualizer: 0 }),
          }}
          testID="player-audio-bass-virt"
        />
        <DsRow
          icon="sliders-vertical"
          title={t('playerDesign.rowBalanceMono')}
          value={balanceMono}
          onPress={onOpenAudioSheet}
          testID="player-audio-balance"
        />
        <DsRow
          icon="moon"
          title={t('playerDesign.rowNightModeAudio')}
          toggle={{ value: fx.nightMode, onValueChange: (on) => setAudioEffects({ nightMode: on }) }}
          testID="player-audio-night"
        />
        <DsRow
          icon="sliders-horizontal"
          title={t('playerDesign.rowNormalization')}
          subtitle={t('playerEngine.normalizeSub')}
          toggle={{ value: fx.normalize, onValueChange: (on) => setAudioEffects({ normalize: on }) }}
          testID="player-audio-normalize"
        />
      </DsRowGroup>
      <PlayerOptionRows
        context={context}
        ids={['p17.audioDelay', 'p15.headsetKeys', 'p17.audioTrack', 'p19.volumeBoost', 'p17.audioOnly']}
        titles={{ 'p15.headsetKeys': 'playerDesign.rowHeadphones' }}
        onClosePage={onBack}
      />
    </PlayerDesignPage>
  );
});
