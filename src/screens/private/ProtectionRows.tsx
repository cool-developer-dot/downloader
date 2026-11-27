import type { ReactElement } from 'react';

import { DsRow, type DsIconName } from '@/design';
import type { TranslateFn, TranslationKey } from '@/localization';
import { ALWAYS_ON_PROTECTIONS, isInfoRowProtection, type AlwaysOnProtection } from '@/screens/settings/security/security-settings';

import { announce } from '../files/announce';

const ROWS: Record<AlwaysOnProtection, { icon: DsIconName; title: TranslationKey; hint: TranslationKey }> = {
  fileEncryption: { icon: 'lock', title: 'fileManager.fileEncryption', hint: 'fileManager.fileEncryptionHint' },
  hideHistory: { icon: 'history', title: 'fileManager.hideHistory', hint: 'fileManager.hideHistoryHint' },
  malwareWarning: { icon: 'alert-triangle', title: 'fileManager.malwareWarning', hint: 'fileManager.malwareWarningHint' },
};

/**
 * Files F10 (designs 29 and 64): File encryption (#909), Hide history and Malware warning — protections VidoraX never
 * turns off. Encryption and Hide history are the design's switches that stay On (a tap says so; nothing changes);
 * Malware warning is a plain info row, "Malware warning · Always on", since P8 has no setting behind it. Returned as
 * rows so a `DsRowGroup` draws its dividers between them.
 */
export function protectionRows(t: TranslateFn, testIDPrefix: string): ReactElement[] {
  return ALWAYS_ON_PROTECTIONS.map((key) => {
    const row = ROWS[key];
    const title = t(row.title);
    if (isInfoRowProtection(key)) {
      return (
        <DsRow
          key={key}
          icon={row.icon}
          title={title}
          subtitle={t(row.hint)}
          value={t('fileManager.alwaysOnValue')}
          testID={`${testIDPrefix}-${key}`}
        />
      );
    }
    return (
      <DsRow
        key={key}
        icon={row.icon}
        title={title}
        subtitle={t(row.hint)}
        toggle={{
          value: true,
          onValueChange: () => announce(t('fileManager.alwaysOn', { name: title })),
          accessibilityHint: t(row.hint),
        }}
        testID={`${testIDPrefix}-${key}`}
      />
    );
  });
}
