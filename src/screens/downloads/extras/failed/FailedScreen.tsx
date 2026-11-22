import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { DsButton, DsButtonRow, DsCard, DsHeader, DsProgressBar, DsRow, DsRowGroup, DsScreen, DsText } from '@/design';
import { canOfferRepair, fileIntegrity, repairMessageKey } from '@/downloads/v2/file-integrity';
import { AUTOMATIC_RETRY_LIMIT, RETRY_LIMIT_CHOICES, type RetryLimitChoice } from '@/downloads/v2/network-options';
import { useNetworkOptionsStore } from '@/downloads/v2/network-options-store';
import { v2FailureMessage } from '@/downloads/v2/projection';
import { useTranslation } from '@/localization';
import { downloadDetailsPath, navigation, routePaths } from '@/navigation';
import { ChoiceSheet } from '@/screens/settings/browser-settings/ChoiceSheet';
import { updateAutoResumePreference } from '@/services/auth/settings.service';
import { useDownloadsStore } from '@/store/downloads';
import { selectAutoResume, useSettingsStore } from '@/store/settings';

import { fraction } from '../shared/format';
import { toast } from '../shared/toast';
import { useNotYet } from '../shared/use-not-yet';
import { useSettingsHeaderAction } from '../shared/use-settings-header-action';

import { failedSignature, retryLimitNumber, splitSignature } from './failed-model';

/** One of the other failed downloads, below the newest one's card: title and reason; tap opens its details. */
const FailedRow = memo(function FailedRow({ id }: { id: string }) {
  const { t } = useTranslation();
  const item = useDownloadsStore((s) => s.itemsById[id] ?? null);
  if (!item) {
    return null;
  }
  return (
    <DsRow
      icon="alert-triangle"
      title={item.fileName?.trim() || item.title?.trim() || t('player.untitled')}
      subtitle={item.errorMessage ?? v2FailureMessage(null)}
      onPress={() => navigation.push(downloadDetailsPath(id))}
      testID={`failed-row-${id}`}
    />
  );
});

/**
 * Design 46 "Failed": the newest failed download with Retry and Repair (H20 #412), the retry rules (retry limit
 * #332, auto-resume), the error log (H13 download history) and the other failed downloads.
 */
