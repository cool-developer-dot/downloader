import type { CatalogStrings } from '../types';
import type { browserFindEn } from './browserFind.en';

export const browserFindUr: CatalogStrings<typeof browserFindEn> = {
  menuItem: 'صفحے میں تلاش کریں',
  menuA11y: 'اس صفحے پر متن تلاش کریں',
  placeholder: 'صفحے میں تلاش کریں',
  fieldA11y: 'اس صفحے پر تلاش کرنے کا متن',
  count: '{total} میں سے {current}',
  countA11y: '{total} میں سے مطابقت {current}',
  noMatches: 'کوئی مطابقت نہیں',
  searching: 'تلاش ہو رہی ہے…',
  next: 'اگلی مطابقت',
  previous: 'پچھلی مطابقت',
  matchCase: 'حروف کی بڑائی چھوٹائی ملائیں',
  matchCaseHint: 'آن ہونے پر "Apple" سے "apple" نہیں ملتا',
  wholeWord: 'پورا لفظ',
  wholeWordHint: 'آن ہونے پر "cat" سے "category" نہیں ملتا',
  close: 'صفحے میں تلاش بند کریں',
  javascriptOff: 'صفحے میں تلاش کے لیے جاوا اسکرپٹ چاہیے، جو اس سائٹ کے لیے بند ہے',
};
