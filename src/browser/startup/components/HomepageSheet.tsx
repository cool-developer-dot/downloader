import { memo, useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { useTranslation } from '@/localization';

import { normalizeHomepageInput } from '../startup-settings';
import { RadioRow } from './RadioRow';
import { SheetFrame } from './SheetFrame';

/** B21 #232 — the homepage: the start page (default) or a web address the user types (checked before it's saved). */
export const HomepageSheet = memo(function HomepageSheet({
  visible,
  value,
  onSave,
  onClose,
}: {
  visible: boolean;
  /** '' = the start page. */
  value: string;
  onSave: (homepage: string) => void;
  onClose: () => void;
}) {
  const { t, rtl } = useTranslation();
  const [useAddress, setUseAddress] = useState(value !== '');
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!visible) return;
    setUseAddress(value !== '');
    setText(value);
    setError(undefined);
  }, [value, visible]);

  const save = () => {
    if (!useAddress) {
      onSave('');
      onClose();
      return;
    }
    const normalized = normalizeHomepageInput(text);
    if (!normalized) {
      setError(t('browserStartup.homepageInvalid'));
      return;
    }
    onSave(normalized);
    onClose();
  };

  return (
    <SheetFrame
      visible={visible}
      title={t('browserStartup.homepage')}
      onClose={onClose}
      testID="browser-settings-homepage-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 12 }}>
          <Button title={t('common.cancel')} variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button title={t('common.save')} onPress={save} style={{ flex: 1 }} testID="browser-settings-homepage-save" />
        </View>
      }>
      <View accessibilityRole="radiogroup">
        <RadioRow
          label={t('browserStartup.homepageUseStartPage')}
          selected={!useAddress}
          onPress={() => {
            setUseAddress(false);
            setError(undefined);
          }}
          testID="browser-settings-homepage-start"
        />
        <RadioRow
          label={t('browserStartup.homepageUseAddress')}
          selected={useAddress}
          onPress={() => setUseAddress(true)}
          testID="browser-settings-homepage-address"
        />
      </View>
      {useAddress ? (
        <TextField
          value={text}
          onChangeText={(next) => {
            setText(next);
            setError(undefined);
          }}
          placeholder={t('browserStartup.homepagePlaceholder')}
          accessibilityLabel={t('browserStartup.homepageFieldA11y')}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={save}
          error={error}
          testID="browser-settings-homepage-field"
        />
      ) : null}
    </SheetFrame>
  );
});
