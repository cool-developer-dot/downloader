import type { TranslationKey } from '@/localization/types';

/**
 * Structured legal document model — reusable by mobile screens and a future
 * public web renderer without duplicating Privacy/Terms copy.
 */
export type LegalDocumentId = 'privacy' | 'terms';

export type LegalSection = {
  /** Stable section id for tests, anchors, and future web deep-links. */
  id: string;
  headingKey: TranslationKey;
  /** Paragraph body keys, rendered in order. */
  bodyKeys?: readonly TranslationKey[];
  /** Bullet / list item keys, rendered after paragraphs. */
  itemKeys?: readonly TranslationKey[];
};

export type LegalDocument = {
  id: LegalDocumentId;
  titleKey: TranslationKey;
  /** ISO date (YYYY-MM-DD) — technical value, not localized. */
  effectiveDate: string;
  /** ISO date (YYYY-MM-DD) — technical value, not localized. */
  updatedDate: string;
  sections: readonly LegalSection[];
};

export function collectLegalDocumentKeys(
  document: LegalDocument,
): TranslationKey[] {
  const keys: TranslationKey[] = [document.titleKey];
  for (const section of document.sections) {
    keys.push(section.headingKey);
    if (section.bodyKeys) {
      keys.push(...section.bodyKeys);
    }
    if (section.itemKeys) {
      keys.push(...section.itemKeys);
    }
  }
  return keys;
}
