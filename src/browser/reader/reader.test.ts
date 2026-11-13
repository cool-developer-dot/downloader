import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { buildReaderArticle, isUrduText, parseReaderMessage, readingMinutes, READER_MESSAGE_MAX } from './reader-article.ts';
import { readerCheckScript, readerExtractScript, READER_CHANNEL } from './reader-scripts.ts';
import { blockText, readerBlocks, safeUrl, sanitizeReaderHtml } from './reader-sanitize.ts';
import { pickVoice, speechChunks, splitForSpeech, stepChunk } from './read-aloud.ts';
import {
  contrastRatio,
  normalizeReaderTheme,
  READER_PALETTES,
  readerLineHeight,
  readerPalette,
  stepReaderFontSize,
} from './reader-settings.ts';
import { READABILITY_VERSION } from './vendor/readability-source.ts';

const BASE = 'https://news.example.com/2026/story.html';

describe('reader sanitiser (#161)', () => {
  test('drops scripts, styles, frames, forms, media and SVG with everything inside them', () => {
    const html = [
      '<p>Kept</p>',
      '<script>alert(1)</script>',
      '<script type="text/javascript"><p>not text</p></script>',
      '<style>p { color: red }</style>',
      '<iframe src="https://evil.example/"><p>frame text</p></iframe>',
      '<object data="x.swf"><embed src="x.swf"></object>',
      '<form action="https://evil.example/"><input name="a"><button>Go</button></form>',
      '<svg><script>alert(2)</script><a href="https://x.example/">svg link</a></svg>',
      '<noscript><img src="https://t.example/pixel.gif"></noscript>',
      '<video src="https://x.example/v.mp4"><p>fallback</p></video>',
      '<template><p>tpl</p></template>',
    ].join('');
    const out = sanitizeReaderHtml(html, BASE);
    assert.equal(out, '<p>Kept</p>');
  });

  test('nested dropped tags of the same name are fully skipped', () => {
    const out = sanitizeReaderHtml('<object><object>a</object>b</object><p>after</p>', BASE);
    assert.equal(out, '<p>after</p>');
  });

  test('every attribute goes: event handlers, styles, ids, classes', () => {
    const out = sanitizeReaderHtml(
      '<p onclick="alert(1)" style="background:url(javascript:alert(1))" class="x" id="y">Hi <b onmouseover="x()">there</b></p>',
      BASE,
    );
    assert.equal(out, '<p>Hi <b>there</b></p>');
    assert.ok(!/on\w+=|style=|class=|id=/.test(out));
  });

  test('javascript:, data:, vbscript: and file: links become plain text; tricks with spaces and entities too', () => {
    const cases = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java&#x09;script:alert(1)',
      '&#106;avascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///sdcard/secret.txt',
      'intent://scan/#Intent;scheme=zxing;end',
    ];
    for (const href of cases) {
      const out = sanitizeReaderHtml(`<p><a href="${href.replace(/"/g, '&quot;')}">link</a></p>`, BASE);
      assert.equal(out, '<p>link</p>', href);
    }
  });

  test('web links are kept, made absolute, and their attributes escaped', () => {
    const out = sanitizeReaderHtml('<p><a href="/next?a=1&amp;b=2" target="_blank" onclick="x()">next</a></p>', BASE);
    assert.equal(out, '<p><a href="https://news.example.com/next?a=1&amp;b=2">next</a></p>');
    assert.equal(safeUrl('"><script>', BASE), 'https://news.example.com/2026/%22%3E%3Cscript%3E');
  });

  test('images keep only an http(s) src and alt', () => {
    const out = sanitizeReaderHtml(
      '<img src="pic.jpg" alt="A &quot;cat&quot;" onerror="alert(1)" srcset="x 2x"><img src="javascript:alert(1)"><img src="data:image/png;base64,AAAA">',
      BASE,
    );
    assert.equal(out, '<img src="https://news.example.com/2026/pic.jpg" alt="A &quot;cat&quot;">');
  });

  test('unknown tags are unwrapped, layout tags become paragraphs, comments and doctypes vanish', () => {
    const out = sanitizeReaderHtml('<!doctype html><!-- c --><div><span>one</span> <custom-el>two</custom-el></div><section>three</section>', BASE);
    assert.equal(out, '<p>one two</p><p>three</p>');
  });

  test('text is escaped, stray brackets kept as text, unclosed tags closed', () => {
    const out = sanitizeReaderHtml('<p>1 < 2 &amp;&amp; 3 > 2 <b>bold <i>both', BASE);
    assert.equal(out, '<p>1 &lt; 2 &amp;&amp; 3 &gt; 2 <b>bold <i>both</i></b></p>');
  });

  test('stray closing tags do not close anything else', () => {
    const out = sanitizeReaderHtml('<p>a</b>b</a>c</p>', BASE);
    assert.equal(out, '<p>abc</p>');
  });

  test('attribute values containing ">" do not end the tag early', () => {
    const out = sanitizeReaderHtml('<p title="a > b" onclick="x()">t</p>', BASE);
    assert.equal(out, '<p>t</p>');
  });
});

