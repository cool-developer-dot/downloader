/**
 * "Contact Support" / "Report an Issue": a pre-filled email to the VidoraX support mailbox. Pure (no React Native),
 * so it is unit-tested in Node; `support-email-open.ts` opens it.
 */

export const SUPPORT_EMAIL_ADDRESS = 'Vidoraxlabs@gmail.com';
export const SUPPORT_EMAIL_SUBJECT = 'VidoraX Support / Issue Report';

export type SupportEmailDeviceInfo = {
  appVersion: string;
  androidVersion: string;
  device: string;
};

/** The body the user completes: what we need to help, nothing else (no URLs, paths or personal data). */
export function buildSupportEmailBody(info: SupportEmailDeviceInfo): string {
  return [
    `App version: ${info.appVersion}`,
    `Android version: ${info.androidVersion}`,
    `Device: ${info.device}`,
    'Issue:',
    '',
  ].join('\n');
}

export function buildSupportMailtoUrl(info: SupportEmailDeviceInfo): string {
  return (
    `mailto:${SUPPORT_EMAIL_ADDRESS}` +
    `?subject=${encodeURIComponent(SUPPORT_EMAIL_SUBJECT)}` +
    `&body=${encodeURIComponent(buildSupportEmailBody(info))}`
  );
}
