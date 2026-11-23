import { memo, type ReactNode } from 'react';
import { Modal, Pressable as RNPressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourBlocker } from '@/tour/tour-store';

export type PlayerSheetFrameProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
};

/**
 * A Player bottom sheet with free content (the options sheet's look: theme background, rounded top, handle, title):
 * P3's subtitle sync and P4's subtitle style. Back and a tap outside close it.
 */
export const PlayerSheetFrame = memo(function PlayerSheetFrame({
  visible,
  title,
  subtitle,
  onClose,
  children,
  testID,
}: PlayerSheetFrameProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  useTourBlocker(visible);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            paddingTop: 8,
            paddingBottom: insets.bottom + 12,
            maxHeight: '90%',
          }}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <View style={styles.title}>
            <DsText variant="cardTitle" accessibilityRole="header">
              {title}
            </DsText>
            {subtitle ? <DsText variant="rowSub">{subtitle}</DsText> : null}
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 8, gap: ds.space.stack }}
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  title: { paddingHorizontal: ds.space.screenX, paddingBottom: ds.space.stack, gap: 2 },
});
