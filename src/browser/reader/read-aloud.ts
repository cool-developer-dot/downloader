/**
 * B15 #173 — what read aloud says, and with which voice. Pure.
 */
import { blockText, type ReaderBlock } from './reader-sanitize';

export type SpeechChunk = { blockIndex: number; text: string };

/** Android's TextToSpeech takes at most 4000 characters an utterance; leave room. */
export const SPEECH_CHUNK_MAX = 3800;

/** Splits one paragraph into pieces the speech engine accepts, at sentence ends, else at spaces, else anywhere. */
export function splitForSpeech(text: string, max = SPEECH_CHUNK_MAX): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    const sentence = /[.!?\u06d4\u061f\u3002](?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = sentence.exec(window))) cut = m.index + 1;
    if (cut < max / 3) cut = window.lastIndexOf(' ');
    if (cut < max / 3) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** What is read: headings, paragraphs, list items and quotes, in order (code, pictures and rules are skipped). */
export function speechChunks(blocks: readonly ReaderBlock[], max = SPEECH_CHUNK_MAX): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.type === 'pre' || block.type === 'img' || block.type === 'hr') return;
    const text = blockText(block).replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    for (const piece of splitForSpeech(text, max)) chunks.push({ blockIndex, text: piece });
  });
  return chunks;
}

/** The first chunk of the next (+1) or previous (-1) paragraph from chunk `at`. */
export function stepChunk(chunks: readonly SpeechChunk[], at: number, direction: 1 | -1): number {
  if (!chunks.length) return 0;
  const current = chunks[Math.min(Math.max(at, 0), chunks.length - 1)].blockIndex;
  if (direction > 0) {
    const next = chunks.findIndex((c) => c.blockIndex > current);
    return next < 0 ? chunks.length : next;
  }
  // Back: to the start of this paragraph's previous paragraph.
  let i = chunks.findIndex((c) => c.blockIndex === current);
  if (i <= 0) return 0;
  const previous = chunks[i - 1].blockIndex;
  while (i > 0 && chunks[i - 1].blockIndex === previous) i -= 1;
  return i;
}

export type VoiceInfo = { identifier: string; name: string; language: string };

/**
 * The voice for a language: one on the phone (Android names voices that need the internet "...-network"; those are
 * skipped, so reading never goes online), the "Enhanced"-free first match. null = no voice for that language.
 */
export function pickVoice(voices: readonly VoiceInfo[], language: string): VoiceInfo | null {
  const wanted = language.toLowerCase().split(/[-_]/)[0];
  if (!wanted) return null;
  const local = voices.filter((v) => {
    const lang = v.language.toLowerCase().replace('_', '-');
    const offline = !/network/i.test(v.identifier) && !/network/i.test(v.name);
    return offline && (lang === wanted || lang.startsWith(`${wanted}-`));
  });
  if (!local.length) return null;
  const exact = local.find((v) => v.language.toLowerCase().replace('_', '-') === language.toLowerCase());
  return exact ?? local[0];
}
