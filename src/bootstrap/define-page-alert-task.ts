import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { PAGE_ALERT_TASK } from '@/browser/page-alerts/page-alerts-core';

/**
 * B23 #289 — the page-change check, defined at the top level of the bundle (src/entry.js) so the background worker
 * finds it when it starts the app's JavaScript without the UI. Only the task libraries and the pure core load here, at
 * startup; the checks, notifications, settings and strings load inside the task when it runs. Posts "Page changed:
 * <title>" for each change on its own quiet channel, only when the app's notifications are on (and Android allows
 * them). No sound.
 */

const CHANNEL_ID = 'vidorax_page_alerts';

async function runTask(): Promise<void> {
  const [{ runPageChecks }, Notifications, { translate }, { useSettingsStore }] = await Promise.all([
    import('@/browser/page-alerts/page-alerts.service'),
    import('expo-notifications'),
    import('@/localization'),
    import('@/store/settings'),
  ]);
  const run = await runPageChecks();
  if (!run.changed.length || useSettingsStore.getState().notifications === false) return;
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: translate('browserAnnotate.channelName'),
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: false,
      showBadge: false,
    });
  }
  for (const change of run.changed) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: translate('browserAnnotate.changedTitle', { title: change.title.slice(0, 120) }),
        body: translate('browserAnnotate.changedBody', { url: change.url.slice(0, 200) }),
        sound: false,
        data: { pageAlertUrl: change.url },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    }).catch(() => undefined);
  }
}

if (!TaskManager.isTaskDefined(PAGE_ALERT_TASK)) {
  TaskManager.defineTask(PAGE_ALERT_TASK, async () => {
    try {
      await runTask();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