export const FailedScreen = memo(function FailedScreen() {
  const { t, rtl } = useTranslation();
  const notYet = useNotYet();
  const settingsAction = useSettingsHeaderAction();
  const signature = useDownloadsStore(failedSignature);
  const ids = useMemo(() => splitSignature(signature), [signature]);
  const latestId = ids[0] ?? null;
  const latest = useDownloadsStore((s) => (latestId ? (s.itemsById[latestId] ?? null) : null));
  const retryLimit = useNetworkOptionsStore((s) => s.retryLimit) ?? 'automatic';
  const autoResume = useSettingsStore(selectAutoResume);
  const [limitOpen, setLimitOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const retry = useCallback(async () => {
    if (!latestId) {
      return;
    }
    setRetrying(true);
    try {
      await useDownloadsStore.getState().retry(latestId);
    } finally {
      setRetrying(false);
    }
  }, [latestId]);

  const repair = useCallback(async () => {
    const port = fileIntegrity();
    if (!latestId || !port?.repairDownload || !port.getRepairInfo) {
      notYet();
      return;
    }
    let info = null;
    try {
      info = port.getRepairInfo(latestId) ?? null;
    } catch {
      info = null;
    }
    if (!canOfferRepair('FAILED', info)) {
      toast(t('fileIntegrity.repairNothing'));
      return;
    }
    setRepairing(true);
    let message: string;
    try {
      message = t(repairMessageKey(await port.repairDownload(latestId)));
    } catch {
      message = t('fileIntegrity.repairFailed');
    }
    setRepairing(false);
    toast(message);
  }, [latestId, notYet, t]);

  const limitOptions = useMemo(
    () =>
      RETRY_LIMIT_CHOICES.map((value) => ({
        value,
        label: value === 'automatic' ? t('networkOptions.retryLimitAutomatic', { count: String(AUTOMATIC_RETRY_LIMIT) }) : value,
      })),
    [t],
  );

  const chooseLimit = useCallback((value: RetryLimitChoice) => {
    useNetworkOptionsStore.getState().setRetryLimit(value);
  }, []);

  const setAutoResume = useCallback((value: boolean) => {
    void updateAutoResumePreference(value);
  }, []);

  const limit = retryLimitNumber(retryLimit);
  const others = ids.slice(1);

  return (
    <DsScreen testID="failed-screen">
      <DsHeader
        title={t('downloads.filterFailed')}
        subtitle={ids.length === 1 ? t('lightFailed.errorsOne') : t('lightFailed.errorsOther', { count: ids.length })}
        action={settingsAction}
      />

      {latest && latestId ? (
        <>
          <DsCard testID="failed-latest">
            <DsText variant="cardTitle" numberOfLines={1}>
              {latest.fileName?.trim() || latest.title?.trim() || t('player.untitled')}
            </DsText>
            <DsText variant="body" color="primary" numberOfLines={2} style={{ marginTop: 4 }} testID="failed-latest-reason">
              {latest.errorMessage ?? v2FailureMessage(null)}
            </DsText>
            <DsProgressBar progress={fraction(latest.progress)} accessibilityLabel={t('lightFailed.progressA11y')} style={{ marginTop: 12 }} />
            <View style={{ flexDirection: rtl.rowDirection, justifyContent: 'space-between', marginTop: 8 }}>
              <DsText variant="rowValue">{`${Math.round(fraction(latest.progress) * 100)}%`}</DsText>
              <DsText variant="rowValue">{t('lightFailed.retryOf', { attempts: latest.retryCount ?? 0, limit })}</DsText>
            </View>
          </DsCard>
          <DsButtonRow>
            <DsButton label={t('lightFailed.retry')} flex onPress={() => void retry()} loading={retrying} testID="failed-retry" />
            <DsButton label={t('lightFailed.repair')} variant="secondary" flex onPress={() => void repair()} loading={repairing} testID="failed-repair" />
          </DsButtonRow>
        </>
      ) : (
        <DsCard testID="failed-empty">
          <DsText variant="body">{t('lightFailed.noFailed')}</DsText>
        </DsCard>
      )}

      <DsRowGroup testID="failed-rows">
        <DsRow icon="repeat" title={t('networkOptions.retryLimit')} subtitle={String(limit)} onPress={() => setLimitOpen(true)} testID="failed-retry-limit" />
        <DsRow icon="cast" title={t('lightFailed.serverLimitDetection')} toggle={{ value: false, onValueChange: notYet }} testID="failed-server-limit" />
        <DsRow icon="layers" title={t('lightFailed.repairPartialFile')} onPress={() => void repair()} testID="failed-repair-row" />
        <DsRow icon="file-text" title={t('downloadHistory.errorLogTitle')} onPress={() => navigation.push(routePaths.downloadHistory)} testID="failed-error-log" />
        <DsRow icon="repeat" title={t('lightFailed.autoResume')} toggle={{ value: autoResume, onValueChange: setAutoResume }} testID="failed-auto-resume" />
      </DsRowGroup>

      {others.length > 0 ? (
        <DsRowGroup testID="failed-others">
          {others.map((id) => (
            <FailedRow key={id} id={id} />
          ))}
        </DsRowGroup>
      ) : null}

      <ChoiceSheet
        visible={limitOpen}
        title={t('networkOptions.retryLimit')}
        options={limitOptions}
        value={retryLimit}
        onSelect={chooseLimit}
        onClose={() => setLimitOpen(false)}
        testID="failed-retry-limit-sheet"
      />
    </DsScreen>
  );
});
