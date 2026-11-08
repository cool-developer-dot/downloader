import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Button } from '@/components/buttons/Button';
import { TextField } from '@/components/inputs/TextField';
import { Switch } from '@/components/inputs/Switch';
import { SheetFrame } from '@/browser/startup/components/SheetFrame';
import { useWebViewCacheSize } from '@/browser/data-saver/cache-limit.service';
import {
  BATTERY_SAVER_MODES,
  CACHE_LIMITS,
  exceptionSite,
  normalizeBatterySaver,
  normalizeCacheLimit,
  parseImageExceptions,
  serializeImageExceptions,
  type BatterySaverMode,
  type CacheLimit,
} from '@/browser/data-saver/data-saver-settings';
import { formatDownloadFileSize } from '@/screens/downloads/utils/download-format';
import { useTranslation, type TranslationKey } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import type { SettingsKey } from '@/store/settings/types';

import { SettingsRow, SettingsSection } from '../components';
import { ChoiceSheet, type ChoiceOption } from './ChoiceSheet';

const BATTERY_LABELS: Record<BatterySaverMode, TranslationKey> = {
  off: 'browserDataSaver.batteryOff',
  phone: 'browserDataSaver.batteryPhone',
  on: 'browserDataSaver.batteryOn',
};

type BooleanKey = Extract<SettingsKey, 'dataSaver' | 'blockImages' | 'imagesWifiOnly' | 'liteMode' | 'lightweightHome' | 'hardwareAcceleration'>;

function bytesLabel(bytes: number): string {
  return formatDownloadFileSize(String(Math.max(0, Math.round(bytes)))) ?? '0 B';
}

const SwitchRow = memo(function SwitchRow({
  setting,
  title,
  hint,
  icon,
  testID,
}: {
  setting: BooleanKey;
  title: string;
  hint: string;
  icon: string;
  testID: string;
}) {
  const update = useSettingsStore((s) => s.updateSetting);
  const value = useSettingsStore((s) => (setting === 'hardwareAcceleration' ? s[setting] !== false : s[setting] === true));
  return (
    <SettingsRow
      title={title}
      description={hint}
      icon={icon}
      trailing={<Switch value={value} onValueChange={(next) => update(setting, next)} accessibilityLabel={title} accessibilityHint={hint} testID={testID} />}
    />
  );
});

