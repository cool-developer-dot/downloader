import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { PAGE_ALERT_TASK } from '@/browser/page-alerts/page-alerts-core';
import { runPageChecks } from '@/browser/page-alerts/page-alerts.service';
import { translate } from '@/localization';
import { useSettingsStore } from '@/store/settings';

/**
 * B23 #289 — the page-change check, defined at the top level of the bundle (src/entry.js) so the background worker
 * finds it when it starts the app's JavaScript without the UI. Posts "Page changed: <title>" for each change, on its
 * own quiet channel, only when the app's notifications are on (and Android allows them). No sound.
 */

const CHANNEL_ID = 'vidorax_page_alerts';

async function postChange(title: string, url: string): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: translate('browserAnnotate.channelName'),
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: false,
      showBadge: false,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate('browserAnnotate.changedTitle', { title: title.slice(0, 120) }),
      body: translate('browserAnnotate.changedBody', { url: url.slice(0, 200) }),
      sound: false,
      data: { pageAlertUrl: url },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  });
}

if (!TaskManager.isTaskDefined(PAGE_ALERT_TASK)) {
  TaskManager.defineTask(PAGE_ALERT_TASK, async () => {
    try {
      const run = await runPageChecks();
      if (run.changed.length && useSettingsStore.getState().notifications !== false) {
        const permission = await Notifications.getPermissionsAsync().catch(() => null);
        if (permission?.granted) for (const change of run.changed) await postChange(change.title, change.url).catch(() => undefined);
      }
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
