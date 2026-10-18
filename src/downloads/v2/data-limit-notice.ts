/**
 * H6 (#422): a crossed data limit is also posted as a system notification (native `showDataLimitNotification`, on the
 * finished-downloads channel), so it is seen while VidoraX is closed too. The in-app alert stays exactly as it was.
 * One notification per period (crossing it again replaces it); tapping it opens Data usage. A build without the
 * native function, or without the notification permission, posts nothing and nothing else changes.
 */

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import type { DataLimitAlert } from './data-usage';

export type DataLimitNoticePort = {
  /** True when posted; false without the notification permission. */
  showDataLimitNotification(period: DataLimitAlert['period'], title: string, text: string): Promise<boolean>;
};

let override: DataLimitNoticePort | null | undefined;

export function getDataLimitNoticePort(): DataLimitNoticePort | null {
  if (override !== undefined) {
    return override;
  }
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<DataLimitNoticePort>;
  return typeof media.showDataLimitNotification === 'function' ? (media as DataLimitNoticePort) : null;
}

/** `undefined` restores the real module. */
export function setDataLimitNoticePortForTests(port: DataLimitNoticePort | null | undefined): void {
  override = port;
}

export type DataLimitNoticeText = { title: string; text: string };

/** Posts one notification per alert; resolves with how many were posted. Never throws: counting goes on regardless. */
export async function postDataLimitNotices(
  port: DataLimitNoticePort | null,
  alerts: readonly DataLimitAlert[],
  textFor: (alert: DataLimitAlert) => DataLimitNoticeText,
): Promise<number> {
  if (!port || alerts.length === 0) {
    return 0;
  }
  let posted = 0;
  for (const alert of alerts) {
    try {
      const { title, text } = textFor(alert);
      if (await port.showDataLimitNotification(alert.period, title, text)) {
        posted += 1;
      }
    } catch {
      // No notification for this one; the in-app alert still shows.
    }
  }
  return posted;
}
