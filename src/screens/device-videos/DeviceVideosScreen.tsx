import { memo, useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { openPlayer } from '@/navigation';
import { deviceMediaId, listDeviceVideos } from '@/player/device-media';
import { ensureDeviceVideoPermission } from '@/player/device-media-permission';
import type { DeviceVideo } from '@modules/vidorax-media/src/VidoraMedia.types';

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) {
    return '';
  }
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) {
    return '';
  }
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/** Videos already on the phone, played in VidoraX. Read-only: nothing here is copied, moved or deleted. */
export const DeviceVideosScreen = memo(function DeviceVideosScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [items, setItems] = useState<DeviceVideo[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(true);
  const [limited, setLimited] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const listing = await listDeviceVideos();
    setItems(listing.items);
    setPermissionGranted(listing.permissionGranted);
    setLimited(listing.access === 'selected');
    setAvailable(listing.available);
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      await ensureDeviceVideoPermission();
      await load();
    })();
  }, [load]);

  const onAllow = useCallback(async () => {
    await ensureDeviceVideoPermission({ force: true });
    await load();
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: DeviceVideo }) => {
      const meta = [formatDuration(item.durationMs), formatSize(item.sizeBytes)]
        .filter(Boolean)
        .join(' · ');
      return (
        <Pressable
          testID={`device-video-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={item.title}
          onPress={() => openPlayer(deviceMediaId(item), items.map(deviceMediaId))}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor: pressed ? theme.colors.surfacePressed : 'transparent',
          })}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: theme.radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surface,
            }}>
            <Icon name="play-circle-outline" size={24} color="primary" />
          </View>
          <Box flex={1} gap={2}>
            <Text variant="body" color="textPrimary" numberOfLines={1}>
              {item.title}
            </Text>
            {meta ? (
              <Text variant="bodySmall" color="textSecondary">
                {meta}
              </Text>
            ) : null}
          </Box>
        </Pressable>
      );
    },
    [items, theme],
  );

  const empty = !loading && items.length === 0;

  return (
    <SafeAreaScreen
      testID="device-videos-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('deviceVideos.title')}
        subtitle={limited ? t('deviceVideos.limited') : t('deviceVideos.subtitle')}
        testID="device-videos-header"
      />
      {empty ? (
        <Box p={24} gap={12} style={{ alignItems: 'center' }}>
          <Text variant="body" color="textSecondary" align="center">
            {!available
              ? t('deviceVideos.unavailable')
              : permissionGranted
                ? t('deviceVideos.empty')
                : t('deviceVideos.permission')}
          </Text>
          {available && !permissionGranted ? (
            <Pressable
              testID="device-videos-allow"
              accessibilityRole="button"
              onPress={() => {
                void onAllow();
              }}
              style={{
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.primary,
              }}>
              <Text variant="button" color="textOnPrimary">
                {t('deviceVideos.allow')}
              </Text>
            </Pressable>
          ) : null}
        </Box>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => {
                void load();
              }}
            />
          }
        />
      )}
    </SafeAreaScreen>
  );
});
