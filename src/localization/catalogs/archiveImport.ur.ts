import type { CatalogStrings } from '../types';
import type { archiveImportEn } from './archiveImport.en';

export const archiveImportUr: CatalogStrings<typeof archiveImportEn> = {
  title: 'آرکائیو کھولیں',
  untitled: 'آرکائیو',
  reading: 'آرکائیو پڑھا جا رہا ہے…',
  extracting: 'ویڈیوز آپ کی لائبریری میں شامل کی جا رہی ہیں…',
  summary: '{entries} فائلیں: {videos} ویڈیوز اور {subtitles} سب ٹائٹلز (کل {size})۔',
  extractOne: '1 ویڈیو لائبریری میں شامل کریں',
  extractOther: '{count} ویڈیوز لائبریری میں شامل کریں',
  noVideos: 'اس آرکائیو میں کوئی ویڈیو نہیں۔',
  done: '{imported} ویڈیوز آپ کی لائبریری میں شامل ہو گئیں۔ {duplicates} پہلے سے موجود تھیں۔ {subtitles} سب ٹائٹلز محفوظ ہوئے۔',
  someFailed: '{count} فائلیں شامل نہیں ہو سکیں۔',
  openLibrary: 'لائبریری کھولیں',
  refusedNotZip: 'یہ فائل ZIP آرکائیو نہیں ہے۔',
  refusedRarSevenZip: 'RAR اور 7z آرکائیوز کی سہولت نہیں ہے۔ صرف ZIP فائلیں کھولی جا سکتی ہیں۔',
  refusedEncrypted: 'یہ آرکائیو پاس ورڈ سے محفوظ ہے۔ VidoraX خفیہ (encrypted) آرکائیوز نہیں کھول سکتا۔',
  refusedPathEscape: 'یہ آرکائیو اپنے فولڈر سے باہر فائلیں رکھنے کی کوشش کرتا ہے۔ یہ نقصان دہ ہو سکتا ہے، اس لیے VidoraX اسے نہیں کھولے گا۔',
  refusedTooManyEntries: 'اس آرکائیو میں 1000 سے زیادہ فائلیں ہیں۔ VidoraX اسے نہیں کھولے گا۔',
  refusedTooLarge: 'یہ آرکائیو کھلنے پر 4 GB سے زیادہ ہو جائے گا۔ VidoraX اسے نہیں کھولے گا۔',
  refusedCompressionRatio:
    'یہ آرکائیو کھلنے پر اپنے سائز سے بہت زیادہ بڑا ہو جاتا ہے ("zip bomb")۔ یہ نقصان دہ ہو سکتا ہے، اس لیے VidoraX اسے نہیں کھولے گا۔',
  refusedDamaged: 'یہ آرکائیو خراب ہے اور پڑھا نہیں جا سکتا۔',
  refusedAndroidApp: 'یہ "آرکائیو" دراصل ایک اینڈرائیڈ ایپ (APK) ہے۔ یہ نقصان دہ ہو سکتی ہے، اس لیے VidoraX اسے نہیں کھولے گا۔',
  failed: 'آرکائیو پڑھا نہیں جا سکا۔',
  failedNoSpace: 'اس آرکائیو کے لیے اسٹوریج کافی نہیں۔',
  failedGone: 'آرکائیو اب دستیاب نہیں۔ اسے دوسری ایپ سے دوبارہ کھولیں۔',
};