describe('reader blocks', () => {
  test('paragraphs, headings, lists, quotes, code, images, rules', () => {
    const html = sanitizeReaderHtml(
      [
        '<h1>Title</h1>',
        '<p>Some <strong>bold</strong> and <em>italic</em> with <a href="https://x.example/">a link</a>.</p>',
        '<h4>Small heading</h4>',
        '<ul><li>one</li><li>two<ol><li>inner</li></ol></li></ul>',
        '<blockquote><p>quoted</p></blockquote>',
        '<pre><code>let a = 1;\n  let b = 2;</code></pre>',
        '<img src="https://x.example/a.png" alt="pic">',
        '<hr>',
        '<p>   </p>',
      ].join('\n'),
      BASE,
    );
    const blocks = readerBlocks(html);
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['h', 'p', 'h', 'li', 'li', 'li', 'quote', 'pre', 'img', 'hr'],
    );
    assert.deepEqual(blocks[0], { type: 'h', level: 1, spans: [{ text: 'Title' }] });
    assert.deepEqual(blocks[1], {
      type: 'p',
      spans: [
        { text: 'Some ' },
        { text: 'bold', bold: true },
        { text: ' and ' },
        { text: 'italic', italic: true },
        { text: ' with ' },
        { text: 'a link', href: 'https://x.example/' },
        { text: '.' },
      ],
    });
    assert.equal(blocks[2].type === 'h' && blocks[2].level, 3);
    assert.deepEqual(
      blocks.slice(3, 6).map((b) => (b.type === 'li' ? [b.ordered, b.index, b.depth, blockText(b)] : null)),
      [
        [false, 1, 0, 'one'],
        [false, 2, 0, 'two'],
        [true, 1, 1, 'inner'],
      ],
    );
    assert.equal(blockText(blocks[6]), 'quoted');
    assert.equal(blockText(blocks[7]), 'let a = 1;\n  let b = 2;');
    assert.deepEqual(blocks[8], { type: 'img', src: 'https://x.example/a.png', alt: 'pic' });
  });

  test('white space collapses outside <pre>; <br> keeps a line break', () => {
    const blocks = readerBlocks(sanitizeReaderHtml('<p>  a \n\n  b<br>c  </p>', BASE));
    assert.equal(blockText(blocks[0]), 'a b\nc');
  });
});

