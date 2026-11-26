import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, View, type ListRenderItem } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ds, DsCard, DsHeader, DsText } from '@/design';
import { fileLabel } from '@/files/ui/file-fields';
import type { FileEntry } from '@/files/ui/files-index';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';

import { listAllFiles } from '../hooks/use-files-data';
import { fileMetaLine } from '../utils/file-rows';
import { FileRow } from './FileRow';

export type FilePickerModalProps = {
  visible: boolean;
  title: string;
  onPick: (file: FileEntry) => void;
  onClose: () => void;
  testID?: string;
};

/** Files F3: pick one of VidoraX's files (F2's "Checksum verify" picks the file to check). */
export const FilePickerModal = memo(function FilePickerModal({ visible, title, onPick, onClose, testID = 'files-file-picker' }: FilePickerModalProps) {
  const theme = useTheme();
  const { t, language } = useTranslation();
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const locale = intlLocaleForLanguage(language);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    let live = true;
    void listAllFiles()
      .catch(() => [] as FileEntry[])
      .then((all) => {
        if (live) setFiles([...all].sort((a, b) => fileLabel(a).localeCompare(fileLabel(b), undefined, { sensitivity: 'base', numeric: true })));
      });
    return () => {
      live = false;
    };
  }, [visible]);

  const renderFile = useCallback<ListRenderItem<FileEntry>>(
    ({ item, index }) => (
      <FileRow
        file={item}
        name={fileLabel(item)}
        meta={fileMetaLine(item, locale)}
        showThumbnail={false}
        first={index === 0}
        last={index === (files?.length ?? 0) - 1}
        onPress={onPick}
        testID={`${testID}-${item.id}`}
      />
    ),
    [files?.length, locale, onPick, testID],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: theme.colors.background }} testID={testID}>
        <FlatList
          data={files ?? []}
          keyExtractor={(file) => file.id}
          renderItem={renderFile}
          contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={{ paddingBottom: ds.space.stack }}>
              <DsHeader title={title} action={{ icon: 'x', accessibilityLabel: t('common.close'), onPress: onClose, testID: `${testID}-close` }} />
            </View>
          }
          ListEmptyComponent={
            files === null ? (
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t('common.loading')} />
            ) : (
              <DsCard>
                <DsText variant="body" align="center">
                  {t('fileManager.typeEmpty')}
                </DsText>
              </DsCard>
            )
          }
        />
      </SafeAreaView>
    </Modal>
  );
});
