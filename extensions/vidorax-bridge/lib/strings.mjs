// VidoraX Bridge — English and Urdu, by the browser's language. (Chrome's _locales has no Urdu, so the extension
// keeps its own table; src/remote/extension-core.test.ts keeps both in step.)

export const STRINGS = {
  en: {
    menuSendLink: 'Send link to VidoraX',
    menuSendVideo: 'Send video to VidoraX',
    menuSendPage: 'Send page to VidoraX',
    pairTitle: 'Pair with your phone',
    pairHint: 'On the phone: VidoraX → Settings → Downloads → Remote control. Type the address and PIN shown there.',
    addressLabel: 'Phone address',
    addressPlaceholder: 'http://192.168.1.20:41234',
    pinLabel: 'PIN',
    pair: 'Pair',
    pairing: 'Pairing…',
    badAddress: 'Type the address shown on the phone, like http://192.168.1.20:41234.',
    badPin: 'Type the 6-digit PIN shown on the phone.',
    permissionDenied: 'The browser needs permission to reach the phone’s address.',
    wrongPin: 'Wrong PIN. {count} tries left before a short wait.',
    locked: 'Too many wrong PINs. Try again in {seconds} seconds.',
    pairingClosed: 'Pairing is closed. Tap “New PIN” on the phone.',
    unreachable: 'Can’t reach the phone. Is Remote control on, and are you on the same Wi-Fi?',
    pairedWith: 'Paired with {address}',
    sendPage: 'Send this page',
    videosTitle: 'Videos on this page',
    noVideos: 'No video links found. You can still send the page.',
    send: 'Send',
    sentChecking: 'Sent. VidoraX is checking it…',
    sentWaiting: 'Sent. It will be checked when VidoraX is open on the phone.',
    sentAdded: 'Added to downloads.',
    sentDuplicate: 'Already downloading or downloaded.',
    sentReview: 'VidoraX couldn’t pick one video. Open the link on the phone to choose.',
    sentRefused: 'VidoraX can’t download from this link.',
    notPaired: 'Pair with your phone first (click the VidoraX Bridge icon).',
    unpair: 'Unpair',
    openWebUi: 'Open Remote control',
    cantReadPage: 'This page can’t be read by extensions.',
  },
  ur: {
    menuSendLink: 'لنک VidoraX کو بھیجیں',
    menuSendVideo: 'ویڈیو VidoraX کو بھیجیں',
    menuSendPage: 'صفحہ VidoraX کو بھیجیں',
    pairTitle: 'اپنے فون سے جوڑیں',
    pairHint: 'فون پر: VidoraX ← Settings ← Downloads ← Remote control۔ وہاں دکھایا گیا پتہ اور PIN لکھیں۔',
    addressLabel: 'فون کا پتہ',
    addressPlaceholder: 'http://192.168.1.20:41234',
    pinLabel: 'PIN',
    pair: 'جوڑیں',
    pairing: 'جوڑا جا رہا ہے…',
    badAddress: 'فون پر دکھایا گیا پتہ لکھیں، جیسے http://192.168.1.20:41234۔',
    badPin: 'فون پر دکھایا گیا 6 ہندسوں کا PIN لکھیں۔',
    permissionDenied: 'فون کے پتے تک پہنچنے کے لیے براؤزر کو اجازت درکار ہے۔',
    wrongPin: 'غلط PIN۔ تھوڑے انتظار سے پہلے {count} کوششیں باقی ہیں۔',
    locked: 'بہت زیادہ غلط PIN۔ {seconds} سیکنڈ بعد دوبارہ کوشش کریں۔',
    pairingClosed: 'جوڑنا بند ہے۔ فون پر “نیا PIN” دبائیں۔',
    unreachable: 'فون تک رسائی نہیں ہو رہی۔ کیا ریموٹ کنٹرول آن ہے اور آپ ایک ہی Wi-Fi پر ہیں؟',
    pairedWith: '{address} سے جڑا ہوا',
    sendPage: 'یہ صفحہ بھیجیں',
    videosTitle: 'اس صفحے کی ویڈیوز',
    noVideos: 'کوئی ویڈیو لنک نہیں ملا۔ آپ پھر بھی صفحہ بھیج سکتے ہیں۔',
    send: 'بھیجیں',
    sentChecking: 'بھیج دیا۔ VidoraX اسے چیک کر رہا ہے…',
    sentWaiting: 'بھیج دیا۔ فون پر VidoraX کھلنے پر یہ چیک ہو گا۔',
    sentAdded: 'ڈاؤن لوڈز میں شامل ہو گیا۔',
    sentDuplicate: 'پہلے سے ڈاؤن لوڈ ہو رہی ہے یا ہو چکی ہے۔',
    sentReview: 'VidoraX کوئی ایک ویڈیو نہیں چن سکا۔ انتخاب کے لیے فون پر لنک کھولیں۔',
    sentRefused: 'VidoraX اس لنک سے ڈاؤن لوڈ نہیں کر سکتا۔',
    notPaired: 'پہلے اپنے فون سے جوڑیں (VidoraX Bridge آئیکن پر کلک کریں)۔',
    unpair: 'الگ کریں',
    openWebUi: 'ریموٹ کنٹرول کھولیں',
    cantReadPage: 'ایکسٹینشنز یہ صفحہ نہیں پڑھ سکتیں۔',
  },
};

export function languageOf(navigatorLanguage) {
  return typeof navigatorLanguage === 'string' && navigatorLanguage.toLowerCase().startsWith('ur') ? 'ur' : 'en';
}

export function translator(language) {
  const table = STRINGS[language] ?? STRINGS.en;
  return (key, values = {}) => {
    const text = table[key] ?? STRINGS.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
  };
}
