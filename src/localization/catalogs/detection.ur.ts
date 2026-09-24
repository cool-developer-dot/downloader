import type { CatalogStrings } from '../types';
import type { detectionEn } from './detection.en';

export const detectionUr: CatalogStrings<typeof detectionEn> = {
  fab: {
    labelOne: 'ڈاؤن لوڈ: اس صفحے پر 1 ویڈیو ملی',
    labelOther: 'ڈاؤن لوڈ: اس صفحے پر {count} ویڈیوز ملیں',
  },
  sheet: {
    title: 'اس صفحے کی ویڈیوز',
    countOne: '1 ویڈیو',
    countOther: '{count} ویڈیوز',
    close: 'بند کریں',
    emptyTitle: 'ابھی کوئی ویڈیو نہیں ملی',
    emptyDescription: 'جو ویڈیو محفوظ کرنی ہے اسے چلائیں، وہ یہاں نظر آئے گی۔',
    youtubeTitle: 'یوٹیوب سپورٹ نہیں ہے',
    youtubeDescription: 'یوٹیوب کی ویڈیوز ڈاؤن لوڈ نہیں کی جا سکتیں۔',
    drmNotice: 'یہ صفحہ کاپی سے تحفظ استعمال کرتا ہے۔ تحفظ یافتہ ویڈیوز محفوظ نہیں کی جا سکتیں۔',
    downloadBest: 'بہترین ڈاؤن لوڈ کریں',
    downloadBestLabel: 'بہترین کوالٹی ڈاؤن لوڈ کریں: {title}',
    qualities: 'کوالٹیز',
    qualitiesLabel: '{title} کی کوالٹیز',
    download: 'ڈاؤن لوڈ',
    downloadQualityLabel: '{quality} ڈاؤن لوڈ کریں، {detail}',
    resolving: 'کوالٹیز تلاش کی جا رہی ہیں…',
    added: 'ڈاؤن لوڈز میں شامل کر دیا گیا',
    alreadyAdded: 'یہ پہلے ہی آپ کے ڈاؤن لوڈز میں ہے',
    addedShort: 'شامل ہو گیا',
    viewDownloads: 'دیکھیں',
    retry: 'دوبارہ کوشش کریں',
    untitled: 'بے نام ویڈیو',
  },
  option: {
    original: 'اصل',
    noAudio: 'آواز نہیں',
    watermark: 'واٹر مارک',
  },
  reason: {
    DRM_PROTECTED: 'DRM سے محفوظ',
    LIVE_UNSUPPORTED: 'لائیو اسٹریم محفوظ نہیں کی جا سکتی',
    UNSUPPORTED_FORMAT: 'یہ فارمیٹ سپورٹ نہیں ہے',
    NOT_MEDIA: 'یہ ویڈیو فائل نہیں ہے',
    SOURCE_UNAVAILABLE: 'اس ویڈیو تک رسائی نہیں ہو سکی',
    POLICY_BLOCKED: 'یوٹیوب سپورٹ نہیں ہے',
  },
  error: {
    policyBlocked: 'یوٹیوب کی ویڈیوز ڈاؤن لوڈ نہیں کی جا سکتیں۔',
    runnerStart: 'ڈاؤن لوڈ شروع نہیں ہو سکا۔ VidoraX کھلا رکھیں اور دوبارہ کوشش کریں۔',
    invalidRequest: 'یہ ویڈیو ڈاؤن لوڈ نہیں کی جا سکتی۔',
    storage: 'فائل محفوظ نہیں ہو سکی۔ اپنی خالی جگہ چیک کریں اور دوبارہ کوشش کریں۔',
    unavailable: 'ایپ کے اس ورژن میں ڈاؤن لوڈ دستیاب نہیں ہیں۔',
    generic: 'ڈاؤن لوڈ شامل نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
  },
};
