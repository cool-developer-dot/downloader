import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { buildMediaDetectionInjectedScript } from './injected-script.ts';

/** A minimal element: children, an optional open shadow root, and querySelectorAll('video') over its light tree. */
type FakeNode = { tag: string; children: FakeNode[]; shadowRoot?: FakeNode | null; querySelectorAll?: (sel: string) => FakeNode[] };

function el(tag: string, children: FakeNode[] = [], shadow?: FakeNode[]): FakeNode {
  const node: FakeNode = { tag, children };
  if (shadow) node.shadowRoot = root(shadow);
  return node;
}

function root(children: FakeNode[]): FakeNode {
  const node: FakeNode = { tag: '#shadow-root', children };
  node.querySelectorAll = (sel: string) => {
    assert.equal(sel, 'video');
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => {
      if (n.tag === 'video') out.push(n);
      n.children.forEach(walk);
    };
    children.forEach(walk);
    return out;
  };
  return node;
}

/** The walk as the page runs it: its source cut from the injected script, run against a fake document. */
function loadScan(documentElement: FakeNode) {
  const script = buildMediaDetectionInjectedScript();
  const start = script.indexOf('  var MAX_SHADOW_SCAN_NODES');
  const end = script.indexOf('  function ensureIframeIdentity');
  assert.ok(start > 0 && end > start, 'shadowVideoScan in the observer');
  const document = { documentElement };
  const context = vm.createContext({ document, Date });
  vm.runInContext(`var MAX_TRACKED_VIDEOS = 12;\n${script.slice(start, end)}`, context);
  return { scan: context.shadowVideoScan as (doc: unknown) => { videos: FakeNode[]; roots: FakeNode[] }, document };
}

describe('videos inside shadow roots', () => {
  it("finds a web-component player's video, nested roots included, and the roots holding them", () => {
    const redditVideo = el('video');
    const nestedVideo = el('video');
    const page = el('html', [
      el('body', [
        el('header', [el('div'), el('nav')]),
        el('shreddit-player', [], [el('div', [redditVideo])]),
        el('outer-card', [], [el('inner-player', [], [nestedVideo])]),
        el('video'), // a light-DOM video is the ordinary scan's, not this one's
      ]),
    ]);
    const { scan, document } = loadScan(page);
    const found = scan(document);
    // Arrays made inside the vm context have its prototypes: compare the elements.
    assert.deepEqual([...found.videos], [redditVideo, nestedVideo]);
    assert.equal(found.roots.length, 2);
  });

  it('a page without shadow roots finds nothing', () => {
    const { scan, document } = loadScan(el('html', [el('body', [el('video'), el('div', [el('p')])])]));
    const found = scan(document);
    assert.equal(found.videos.length, 0);
    assert.equal(found.roots.length, 0);
  });

  it('stays bounded on a huge page', () => {
    const late = el('late-player', [], [el('video')]);
    const filler = Array.from({ length: 5000 }, () => el('div'));
    const { scan, document } = loadScan(el('html', [el('body', [...filler, late])]));
    assert.equal(scan(document).videos.length, 0);
  });
});
