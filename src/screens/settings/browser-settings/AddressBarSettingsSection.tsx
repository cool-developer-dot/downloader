import { memo, useMemo, useState } from 'react';

import { Switch } from '@/components/inputs/Switch';
import {
  ADDRESS_BAR_POSITIONS,
  normalizeAddressBarPosition,
  type AddressBarPosition,
} from '@/browser/address-bar/address-bar-settings';
import { useTranslation } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

/** B4 — Browser settings → Address bar: position (#28) and hide while scrolling (#29). */
export const AddressBarSettingsSection = memo(function AddressBarSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const position = normalizeAddressBarPosition(useSettingsStore((s) => s.addressBarPosition));
  const autoHide = useSettingsStore((s) => s.addressBarAutoHide === true);
  const [picker, setPicker] = useState(false);

  const options = useMemo(
    (): ChoiceOption<AddressBarPosition>[] =>
      ADDRESS_BAR_POSITIONS.map((value) => ({
        value,
        label: value === 'top' ? t('browserAddress.positionTop') : t('browserAddress.positionBottom'),
      })),
    [t],
  );
  const positionLabel = position === 'top' ? t('browserAddress.positionTop') : t('browserAddress.positionBottom');

  return (
    <SettingsSection
      testID="browser-settings-address-bar"
      title={t('browserAddress.section')}
      description={t('browserAddress.sectionDescription')}
      icon="form-textbox">
      <SettingsRow
        title={t('browserAddress.position')}
        description={t('browserAddress.positionHint')}
        icon="dock-bottom"
        value={positionLabel}
        onPress={() => setPicker(true)}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserAddress.position'), value: positionLabel })}
        testID="browser-settings-address-position"
      />
      <SettingsRow
        title={t('browserAddress.autoHide')}
        description={t('browserAddress.autoHideHint')}
        icon="arrow-collapse-up"
        showDivider={false}
        trailing={
          <Switch
            value={autoHide}
            onValueChange={(next) => update('addressBarAutoHide', next)}
            accessibilityLabel={t('browserAddress.autoHide')}
            accessibilityHint={t('browserAddress.autoHideHint')}
            testID="browser-settings-address-autohide"
          />
        }
      />
      <ChoiceSheet
        visible={picker}
        title={t('browserAddress.position')}
        options={options}
        value={position}
        onSelect={(next) => update('addressBarPosition', next)}
        onClose={() => setPicker(false)}
        testID="browser-settings-position-sheet"
      />
    </SettingsSection>
  );
});
