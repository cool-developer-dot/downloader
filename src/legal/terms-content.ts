import { legalConfig } from './config';
import type { LegalDocument } from './types';

/**
 * Terms & Conditions structure. Copy lives in localization (en/ur);
 * this module only defines reusable section order and keys.
 */
export const termsDocument: LegalDocument = {
  id: 'terms',
  titleKey: 'terms.title',
  effectiveDate: legalConfig.effectiveDate,
  updatedDate: legalConfig.updatedDate,
  sections: [
    {
      id: 'acceptance',
      headingKey: 'terms.sections.acceptance.heading',
      bodyKeys: [
        'terms.sections.acceptance.p1',
        'terms.sections.acceptance.p2',
      ],
    },
    {
      id: 'permitted-use',
      headingKey: 'terms.sections.permittedUse.heading',
      bodyKeys: [
        'terms.sections.permittedUse.p1',
        'terms.sections.permittedUse.p2',
      ],
    },
    {
      id: 'content-ownership',
      headingKey: 'terms.sections.contentOwnership.heading',
      bodyKeys: [
        'terms.sections.contentOwnership.p1',
        'terms.sections.contentOwnership.p2',
      ],
    },
    {
      id: 'user-authorization',
      headingKey: 'terms.sections.userAuthorization.heading',
      bodyKeys: [
        'terms.sections.userAuthorization.p1',
        'terms.sections.userAuthorization.p2',
      ],
    },
    {
      id: 'supported-sources',
      headingKey: 'terms.sections.supportedSources.heading',
      bodyKeys: [
        'terms.sections.supportedSources.p1',
        'terms.sections.supportedSources.p2',
      ],
    },
    {
      id: 'drm-limitations',
      headingKey: 'terms.sections.drmLimitations.heading',
      bodyKeys: [
        'terms.sections.drmLimitations.p1',
        'terms.sections.drmLimitations.p2',
        'terms.sections.drmLimitations.p3',
      ],
    },
    {
      id: 'user-responsibilities',
      headingKey: 'terms.sections.userResponsibilities.heading',
      bodyKeys: ['terms.sections.userResponsibilities.intro'],
      itemKeys: [
        'terms.sections.userResponsibilities.itemCredentials',
        'terms.sections.userResponsibilities.itemLawful',
        'terms.sections.userResponsibilities.itemDevice',
        'terms.sections.userResponsibilities.itemAccuracy',
      ],
    },
    {
      id: 'prohibited-misuse',
      headingKey: 'terms.sections.prohibitedMisuse.heading',
      bodyKeys: ['terms.sections.prohibitedMisuse.intro'],
      itemKeys: [
        'terms.sections.prohibitedMisuse.itemCircumvent',
        'terms.sections.prohibitedMisuse.itemAbuse',
        'terms.sections.prohibitedMisuse.itemInterfere',
        'terms.sections.prohibitedMisuse.itemUnlawful',
      ],
    },
    {
      id: 'service-availability',
      headingKey: 'terms.sections.serviceAvailability.heading',
      bodyKeys: [
        'terms.sections.serviceAvailability.p1',
        'terms.sections.serviceAvailability.p2',
      ],
    },
    {
      id: 'accounts-security',
      headingKey: 'terms.sections.accountsSecurity.heading',
      bodyKeys: [
        'terms.sections.accountsSecurity.p1',
        'terms.sections.accountsSecurity.p2',
      ],
    },
    {
      id: 'local-files',
      headingKey: 'terms.sections.localFiles.heading',
      bodyKeys: [
        'terms.sections.localFiles.p1',
        'terms.sections.localFiles.p2',
      ],
    },
    {
      id: 'device-limitations',
      headingKey: 'terms.sections.deviceLimitations.heading',
      bodyKeys: [
        'terms.sections.deviceLimitations.p1',
        'terms.sections.deviceLimitations.p2',
      ],
    },
    {
      id: 'limitation-of-service',
      headingKey: 'terms.sections.limitationOfService.heading',
      bodyKeys: [
        'terms.sections.limitationOfService.p1',
        'terms.sections.limitationOfService.p2',
      ],
    },
    {
      id: 'suspension',
      headingKey: 'terms.sections.suspension.heading',
      bodyKeys: [
        'terms.sections.suspension.p1',
        'terms.sections.suspension.p2',
      ],
    },
    {
      id: 'updates',
      headingKey: 'terms.sections.updates.heading',
      bodyKeys: ['terms.sections.updates.p1'],
    },
    {
      id: 'contact',
      headingKey: 'terms.sections.contact.heading',
      bodyKeys: [
        'terms.sections.contact.p1',
        'terms.sections.contact.p2',
      ],
    },
  ],
};
