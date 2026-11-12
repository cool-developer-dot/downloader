/**
 * Central VidoraX legal product configuration.
 * Keep public URLs aligned with app-identity; do not invent contact emails.
 */

export type LegalContactConfig = {
  /** Null until a production privacy mailbox is configured. */
  privacyEmail: string | null;
  /** Null until a production support mailbox is configured. */
  supportEmail: string | null;
};

export type LegalConfig = {
  productName: 'VidoraX';
  /** ISO date — policy effective date. */
  effectiveDate: string;
  /** ISO date — last content update. */
  updatedDate: string;
  contact: LegalContactConfig;
  /**
   * Public Privacy/Terms URLs for future web pages.
   * Do not present as openable actions until `publicWebPublished` is true.
   */
  publicPrivacyUrl: string;
  publicTermsUrl: string;
  websiteOrigin: string;
  /**
   * Gate for in-app “open on web” actions. Keep false until public pages ship.
   * In-app Privacy/Terms remain fully usable without this.
   */
  publicWebPublished: boolean;
};

const WEBSITE_ORIGIN = 'https://vidorax.app';

export const legalConfig: LegalConfig = {
  productName: 'VidoraX',
  effectiveDate: '2026-08-25',
  updatedDate: '2026-10-10',
  contact: {
    privacyEmail: null,
    supportEmail: 'Vidoraxlabs@gmail.com',
  },
  publicPrivacyUrl: `${WEBSITE_ORIGIN}/privacy`,
  publicTermsUrl: `${WEBSITE_ORIGIN}/terms`,
  websiteOrigin: WEBSITE_ORIGIN,
  publicWebPublished: false,
};

export function isLegalContactConfigured(): boolean {
  const privacy = legalConfig.contact.privacyEmail?.trim() ?? '';
  const support = legalConfig.contact.supportEmail?.trim() ?? '';
  return privacy.length > 0 || support.length > 0;
}

export function getConfiguredLegalContactEmail(): string | null {
  const privacy = legalConfig.contact.privacyEmail?.trim() ?? '';
  if (privacy.length > 0) {
    return privacy;
  }
  const support = legalConfig.contact.supportEmail?.trim() ?? '';
  return support.length > 0 ? support : null;
}

/** True when public web legal pages may be opened from the app. */
export function isPublicLegalWebOpenable(): boolean {
  if (!legalConfig.publicWebPublished) {
    return false;
  }
  const privacy = legalConfig.publicPrivacyUrl.trim();
  const terms = legalConfig.publicTermsUrl.trim();
  return privacy.length > 0 && terms.length > 0;
}
