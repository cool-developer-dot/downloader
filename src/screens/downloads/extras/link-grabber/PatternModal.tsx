import { memo, useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { DsButton, DsButtonRow, DsText } from '@/design';
import { useTranslation } from '@/localization';

import { expandPattern } from './link-grabber-model';

export type PatternModalProps = {
  visible: boolean;
  /** The pattern used last, shown again. */
  initial: string;
  onAdd: (pattern: string, links: string[]) => void;
  onClose: () => void;
};

/** Design 43 → Pattern download: a `file[01-20].jpg` range typed once becomes one link per number. */
export const PatternModal = memo(function PatternModal({ visible, initial, onAdd, onClose }: PatternModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(initial);
      setError(null);
    }
  }, [initial, visible]);

  const add = useCallback(() => {
    const links = expandPattern(draft);
    if (links.length === 0) {
      setError(t('lightLinkGrabber.patternInvalid'));
      return;
    }
    onAdd(draft.trim(), links);
    onClose();
  }, [draft, onAdd, onClose, t]);

  return (
    <AppModal visible={visible} onClose={onClose} title={t('lightLinkGrabber.patternDownload')} testID="link-grabber-pattern-modal">
      <View style={{ gap: 12 }}>
        <DsText variant="rowSub">{t('lightLinkGrabber.patternHint')}</DsText>
        <TextField
          label={t('lightLinkGrabber.patternLabel')}
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setError(null);
          }}
          placeholder="https://example.com/file[01-20].jpg"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={error ?? undefined}
          accessibilityLabel={t('lightLinkGrabber.patternLabel')}
          testID="link-grabber-pattern-field"
        />
        <DsButtonRow>
          <DsButton label={t('lightLinkGrabber.patternAdd')} flex onPress={add} disabled={!draft.trim()} testID="link-grabber-pattern-add" />
          <DsButton label={t('common.cancel')} variant="secondary" flex onPress={onClose} testID="link-grabber-pattern-cancel" />
        </DsButtonRow>
      </View>
    </AppModal>
  );
});
