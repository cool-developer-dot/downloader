import { memo } from 'react';

import { DsIcon, DsRow, DsRowGroup, type DsIconName } from '@/design';
import { useTranslation } from '@/localization';

import { PlayerSheetFrame } from '../page/PlayerSheetFrame';

export type EngineChoice<Value extends string | number> = {
  value: Value;
  label: string;
  subtitle?: string;
  icon?: DsIconName;
};

export type EngineChoiceSheetProps<Value extends string | number> = {
  visible: boolean;
  title: string;
  subtitle?: string;
  choices: readonly EngineChoice<Value>[];
  /** The current choice (marked with a check and announced as selected); null when none is. */
  selected: Value | null;
  onSelect: (value: Value) => void;
  onClose: () => void;
  testID: string;
};

/**
 * One choice from a short list, in the Player's sheet look: each row a title and an optional line under it, the
 * current one ticked. Faran's packages use it for stream quality, the sleep timer and the playback limit.
 */
function EngineChoiceSheetInner<Value extends string | number>({
  visible,
  title,
  subtitle,
  choices,
  selected,
  onSelect,
  onClose,
  testID,
}: EngineChoiceSheetProps<Value>) {
  const { t } = useTranslation();
  return (
    <PlayerSheetFrame visible={visible} title={title} subtitle={subtitle} onClose={onClose} testID={testID}>
      <DsRowGroup>
        {choices.map((choice) => {
          const isSelected = choice.value === selected;
          const spoken = choice.subtitle ? `${choice.label}, ${choice.subtitle}` : choice.label;
          return (
            <DsRow
              key={String(choice.value)}
              icon={choice.icon}
              title={choice.label}
              subtitle={choice.subtitle}
              onPress={() => onSelect(choice.value)}
              trailing={isSelected ? <DsIcon name="check" size={20} /> : 'none'}
              accessibilityLabel={isSelected ? `${spoken}, ${t('common.selected')}` : spoken}
              testID={`${testID}-${choice.value}`}
            />
          );
        })}
      </DsRowGroup>
    </PlayerSheetFrame>
  );
}

export const EngineChoiceSheet = memo(EngineChoiceSheetInner) as typeof EngineChoiceSheetInner;
