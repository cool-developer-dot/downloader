import { memo } from 'react';
import { ScrollView, View } from 'react-native';

import { ds, DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { usePrivateVaultPrefs } from '@/private-vault/vault-prefs-store';

import { PinPad } from './PinPad';
import { PrivateDataLossNotice } from './PrivateDataLossNotice';
import { usePinGate } from './use-pin-gate';

export type PrivatePinGateProps = {
  onVerified: () => void;
  /** The tile's title and line (a locked folder shows its own name and note). Default: Private folder's. */
  title?: string;
  subtitle?: string;
  /** Private's first-time notice (where private videos live and what loses them); off for a locked folder. */
  showDataLossNotice?: boolean;
  testID?: string;
};

/**
 * Design 28 "Private folder · Lock" (Files F10): the lock tile, "Private folder", "Hidden from gallery & other apps",
 * the four dots and the 3 × 4 keypad with the fingerprint key and ⌫. Lock File (#413): Private always asks for the App
 * Lock PIN, even when VidoraX itself is unlocked; the check, its throttling and the biometric prompt are unchanged
 * (`usePinGate`). A locked folder (#910) uses the same gate.
 */
export const PrivatePinGate = memo(function PrivatePinGate({
  onVerified,
  title,
  subtitle,
  showDataLossNotice = true,
  testID = 'private-pin-gate',
}: PrivatePinGateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const dataLossAcknowledged = usePrivateVaultPrefs((s) => s.dataLossAcknowledged);
  const gate = usePinGate({ onVerified, promptMessage: t('privateVault.pinTitle') });

  return (
    <ScrollView
      testID={testID}
      contentContainerStyle={{ alignItems: 'center', paddingHorizontal: ds.space.screenX, paddingTop: 24, paddingBottom: 24, gap: 18 }}
      keyboardShouldPersistTaps="handled">
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          backgroundColor: theme.colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <DsIcon name="lock" size={28} color="primary" strokeWidth={2} />
      </View>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <DsText variant="cardTitle" align="center">
          {title ?? t('filesTab.privateFolder')}
        </DsText>
        <DsText variant="body" align="center">
          {subtitle ?? t('fileManager.privateHidden')}
        </DsText>
      </View>
      <PinPad
        state={gate.pad}
        onKey={gate.onKey}
        biometricOffered={gate.offersBiometric}
        disabled={gate.disabled}
        message={gate.message}
        testID="private-pin-input"
      />
      {/* The first time Private is opened, before any move, it says where private videos live and what loses them. */}
      {showDataLossNotice && !dataLossAcknowledged ? (
        <View style={{ alignSelf: 'stretch' }}>
          <PrivateDataLossNotice testID="private-pin-gate-data-loss" />
        </View>
      ) : null}
    </ScrollView>
  );
});
