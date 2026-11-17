import { memo, type ReactNode } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsIconButton, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

export type LightSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
};

/**
 * The light design's bottom sheet: a white rounded panel over a dimmed page that scrolls its content. The design
 * screens open their existing editors (download hours, save location, advanced network…) in it, so every control the
 * old settings pages had stays reachable from a row of the new ones.
 */
export const LightSheet = memo(function LightSheet({ visible, title, subtitle, onClose, children, testID = 'light-sheet' }: LightSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, rtl } = useTranslation();

  useTourBlocker(visible);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: ds.radius.card,
            borderTopRightRadius: ds.radius.card,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '85%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.divider }]} />
          <View
            style={{
              flexDirection: rtl.rowDirection,
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: ds.space.screenX,
              paddingBottom: 8,
            }}>
            <View style={{ flex: 1, gap: 2 }}>
              <DsText variant="cardTitle" accessibilityRole="header" numberOfLines={2}>
                {title}
              </DsText>
              {subtitle ? <DsText variant="rowSub">{subtitle}</DsText> : null}
            </View>
            <DsIconButton icon="x" accessibilityLabel={t('common.close')} onPress={onClose} testID={`${testID}-close`} />
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 8, gap: ds.space.stack }}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
});
