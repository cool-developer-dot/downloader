import type { CatalogStrings } from '../types';
import type { privacyBackupEn } from './privacyBackup.en';

/** P11 Privacy & backup — Urdu (mirrors `privacyBackup.en.ts`). */
export const privacyBackupUr: CatalogStrings<typeof privacyBackupEn> = {
  blockCapture: 'پرائیویٹ میں اسکرین شاٹ بند کریں',
  blockCaptureHint:
    'جب پرائیویٹ یا اس کی کوئی ویڈیو کھلی ہو تو اسکرین شاٹ یا اسکرین ریکارڈنگ نہیں ہو گی۔ دوسری اسکرینوں اور ویڈیوز پر اس کا کوئی اثر نہیں۔',
  moveOut: 'پرائیویٹ سے باہر نکالیں',
  moveOutTitle: 'پرائیویٹ سے باہر نکالیں؟',
  moveOutMessage:
    '«{title}» آپ کی گیلری (Movies/VidoraX) میں ایک عام، غیر انکرپٹڈ ویڈیو کے طور پر محفوظ ہو گی جسے دوسری ایپس دیکھ سکتی ہیں، پھر پرائیویٹ سے ہٹا دی جائے گی۔ VidoraX اسے اس فون کی ویڈیوز کے ساتھ دکھاتا ہے۔ اس کے چلنے کی گنتی اور بُک مارکس واپس نہیں آتے۔',
  moveOutConfirm: 'باہر نکالیں',
  movingOut: 'باہر نکالی جا رہی ہے… {percent}',
  movingOutPlain: 'باہر نکالی جا رہی ہے…',
  movedOut: 'آپ کی گیلری میں منتقل ہو گئی',
  moveOutFailed: 'یہ ویڈیو باہر نہیں نکالی جا سکی۔ یہ ابھی بھی پرائیویٹ میں ہے۔',
  moveOutKept: 'یہ آپ کی گیلری میں محفوظ ہو گئی، لیکن پرائیویٹ سے ہٹائی نہیں جا سکی۔ آپ اسے یہاں سے ڈیلیٹ کر سکتے ہیں۔',
  backupAll: 'سارے ڈیٹا کا بیک اپ لیں',
  backupAllHint:
    'سیٹنگز، پلیئر کے انتخاب، پلے لسٹس، ویڈیو بُک مارکس اور چلنے کی گنتی ایک فائل میں۔ کوئی ویڈیو نہیں، پرائیویٹ یا ایپ لاک کا کچھ نہیں۔',
  restoreAll: 'بیک اپ سے بحال کریں',
  restoreAllHint: 'پہلے دکھاتا ہے کہ فائل میں کیا ہے۔ پھر اسے ملائیں یا اس سے بدلیں۔',
  backupShareTitle: 'VidoraX بیک اپ',
  backupSaved: 'بیک اپ محفوظ ہو گیا',
  backupShared: 'بیک اپ شیئر ہو گیا',
  backupFailed: 'بیک اپ نہیں بن سکا۔',
  restoreNewer: 'یہ بیک اپ VidoraX کے نئے ورژن نے بنایا ہے۔ اسے بحال کرنے کے لیے VidoraX اپ ڈیٹ کریں۔',
  restoreBrowserBackup: 'یہ براؤزر کا بیک اپ ہے۔ اسے براؤزر کی سیٹنگز میں پروفائلز کے نیچے بحال کریں۔',
  restoreTooLarge: 'یہ فائل VidoraX کا بیک اپ ہونے کے لیے بہت بڑی ہے۔',
  restoreNotBackup: 'یہ فائل VidoraX کا بیک اپ نہیں ہے۔',
  restoreFailed: 'بیک اپ بحال نہیں ہو سکا۔',
  restored: 'بیک اپ بحال ہو گیا',
  previewTitle: 'یہ بیک اپ بحال کریں؟',
  previewMade: '{date} کو بنایا گیا',
  previewSettingsOnly: 'سیٹنگز کا پرانا بیک اپ: اس میں صرف سیٹنگز ہیں۔',
  previewEmpty: 'اس فائل میں بحال کرنے کے لیے کچھ نہیں ہے۔',
  previewNever: 'بیک اپ میں کبھی نہیں: ویڈیوز، پرائیویٹ، ایپ لاک (PIN، ریکوری کوڈ، فنگر پرنٹ)۔',
  previewSettings: 'سیٹنگز: {count}',
  previewPreferences: 'پلیئر اور لائبریری کے انتخاب: {count}',
  previewLoops: 'محفوظ A-B لوپس: {count}',
  previewHiddenFolders: 'چھپے ہوئے فولڈرز: {count}',
  previewPlaylists: 'پلے لسٹس: {count} ({videos} ویڈیوز)',
  previewBookmarks: 'ویڈیو بُک مارکس: {count}',
  previewPlayCounts: 'چلنے کی گنتی: {count} ویڈیوز',
  merge: 'ملائیں',
  mergeHint: '«ملائیں» فائل میں موجود چیزیں شامل کرتا ہے۔ اس فون سے کچھ ڈیلیٹ نہیں ہوتا۔',
  replace: 'بدلیں',
  replaceHint:
    '«بدلیں» اس فون کو فائل کی ہر چیز کے مطابق کر دیتا ہے: باقی پلے لسٹس، بُک مارکس اور چلنے کی گنتی ڈیلیٹ ہو جاتی ہیں، اور باقی سیٹنگز ڈیفالٹ پر واپس چلی جاتی ہیں۔',
  confirmMergeTitle: 'یہ بیک اپ ملائیں؟',
  confirmMergeMessage: 'فائل میں جو ہے وہ VidoraX میں شامل ہو جاتا ہے، اور اس کی سیٹنگز لاگو ہو جاتی ہیں۔ کچھ ڈیلیٹ نہیں ہوتا۔',
  confirmReplaceTitle: 'اس بیک اپ سے بدلیں؟',
  confirmReplaceMessage:
    'فائل میں جو کچھ ہے، اس کے لیے اس فون کا ڈیٹا بدل دیا جاتا ہے: جو پلے لسٹس، ویڈیو بُک مارکس اور چلنے کی گنتی فائل میں نہیں وہ ڈیلیٹ ہو جاتی ہیں، اور جو سیٹنگز فائل میں نہیں وہ ڈیفالٹ پر واپس چلی جاتی ہیں۔ یہ واپس نہیں ہو سکتا۔ ایپ لاک اور پرائیویٹ کو نہیں چھیڑا جاتا۔',
};