/** B18 — Browser settings → Data saver and performance. */
export const DataSaverSettingsSection = memo(function DataSaverSettingsSection() {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const battery = normalizeBatterySaver(useSettingsStore((s) => s.batterySaver));
  const cacheLimit = normalizeCacheLimit(useSettingsStore((s) => s.cacheLimitMb));
  const exceptions = parseImageExceptions(useSettingsStore((s) => s.imageExceptions));
  const cache = useWebViewCacheSize();
  const [picker, setPicker] = useState<'battery' | 'cache' | 'sites' | null>(null);

  const batteryOptions = useMemo(
    (): ChoiceOption<BatterySaverMode>[] => BATTERY_SAVER_MODES.map((value) => ({ value, label: t(BATTERY_LABELS[value]) })),
    [t],
  );
  const cacheLabel = (value: CacheLimit) => (value === '0' ? t('browserDataSaver.cacheOff') : t('browserDataSaver.cacheMb', { value }));
  const cacheOptions = useMemo(
    (): ChoiceOption<CacheLimit>[] =>
      CACHE_LIMITS.map((value) => ({ value, label: value === '0' ? t('browserDataSaver.cacheOff') : t('browserDataSaver.cacheMb', { value }) })),
    [t],
  );
  const sizeLabel = cache.size == null ? t('browserDataSaver.cacheUnknown') : bytesLabel(cache.size);

  return (
    <SettingsSection
      testID="browser-settings-data-saver"
      title={t('browserDataSaver.section')}
      description={t('browserDataSaver.sectionDescription')}
      icon="leaf">
      <SwitchRow setting="dataSaver" title={t('browserDataSaver.dataSaver')} hint={t('browserDataSaver.dataSaverHint')} icon="leaf" testID="browser-settings-data-saver-switch" />
      <SwitchRow setting="blockImages" title={t('browserDataSaver.blockImages')} hint={t('browserDataSaver.blockImagesHint')} icon="image-off-outline" testID="browser-settings-block-images" />
      <SwitchRow setting="imagesWifiOnly" title={t('browserDataSaver.imagesWifi')} hint={t('browserDataSaver.imagesWifiHint')} icon="wifi" testID="browser-settings-images-wifi" />
      <SettingsRow
        title={t('browserDataSaver.exceptions')}
        description={t('browserDataSaver.exceptionsHint')}
        icon="image-check-outline"
        value={String(exceptions.length)}
        onPress={() => setPicker('sites')}
        testID="browser-settings-image-exceptions"
      />
      <SwitchRow setting="liteMode" title={t('browserDataSaver.lite')} hint={t('browserDataSaver.liteHint')} icon="feather" testID="browser-settings-lite" />
      <SwitchRow setting="lightweightHome" title={t('browserDataSaver.lightHome')} hint={t('browserDataSaver.lightHomeHint')} icon="text-box-outline" testID="browser-settings-light-home" />
      <SettingsRow
        title={t('browserDataSaver.battery')}
        description={t('browserDataSaver.batteryHint')}
        icon="battery-heart-outline"
        value={t(BATTERY_LABELS[battery])}
        onPress={() => setPicker('battery')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserDataSaver.battery'), value: t(BATTERY_LABELS[battery]) })}
        testID="browser-settings-battery"
      />
      <SwitchRow setting="hardwareAcceleration" title={t('browserDataSaver.hardware')} hint={t('browserDataSaver.hardwareHint')} icon="chip" testID="browser-settings-hardware" />
      <SettingsRow
        title={t('browserDataSaver.cacheLimit')}
        description={t('browserDataSaver.cacheLimitHint', { size: sizeLabel })}
        icon="database-outline"
        value={cacheLabel(cacheLimit)}
        onPress={() => setPicker('cache')}
        accessibilityHint={t('browserSettings.chooseA11y', { setting: t('browserDataSaver.cacheLimit'), value: cacheLabel(cacheLimit) })}
        testID="browser-settings-cache-limit"
      />
      <SettingsRow
        title={cache.clearing ? t('browserDataSaver.clearing') : t('browserDataSaver.clearCache')}
        description={t('browserDataSaver.clearCacheHint')}
        icon="broom"
        onPress={cache.clearing ? undefined : () => void cache.clear()}
        showDivider={false}
        testID="browser-settings-clear-cache"
      />
      <ChoiceSheet
        visible={picker === 'battery'}
        title={t('browserDataSaver.battery')}
        options={batteryOptions}
        value={battery}
        onSelect={(next) => update('batterySaver', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-battery-sheet"
      />
      <ChoiceSheet
        visible={picker === 'cache'}
        title={t('browserDataSaver.cacheLimit')}
        options={cacheOptions}
        value={cacheLimit}
        onSelect={(next) => update('cacheLimitMb', next)}
        onClose={() => setPicker(null)}
        testID="browser-settings-cache-sheet"
      />
      <ImageExceptionsSheet visible={picker === 'sites'} onClose={() => setPicker(null)} />
    </SettingsSection>
  );
});

/** B18 #183: the sites that always show pictures (add by typing; remove). */
const ImageExceptionsSheet = memo(function ImageExceptionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, rtl } = useTranslation();
  const update = useSettingsStore((s) => s.updateSetting);
  const list = parseImageExceptions(useSettingsStore((s) => s.imageExceptions));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();

  const add = () => {
    const site = exceptionSite(draft);
    if (!site) {
      setError(t('browserDataSaver.invalidSite'));
      return;
    }
    update('imageExceptions', serializeImageExceptions([...list, site]));
    setDraft('');
    setError(undefined);
  };

  return (
    <SheetFrame
      visible={visible}
      title={t('browserDataSaver.exceptions')}
      onClose={onClose}
      testID="browser-settings-image-exceptions-sheet"
      footer={
        <View style={{ flexDirection: rtl.rowDirection, gap: 12, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={t('browserDataSaver.addSite')}
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setError(undefined);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={add}
              error={error}
              testID="image-exceptions-field"
            />
          </View>
          <Button title={t('browserDataSaver.add')} onPress={add} testID="image-exceptions-add" />
        </View>
      }>
      {list.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary">
          {t('browserDataSaver.exceptionsEmpty')}
        </Text>
      ) : (
        <View>
          {list.map((site) => (
            <View key={site} style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: 48, gap: 8 }}>
              <Text variant="body" numberOfLines={1} style={{ flex: 1, writingDirection: 'ltr' }}>
                {site}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('browserDataSaver.removeSiteA11y', { site })}
                onPress={() => update('imageExceptions', serializeImageExceptions(list.filter((s) => s !== site)))}
                testID={`image-exceptions-remove-${site}`}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={20} color="secondary" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </SheetFrame>
  );
});
