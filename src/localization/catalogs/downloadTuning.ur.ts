import type { CatalogStrings } from '../types';
import type { downloadTuningEn } from './downloadTuning.en';

export const downloadTuningUr: CatalogStrings<typeof downloadTuningEn> = {
  section: 'کارکردگی',
  sectionHint: 'ڈاؤن لوڈ میموری، سٹوریج اور سرور کو کیسے استعمال کرتے ہیں۔ عام فونز کے لیے پہلے سے طے ترتیبات ٹھیک ہیں۔',
  lowMemory: 'کم میموری موڈ',
  lowMemoryHint: 'ایک وقت میں ایک ڈاؤن لوڈ، ایک کنکشن پر، چھوٹے بفر کے ساتھ۔ خودکار کم میموری والے فونز پر اسے آن کر دیتا ہے۔',
  lowMemoryAuto: 'خودکار',
  lowMemoryOn: 'آن',
  lowMemoryOff: 'آف',
  buffer: 'بفر کا سائز',
  bufferHint: 'نیٹ ورک سے ایک بار میں کتنا ڈیٹا پڑھا جائے۔ تیز کنکشن پر بڑا سائز زیادہ تیز ہو سکتا ہے۔',
  bufferValue: '{count} KB',
  writeCache: 'ڈسک رائٹ کیش',
  writeCacheHint: 'ڈیٹا لکھنے سے پہلے میموری میں جمع کرتا ہے، تاکہ سٹوریج پر کم بار لکھا جائے۔',
  writeCacheOff: 'آف',
  writeCacheValue: '{count} MB',
  cooldown: 'فائلوں کے درمیان وقفہ',
  cooldownHint: 'ایک ہی سائٹ سے اگلے ڈاؤن لوڈ سے پہلے انتظار کرتا ہے، ان سرورز کے لیے جو لگاتار ڈاؤن لوڈ روک دیتے ہیں۔',
  cooldownOff: 'آف',
  cooldownValue: '{count} سیکنڈ',
  exitWhenDone: 'مکمل ہونے پر بند کریں',
  exitWhenDoneHint: 'جب ایپ پس منظر میں ہو اور سب ڈاؤن لوڈ مکمل ہو جائیں تو VidoraX بند کر دیں۔',
  lowMemoryActive: 'کم میموری موڈ آن ہے، اس لیے یہ کم میموری والی قدریں استعمال کر رہے ہیں۔',
};