describe('reader messages', () => {
  const envelope = (payload: unknown) => JSON.stringify({ channel: READER_CHANNEL, payload });

  test('state messages are checked', () => {
    assert.deepEqual(parseReaderMessage(envelope({ type: 'state', requestId: 3, readerable: true, url: BASE })), {
      type: 'state',
      requestId: 3,
      readerable: true,
      url: BASE,
    });
    assert.equal(parseReaderMessage(envelope({ type: 'state', requestId: 3, readerable: 'yes', url: BASE })), null);
    assert.equal(parseReaderMessage(envelope({ type: 'state', requestId: -1, readerable: true, url: BASE })), null);
    assert.equal(parseReaderMessage(envelope({ type: 'state', requestId: 1.5, readerable: true, url: BASE })), null);
    assert.equal(parseReaderMessage(envelope({ type: 'state', requestId: 1, readerable: true, url: 'javascript:1' })), null);
  });

  test('other channels, bad JSON and oversized messages are ignored', () => {
    assert.equal(parseReaderMessage(JSON.stringify({ channel: 'vidorax-browser-chrome', payload: {} })), null);
    assert.equal(parseReaderMessage(`{"channel":"${READER_CHANNEL}",`), null);
    assert.equal(parseReaderMessage(`{"channel":"${READER_CHANNEL}"${' '.repeat(READER_MESSAGE_MAX)}}`), null);
    assert.equal(parseReaderMessage(undefined), null);
  });

  test('articles: strings bounded, direction checked, failures kept as failures', () => {
    const parsed = parseReaderMessage(
      envelope({
        type: 'article',
        requestId: 9,
        ok: true,
        url: BASE,
        title: '  A   title ',
        byline: 42,
        siteName: 'News',
        lang: 'en-GB',
        dir: 'sideways',
        html: '<p>x</p>',
      }),
    );
    assert.ok(parsed && parsed.type === 'article' && parsed.ok);
    assert.equal(parsed.title, 'A title');
    assert.equal(parsed.byline, '');
    assert.equal(parsed.dir, '');
    assert.equal(parsed.truncated, false);
    assert.deepEqual(parseReaderMessage(envelope({ type: 'article', requestId: 9, ok: false, url: BASE })), {
      type: 'article',
      requestId: 9,
      ok: false,
      url: BASE,
    });
  });

  test('an article is built: reading time, direction, Urdu detection', () => {
    const words = Array.from({ length: 660 }, (_, i) => `word${i}`).join(' ');
    const article = buildReaderArticle({
      type: 'article',
      requestId: 1,
      ok: true,
      url: BASE,
      title: 'T',
      byline: 'By A',
      siteName: 'S',
      lang: 'en',
      dir: '',
      html: `<p>${words}</p><script>bad()</script>`,
      truncated: false,
    });
    assert.ok(article);
    assert.equal(article.minutes, 3);
    assert.equal(article.rtl, false);
    assert.equal(article.urdu, false);
    assert.equal(article.language, 'en');
    assert.equal(article.blocks.length, 1);

    const empty = buildReaderArticle({ ...article, type: 'article', requestId: 1, ok: true, lang: '', dir: '', html: '<script>x</script>' });
    assert.equal(empty, null);
  });
});

describe('Urdu detection (#172)', () => {
  const urdu = 'پاکستان میں آج موسم خوشگوار رہے گا اور شام کو ہلکی بارش کا امکان ہے۔ لوگوں نے بڑی تعداد میں بازاروں کا رخ کیا۔';
  const arabic = 'تتوقع الأرصاد الجوية أن يكون الطقس معتدلا اليوم مع احتمال سقوط أمطار خفيفة في المساء على معظم المناطق.';
  const persian = 'هوای امروز در بیشتر نقاط کشور معتدل خواهد بود و احتمال بارش باران در عصر وجود دارد که مردم باید آماده باشند.';

  test('by language when the page says one', () => {
    assert.equal(isUrduText('anything', 'ur'), true);
    assert.equal(isUrduText(urdu, 'ar'), false);
    assert.equal(isUrduText(urdu, 'fa-IR'), false);
  });

  test('by letters otherwise (also when a template says en)', () => {
    assert.equal(isUrduText(urdu, ''), true);
    assert.equal(isUrduText(urdu, 'en'), true);
    assert.equal(isUrduText(arabic, ''), false);
    assert.equal(isUrduText(persian, ''), false);
    assert.equal(isUrduText('An English article about Lahore and Karachi weather today.', ''), false);
  });

  test('an Urdu article reads right to left with an Urdu voice', () => {
    const article = buildReaderArticle({
      type: 'article',
      requestId: 1,
      ok: true,
      url: BASE,
      title: 'موسم',
      byline: '',
      siteName: '',
      lang: '',
      dir: '',
      html: `<p>${urdu}</p>`,
      truncated: false,
    });
    assert.ok(article);
    assert.equal(article.urdu, true);
    assert.equal(article.rtl, true);
    assert.equal(article.language, 'ur-PK');
  });

  test('reading time is at least a minute', () => {
    assert.equal(readingMinutes(''), 1);
    assert.equal(readingMinutes(Array.from({ length: 2200 }, () => 'w').join(' ')), 10);
  });
});

