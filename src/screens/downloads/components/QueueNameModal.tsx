import { memo, useEffect, useMemo, useState } from 'react';

import type { DownloadQueue } from '@modules/vidorax-media/src/VidoraMedia.types';

import { Box } from '@/components/base/Box';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { AppModal } from '@/components/modals/AppModal';
import { MAX_QUEUE_NAME_LENGTH, queueNameProblem } from '@/downloads/v2/queue-order';
import { useTranslation } from '@/localization';

export type QueueNameModalProps = {
  visible: boolean;
  /** The queue being renamed; null creates a new one. */
  queue: DownloadQueue | null;
  queues: readonly DownloadQueue[];
  saving: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
};

/** H4: the name of a new queue, or a new name for one. */
export const QueueNameModal = memo(function QueueNameModal({
  visible,
  queue,
  queues,
  saving,
  onSave,
  onClose,
}: QueueNameModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(queue?.name ?? '');

  useEffect(() => {
    if (visible) {
      setName(queue?.name ?? '');
    }
  }, [queue, visible]);

  const problem = useMemo(
    () => queueNameProblem(name, queues, { exceptId: queue?.id, mainName: t('queueOrder.main') }),
    [name, queue?.id, queues, t],
  );
  const error =
    name.length === 0 || problem === null || problem === 'empty'
      ? undefined
      : problem === 'too-long'
        ? t('queueOrder.nameTooLong', { max: String(MAX_QUEUE_NAME_LENGTH) })
        : t('queueOrder.nameDuplicate');

  return (
    <AppModal
      visible={visible}
      onClose={saving ? undefined : onClose}
      title={queue ? t('queueOrder.renameTitle') : t('queueOrder.newQueue')}
      testID="queue-name-modal">
      <Box gap={12}>
        <TextField
          label={t('queueOrder.queueName')}
          value={name}
          onChangeText={setName}
          error={error}
          maxLength={MAX_QUEUE_NAME_LENGTH + 10}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!problem && !saving) {
              onSave(name.trim());
            }
          }}
          testID="queue-name-input"
        />
        <Box row rtlRow gap={8}>
          <Box flex={1}>
            <Button title={t('common.cancel')} variant="outline" onPress={onClose} disabled={saving} fullWidth />
          </Box>
          <Box flex={1}>
            <Button
              title={queue ? t('common.save') : t('queueOrder.create')}
              onPress={() => onSave(name.trim())}
              disabled={problem !== null}
              loading={saving}
              fullWidth
              testID="queue-name-save"
            />
          </Box>
        </Box>
      </Box>
    </AppModal>
  );
});
