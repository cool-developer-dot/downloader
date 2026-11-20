import type { CatalogStrings } from '../types';
import type { fileSafetyEn } from './fileSafety.en';

export const fileSafetyUr: CatalogStrings<typeof fileSafetyEn> = {
  disguisedDownloadTitle: 'یہ فائل بھیس بدلے ہوئے ہے',
  disguisedDownloadMessage:
    '"{fileName}" کا نام ویڈیو یا دستاویز جیسا ہے، لیکن سائٹ اسے ایپ یا پروگرام کے طور پر بھیج رہی ہے۔ یہ نقصان دہ ہو سکتی ہے۔ صرف تب ڈاؤن لوڈ کریں جب آپ کو سائٹ پر بھروسا ہو۔',
  doubleExtensionMessage:
    '"{fileName}" دوسری ایکسٹینشن کے پیچھے ایک پروگرام چھپا رہی ہے۔ یہ نقصان دہ ہو سکتی ہے۔ صرف تب جاری رکھیں جب آپ کو اس کے ذریعے پر بھروسا ہو۔',
  disguisedTitle: 'یہ فائل وہ نہیں جو اس کا نام بتاتا ہے',
  disguisedMessage: '"{fileName}" کا نام ویڈیو جیسا ہے، لیکن یہ دراصل {kind} ہے۔ یہ نقصان دہ ہو سکتی ہے۔',
  disguisedMessageUnknown: '"{fileName}" کا نام ویڈیو جیسا ہے، لیکن یہ کچھ اور ہے۔ یہ نقصان دہ ہو سکتی ہے۔',
  programTitle: 'یہ فائل ایک پروگرام ہے',
  programMessage: '"{fileName}" ایپ انسٹال کر سکتی ہے یا پروگرام چلا سکتی ہے۔ صرف تب جاری رکھیں جب آپ کو اس کے ذریعے پر بھروسا ہو۔',
  disguisedSourceMessage: '{host} کی "ویڈیو" دراصل {kind} ہے۔ VidoraX نے اسے ڈاؤن لوڈ نہیں کیا۔',
  kindApk: 'ایک اینڈرائیڈ ایپ (APK)',
  kindExe: 'ایک ونڈوز پروگرام',
  kindScript: 'ایک اسکرپٹ',
  kindProgram: 'ایک پروگرام',
  kindArchive: 'ایک آرکائیو',
  openAnyway: 'پھر بھی کھولیں',
  shareAnyway: 'پھر بھی شیئر کریں',
  extractAnyway: 'پھر بھی نکالیں',
  saveAnyway: 'پھر بھی محفوظ کریں',
  saveRefused: 'محفوظ نہیں کی گئی: یہ فائل ویڈیو نہیں اور نقصان دہ ہو سکتی ہے۔',
  archiveProgramsTitle: 'اس آرکائیو میں پروگرام ہیں',
  archiveProgramsMessage:
    'اس آرکائیو میں پروگرام بھی ہیں ({names})۔ VidoraX انہیں کبھی نہیں نکالتا — صرف ویڈیوز اور سب ٹائٹلز۔',
  archiveDisguisedMessage: 'یہ شامل نہیں کی گئیں کیونکہ یہ ویڈیوز نہیں: {names}۔ ان کے نام ویڈیو جیسے ہیں لیکن یہ پروگرام یا آرکائیو ہیں۔',
};