/** A page with just enough DOM for isProbablyReaderable: paragraphs with text, all visible. */
function fakePage(paragraphs: string[], extra: Record<string, unknown> = {}) {
  const posted: string[] = [];
  const nodes = paragraphs.map((text) => ({
    textContent: text,
    className: '',
    id: '',
    style: { display: '' },
    hasAttribute: () => false,
    getAttribute: () => null,
    parentNode: null,
    matches: () => false,
  }));
  const document = {
    body: {},
    title: 'Fake',
    documentElement: { lang: 'en' },
    querySelectorAll: () => nodes,
    cloneNode: () => {
      throw new Error('no DOM here');
    },
  };
  const context: Record<string, unknown> = {
    document,
    location: { href: BASE },
    JSON,
    String,
    Math,
    Array,
    Error,
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    ...extra,
  };
  context.window = context;
  vm.createContext(context);
  return { run: (script: string) => vm.runInContext(script, context), posted, context };
}

describe('reader page scripts (node:vm)', () => {
  test('the check script answers readerable for a page of long paragraphs', () => {
    const page = fakePage(Array.from({ length: 6 }, (_, i) => `Paragraph ${i} `.repeat(30)));
    page.run(readerCheckScript(5));
    assert.equal(page.posted.length, 1);
    assert.deepEqual(parseReaderMessage(page.posted[0]), { type: 'state', requestId: 5, readerable: true, url: BASE });
  });

  test('the check script answers not readerable for a short page', () => {
    const page = fakePage(['Sign in', 'Menu']);
    page.run(readerCheckScript(6));
    assert.deepEqual(parseReaderMessage(page.posted[0]), { type: 'state', requestId: 6, readerable: false, url: BASE });
  });

  test('scripts add nothing to the page globals and only carry a request number', () => {
    const page = fakePage(['x']);
    page.run(readerCheckScript(1));
    page.run(readerExtractScript(2));
    for (const name of ['Readability', 'isProbablyReaderable', 'module', 'post']) {
      assert.equal(name in page.context, false, name);
    }
    assert.ok(readerCheckScript(Number.NaN).includes('requestId: 0'));
    assert.ok(readerExtractScript(-4).includes('requestId: 0'));
  });

  test('a page Readability cannot read answers a failure, never throws', () => {
    const page = fakePage(['x']);
    page.run(readerExtractScript(7));
    assert.deepEqual(parseReaderMessage(page.posted[0]), { type: 'article', requestId: 7, ok: false, url: BASE });
  });

  test('both scripts compile', () => {
    assert.doesNotThrow(() => new vm.Script(readerCheckScript(1)));
    assert.doesNotThrow(() => new vm.Script(readerExtractScript(1)));
  });
});

describe('vendored Readability', () => {
  test('readability-source.ts is the generator output for the installed version', async () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const generator = pathToFileURL(path.join(root, 'scripts/dev/generate-readability-source.mjs')).href;
    const { generate } = (await import(generator)) as { generate: () => string };
    const current = fs.readFileSync(path.join(import.meta.dirname, 'vendor/readability-source.ts'), 'utf8');
    assert.equal(current, generate(), 'run: node scripts/dev/generate-readability-source.mjs');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@mozilla/readability/package.json'), 'utf8')) as { version: string };
    assert.equal(READABILITY_VERSION, pkg.version);
  });
});

