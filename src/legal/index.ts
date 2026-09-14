export {
  legalConfig,
  isLegalContactConfigured,
  getConfiguredLegalContactEmail,
  isPublicLegalWebOpenable,
  type LegalConfig,
  type LegalContactConfig,
} from './config';
export { privacyDocument } from './privacy-content';
export { termsDocument } from './terms-content';
export {
  collectLegalDocumentKeys,
  type LegalDocument,
  type LegalDocumentId,
  type LegalSection,
} from './types';

import { privacyDocument } from './privacy-content';
import { termsDocument } from './terms-content';
import type { LegalDocument, LegalDocumentId } from './types';

/** All structured legal documents available for mobile and future web. */
export const legalDocuments = {
  privacy: privacyDocument,
  terms: termsDocument,
} as const satisfies Record<LegalDocumentId, LegalDocument>;

export function getLegalDocument(id: LegalDocumentId): LegalDocument {
  return legalDocuments[id];
}
