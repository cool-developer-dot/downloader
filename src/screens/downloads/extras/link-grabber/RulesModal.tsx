import { memo, useEffect, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { useTranslation } from '@/localization';

import type { LinkRules } from './link-grabber-model';

export type RulesModalProps = {
  visible: boolean;
  rules: LinkRules;
  onApply: (rules: LinkRules) => void;
  onClose: () => void;
};

/** Design 43 → Include / exclude rules: two text filters applied to the found links. */
export const RulesModal = memo(function RulesModal({ visible, rules, onApply, onClose }: RulesModalProps) {
  const { t } = useTranslation();
  const [include, setInclude] = useState(rules.include);
  const [exclude, setExclude] = useState(rules.exclude);

  useEffect(() => {
    if (visible) {
      setInclude(rules.include);
      setExclude(rules.exclude);
    }
  }, [rules, visible]);

  return (
    <AppModal visible={visible} onClose={onClose} title={t('lightLinkGrabber.includeExcludeRules')} testID="link-grabber-rules-modal">
      <View style={{ gap: 12 }}>
        <DsText variant="rowSub">{t('lightLinkGrabber.rulesHint')}</DsText>
        <TextField
          label={t('lightLinkGrabber.include')}
          value={include}
          onChangeText={setInclude}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('lightLinkGrabber.include')}
          testID="link-grabber-rules-include"
        />
        <TextField
          label={t('lightLinkGrabber.exclude')}
          value={exclude}
          onChangeText={setExclude}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('lightLinkGrabber.exclude')}
          testID="link-grabber-rules-exclude"
        />
        <DsButtonRow>
          <DsButton
            label={t('lightLinkGrabber.rulesApply')}
            flex
            onPress={() => {
              onApply({ include, exclude });
              onClose();
            }}
            testID="link-grabber-rules-apply"
          />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="link-grabber-rules-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
