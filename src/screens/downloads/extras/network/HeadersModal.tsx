import { memo, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsIconButton, DsText } from '@/design';
import {
  addHeaderProblem,
  MAX_HEADER_NAME_LENGTH,
  MAX_HEADER_VALUE_LENGTH,
  MAX_HEADERS,
  type HeaderPair,
  type HeaderProblem,
} from '@/downloads/v2/network-options';
import { ensureNetworkHeadersHydrated, useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';

const PROBLEM_KEYS: Record<HeaderProblem, TranslationKey> = {
  'empty-name': 'networkOptions.problems.emptyName',
  'invalid-name': 'networkOptions.problems.invalidName',
  'refused-name': 'networkOptions.problems.refusedName',
  'name-too-long': 'networkOptions.problems.nameTooLong',
  'empty-value': 'networkOptions.problems.emptyValue',
  'value-too-long': 'networkOptions.problems.valueTooLong',
  'line-break': 'networkOptions.problems.lineBreak',
  'not-ascii': 'networkOptions.problems.notAscii',
  duplicate: 'networkOptions.problems.duplicate',
  'too-many': 'networkOptions.problems.tooMany',
};

/** A header value may be a key or token: only its last characters are ever shown (as in Download settings). */
function maskedValue(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

export type HeadersModalProps = {
  visible: boolean;
  onClose: () => void;
};

/** Design 44 → Custom headers · Referer (H15, #444): the saved headers, add one (a Referer for instance), remove, clear. */
export const HeadersModal = memo(function HeadersModal({ visible, onClose }: HeadersModalProps) {
  const { t, rtl } = useTranslation();
  const headers = useNetworkOptionsStore((s) => s.headers);
  const hydrated = useNetworkOptionsStore((s) => s.headersHydrated);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      void ensureNetworkHeadersHydrated();
      setName('');
      setValue('');
      setError(null);
    }
  }, [visible]);

  const add = useCallback(() => {
    // Read right before acting: the list may have changed since this was typed.
    const current = useNetworkOptionsStore.getState().headers;
    const pair: HeaderPair = { name: name.trim(), value: value.trim() };
    const problem = addHeaderProblem(current, pair);
    if (problem) {
      setError(
        t(PROBLEM_KEYS[problem], {
          name: pair.name,
          max: String(problem === 'too-many' ? MAX_HEADERS : problem === 'name-too-long' ? MAX_HEADER_NAME_LENGTH : MAX_HEADER_VALUE_LENGTH),
        }),
      );
      return;
    }
    useNetworkOptionsStore.getState().setHeaders([...current, pair]);
    setName('');
    setValue('');
    setError(null);
  }, [name, t, value]);

  const remove = useCallback((headerName: string) => {
    const current = useNetworkOptionsStore.getState().headers;
    useNetworkOptionsStore.getState().setHeaders(current.filter((header) => header.name !== headerName));
  }, []);

  return (
    <AppModal visible={visible} onClose={onClose} title={t('lightNetwork.customHeadersReferer')} subtitle={t('networkOptions.headersHint')} testID="network-headers-modal">
      <View style={{ gap: 12 }}>
        {!hydrated ? null : headers.length === 0 ? (
          <DsText variant="rowSub">{t('networkOptions.noHeaders')}</DsText>
        ) : (
          <View style={{ gap: 4 }}>
            {headers.map((header) => (
              <View key={header.name} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 8 }}>
                <DsText variant="body" color="textPrimary" numberOfLines={1} style={{ flex: 1 }}>
                  {`${header.name}: ${maskedValue(header.value)}`}
                </DsText>
                <DsIconButton
                  icon="x"
                  variant="plain"
                  accessibilityLabel={t('networkOptions.removeHeaderA11y', { name: header.name })}
                  onPress={() => remove(header.name)}
                  testID={`network-header-remove-${header.name}`}
                />
              </View>
            ))}
          </View>
        )}
        <TextField
          label={t('networkOptions.headerName')}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setError(null);
          }}
          maxLength={MAX_HEADER_NAME_LENGTH + 1}
          autoCapitalize="none"
          autoCorrect={false}
          disabled={!hydrated}
          accessibilityLabel={t('networkOptions.headerName')}
          testID="network-header-name"
        />
        <TextField
          label={t('networkOptions.headerValue')}
          value={value}
          onChangeText={(next) => {
            setValue(next);
            setError(null);
          }}
          maxLength={MAX_HEADER_VALUE_LENGTH + 1}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          disabled={!hydrated}
          error={error ?? undefined}
          accessibilityLabel={t('networkOptions.headerValue')}
          testID="network-header-value"
        />
        <DsButtonRow>
          <DsButton label={t('networkOptions.addHeader')} flex onPress={add} disabled={!hydrated || !name.trim() || !value.trim()} testID="network-header-add" />
          {headers.length > 0 ? (
            <DsButton
              label={t('networkOptions.clearHeaders')}
              variant="secondary"
              flex
              onPress={() => useNetworkOptionsStore.getState().setHeaders([])}
              testID="network-header-clear"
            />
          ) : (
            <DsButton label={t('common.close')} variant="secondary" flex onPress={onClose} testID="network-header-close" />
          )}
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
