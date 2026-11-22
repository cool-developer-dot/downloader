import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsChip, DsChipRow, DsText } from '@/design';
import { MAX_USER_AGENT_LENGTH, validateUserAgent, type UserAgentMode } from '@/downloads/v2/network-options';
import { useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useTranslation } from '@/localization';

import { toast } from '../shared/toast';

export type UserAgentModalProps = {
  visible: boolean;
  onClose: () => void;
};

/** Design 44 → Custom user agent (H15, #443): Automatic (the browser's own) or a custom one-line ASCII string. */
export const UserAgentModal = memo(function UserAgentModal({ visible, onClose }: UserAgentModalProps) {
  const { t } = useTranslation();
  const savedMode = useNetworkOptionsStore((s) => s.userAgentMode);
  const savedAgent = useNetworkOptionsStore((s) => s.customUserAgent);
  const [mode, setMode] = useState<UserAgentMode>(savedMode);
  const [draft, setDraft] = useState(savedAgent);

  useEffect(() => {
    if (visible) {
      setMode(savedMode);
      setDraft(savedAgent);
    }
  }, [savedAgent, savedMode, visible]);

  const check = useMemo(() => validateUserAgent(draft), [draft]);
  const error = useMemo(() => {
    if (mode !== 'custom' || check.ok || draft.length === 0) {
      return null;
    }
    switch (check.reason) {
      case 'too-long':
        return t('networkOptions.userAgentTooLong', { max: String(MAX_USER_AGENT_LENGTH) });
      case 'line-break':
        return t('networkOptions.problems.lineBreak');
      case 'not-ascii':
        return t('networkOptions.problems.notAscii');
      default:
        return t('networkOptions.userAgentEmpty');
    }
  }, [check, draft.length, mode, t]);

  const save = useCallback(() => {
    const store = useNetworkOptionsStore.getState();
    if (mode === 'custom') {
      if (!check.ok) {
        return;
      }
      store.setCustomUserAgent(check.value);
    }
    store.setUserAgentMode(mode);
    toast(t('networkOptions.userAgentSaved'));
    onClose();
  }, [check, mode, onClose, t]);

  return (
    <AppModal visible={visible} onClose={onClose} title={t('lightNetwork.customUserAgent')} subtitle={t('networkOptions.warning')} testID="network-user-agent-modal">
      <View style={{ gap: 12 }}>
        <DsChipRow scroll={false}>
          <DsChip label={t('networkOptions.automatic')} selected={mode === 'automatic'} onPress={() => setMode('automatic')} testID="network-user-agent-automatic" />
          <DsChip label={t('networkOptions.custom')} selected={mode === 'custom'} onPress={() => setMode('custom')} testID="network-user-agent-custom" />
        </DsChipRow>
        {mode === 'custom' ? (
          <TextField
            label={t('networkOptions.userAgent')}
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_USER_AGENT_LENGTH + 1}
            autoCapitalize="none"
            autoCorrect={false}
            error={error ?? undefined}
            helperText={savedAgent ? undefined : t('networkOptions.userAgentEmpty')}
            accessibilityLabel={t('networkOptions.userAgent')}
            testID="network-user-agent-field"
          />
        ) : (
          <DsText variant="rowSub">{t('networkOptions.userAgentAutomaticHint')}</DsText>
        )}
        <DsButtonRow>
          <DsButton label={t('common.save')} flex onPress={save} disabled={mode === 'custom' && !check.ok} testID="network-user-agent-save" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="network-user-agent-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
