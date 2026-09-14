import { legalConfig } from './config';
import type { LegalDocument } from './types';

/**
 * Privacy Policy structure. Copy lives in localization (en/ur);
 * this module only defines reusable section order and keys.
 */
export const privacyDocument: LegalDocument = {
  id: 'privacy',
  titleKey: 'privacy.title',
  effectiveDate: legalConfig.effectiveDate,
  updatedDate: legalConfig.updatedDate,
  sections: [
    {
      id: 'introduction',
      headingKey: 'privacy.sections.introduction.heading',
      bodyKeys: [
        'privacy.sections.introduction.p1',
        'privacy.sections.introduction.p2',
      ],
    },
    {
      id: 'information-processed',
      headingKey: 'privacy.sections.informationProcessed.heading',
      bodyKeys: ['privacy.sections.informationProcessed.intro'],
      itemKeys: [
        'privacy.sections.informationProcessed.itemDownloadMeta',
        'privacy.sections.informationProcessed.itemLocalMedia',
        'privacy.sections.informationProcessed.itemBrowser',
        'privacy.sections.informationProcessed.itemPlayback',
        'privacy.sections.informationProcessed.itemDiagnostics',
        'privacy.sections.informationProcessed.itemSettings',
      ],
    },
    {
      id: 'how-used',
      headingKey: 'privacy.sections.howUsed.heading',
      bodyKeys: ['privacy.sections.howUsed.intro'],
      itemKeys: [
        'privacy.sections.howUsed.itemProvide',
        'privacy.sections.howUsed.itemSync',
        'privacy.sections.howUsed.itemSecurity',
        'privacy.sections.howUsed.itemImprove',
      ],
    },
    {
      id: 'backend-communication',
      headingKey: 'privacy.sections.backend.heading',
      bodyKeys: [
        'privacy.sections.backend.p1',
        'privacy.sections.backend.p2',
        'privacy.sections.backend.p3',
      ],
    },
    {
      id: 'third-parties',
      headingKey: 'privacy.sections.thirdParties.heading',
      bodyKeys: [
        'privacy.sections.thirdParties.p1',
        'privacy.sections.thirdParties.p2',
        'privacy.sections.thirdParties.p3',
      ],
    },
    {
      id: 'local-storage',
      headingKey: 'privacy.sections.localStorage.heading',
      bodyKeys: [
        'privacy.sections.localStorage.p1',
        'privacy.sections.localStorage.p2',
      ],
    },
    {
      id: 'retention',
      headingKey: 'privacy.sections.retention.heading',
      bodyKeys: [
        'privacy.sections.retention.p1',
        'privacy.sections.retention.p2',
      ],
    },
    {
      id: 'security',
      headingKey: 'privacy.sections.security.heading',
      bodyKeys: [
        'privacy.sections.security.p1',
        'privacy.sections.security.p2',
      ],
    },
    {
      id: 'user-controls',
      headingKey: 'privacy.sections.userControls.heading',
      bodyKeys: ['privacy.sections.userControls.intro'],
      itemKeys: [
        'privacy.sections.userControls.itemHistory',
        'privacy.sections.userControls.itemBookmarks',
        'privacy.sections.userControls.itemDownloads',
        'privacy.sections.userControls.itemLanguage',
      ],
    },
    {
      id: 'account-deletion',
      headingKey: 'privacy.sections.accountDeletion.heading',
      bodyKeys: [
        'privacy.sections.accountDeletion.p1',
        'privacy.sections.accountDeletion.p2',
      ],
    },
    {
      id: 'children',
      headingKey: 'privacy.sections.children.heading',
      bodyKeys: [
        'privacy.sections.children.p1',
        'privacy.sections.children.p2',
      ],
    },
    {
      id: 'updates',
      headingKey: 'privacy.sections.updates.heading',
      bodyKeys: ['privacy.sections.updates.p1'],
    },
    {
      id: 'contact',
      headingKey: 'privacy.sections.contact.heading',
      bodyKeys: [
        'privacy.sections.contact.p1',
        'privacy.sections.contact.p2',
      ],
    },
  ],
};
