/**
 * P8 #514 Source check: the Secure / Check source / Not secure badge in the quality sheet and why. Checked from the
 * links alone, on the device. `sourceCheck.ur.ts` mirrors these keys.
 */
export const sourceCheckEn = {
  title: 'Source check',
  secure: 'Secure',
  check: 'Check source',
  notSecure: 'Not secure',
  hint: 'Shows why',
  reasonHttps: 'The link uses HTTPS: the video comes over an encrypted connection.',
  reasonHttp: '{host} uses plain HTTP: the video is not encrypted on the way and could be changed.',
  reasonDowngrade: 'The link leaves HTTPS for plain HTTP at {host}.',
  reasonIpHost: 'The link goes to a number ({host}) instead of a site name.',
  reasonPunycode: '{host} uses international letters. Make sure it is the site you expect.',
  reasonMixedScript: '{host} mixes letters from different alphabets, a trick look-alike sites use.',
  reasonShortener: '{host} is a link shortener: it hides where the link really goes.',
  reasonFileLocker: '{host} is a free file-sharing site where anyone can upload anything.',
  reasonRedirects: 'The link redirected {count} times before reaching the video.',
  localOnly: 'Checked on your phone from the link itself. Nothing was sent anywhere.',
};