describe('read aloud (#173)', () => {
  const blocks = readerBlocks(
    sanitizeReaderHtml('<h2>Head</h2><p>One. Two.</p><pre>code()</pre><img src="https://x.example/a.png"><p>  </p><ul><li>item</li></ul><p>Last</p>', BASE),
  );

  test('reads headings, paragraphs and list items; skips code, pictures and empty blocks', () => {
    assert.deepEqual(
      speechChunks(blocks).map((c) => [c.blockIndex, c.text]),
      [
        [0, 'Head'],
        [1, 'One. Two.'],
        [4, 'item'],
        [5, 'Last'],
      ],
    );
  });

  test('long paragraphs are split at sentence ends, then spaces, within the limit', () => {
    const sentence = 'This is a sentence of moderate length. ';
    const long = sentence.repeat(20);
    const pieces = splitForSpeech(long, 200);
    assert.ok(pieces.length > 1);
    assert.ok(pieces.every((p) => p.length <= 200));
    assert.ok(pieces.slice(0, -1).every((p) => p.endsWith('.')));
    assert.equal(pieces.join(' '), long.trim());
    const urdu = 'یہ ایک جملہ ہے۔ '.repeat(30);
    assert.ok(splitForSpeech(urdu, 100).slice(0, -1).every((p) => p.endsWith('۔')));
    const noSpaces = 'x'.repeat(450);
    assert.deepEqual(splitForSpeech(noSpaces, 200).map((p) => p.length), [200, 200, 50]);
  });

  test('previous / next move a paragraph at a time', () => {
    const chunks = [
      { blockIndex: 0, text: 'a' },
      { blockIndex: 1, text: 'b1' },
      { blockIndex: 1, text: 'b2' },
      { blockIndex: 3, text: 'c' },
    ];
    assert.equal(stepChunk(chunks, 0, 1), 1);
    assert.equal(stepChunk(chunks, 2, 1), 3);
    assert.equal(stepChunk(chunks, 3, 1), 4);
    assert.equal(stepChunk(chunks, 3, -1), 1);
    assert.equal(stepChunk(chunks, 2, -1), 0);
    assert.equal(stepChunk(chunks, 0, -1), 0);
    assert.equal(stepChunk([], 0, 1), 0);
  });

  test('voices: an offline one in the language, never a network voice', () => {
    const voices = [
      { identifier: 'en-us-x-sfg-network', name: 'en-us-x-sfg-network', language: 'en-US' },
      { identifier: 'en-gb-x-gba-local', name: 'en-gb-x-gba-local', language: 'en-GB' },
      { identifier: 'en-us-x-tpd-local', name: 'en-us-x-tpd-local', language: 'en-US' },
      { identifier: 'ur-pk-x-cfn-network', name: 'ur-pk-x-cfn-network', language: 'ur-PK' },
    ];
    assert.equal(pickVoice(voices, 'en-US')?.identifier, 'en-us-x-tpd-local');
    assert.equal(pickVoice(voices, 'en')?.identifier, 'en-gb-x-gba-local');
    assert.equal(pickVoice(voices, 'ur-PK'), null);
    assert.equal(pickVoice([...voices, { identifier: 'ur_PK_local', name: 'ur', language: 'ur_PK' }], 'ur-PK')?.identifier, 'ur_PK_local');
    assert.equal(pickVoice(voices, ''), null);
  });
});

describe('reader settings (#172)', () => {
  test('choices normalise; text size steps stay in range', () => {
    assert.equal(normalizeReaderTheme('sepia'), 'sepia');
    assert.equal(normalizeReaderTheme('purple'), 'app');
    assert.equal(stepReaderFontSize('32', 1), '32');
    assert.equal(stepReaderFontSize('14', -1), '14');
    assert.equal(stepReaderFontSize('18', 1), '20');
  });

  test('every reader palette has readable text, secondary text and links (4.5:1)', () => {
    for (const [name, palette] of Object.entries(READER_PALETTES)) {
      for (const key of ['text', 'secondary', 'link'] as const) {
        assert.ok(contrastRatio(palette[key], palette.background) >= 4.5, `${name}.${key}`);
        assert.ok(contrastRatio(palette[key], palette.highlight) >= 4.5, `${name}.${key} on highlight`);
      }
    }
    assert.equal(readerPalette('app', true), READER_PALETTES.dark);
    assert.equal(readerPalette('app', false), READER_PALETTES.light);
  });

  test('Nastaliq gets more line height', () => {
    assert.ok(readerLineHeight('normal', true) > readerLineHeight('wide', false));
  });
});
