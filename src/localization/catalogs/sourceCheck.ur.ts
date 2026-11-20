import type { CatalogStrings } from '../types';
import type { sourceCheckEn } from './sourceCheck.en';

export const sourceCheckUr: CatalogStrings<typeof sourceCheckEn> = {
  title: 'ذریعے کی جانچ',
  secure: 'محفوظ',
  check: 'ذریعہ جانچیں',
  notSecure: 'غیر محفوظ',
  hint: 'وجہ دکھاتا ہے',
  reasonHttps: 'لنک HTTPS استعمال کرتا ہے: ویڈیو خفیہ (encrypted) کنکشن سے آتی ہے۔',
  reasonHttp: '{host} سادہ HTTP استعمال کرتا ہے: راستے میں ویڈیو خفیہ نہیں ہوتی اور بدلی جا سکتی ہے۔',
  reasonDowngrade: 'لنک {host} پر HTTPS چھوڑ کر سادہ HTTP پر چلا جاتا ہے۔',
  reasonIpHost: 'لنک سائٹ کے نام کے بجائے ایک نمبر ({host}) پر جاتا ہے۔',
  reasonPunycode: '{host} بین الاقوامی حروف استعمال کرتا ہے۔ یقین کر لیں کہ یہ وہی سائٹ ہے جس کی آپ کو توقع ہے۔',
  reasonMixedScript: '{host} مختلف حروفِ تہجی ملاتا ہے، یہ ہم شکل جعلی سائٹوں کی چال ہے۔',
  reasonShortener: '{host} لنک چھوٹا کرنے والی سروس ہے: یہ چھپاتی ہے کہ لنک دراصل کہاں جاتا ہے۔',
  reasonFileLocker: '{host} ایک مفت فائل شیئرنگ سائٹ ہے جہاں کوئی بھی کچھ بھی اپ لوڈ کر سکتا ہے۔',
  reasonRedirects: 'ویڈیو تک پہنچنے سے پہلے لنک {count} بار ری ڈائریکٹ ہوا۔',
  localOnly: 'لنک کو دیکھ کر آپ کے فون پر ہی جانچا گیا۔ کچھ بھی کہیں نہیں بھیجا گیا۔',
};
