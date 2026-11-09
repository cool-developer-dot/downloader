import { toStorageError } from '@/storage/types';

// B20: the active browser profile's database (the app database for the default profile).
import { getBrowserDatabase as getDatabase } from '../sqlite/browser-database';
import { deleteNote, insertNote, listNotes, updateNoteText, type Note } from './notes.queries';

export type { Note } from './notes.queries';

/** B22 #252 — notes, per browser profile; SQL in notes.queries.ts. */
export class NotesRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  list(query = ''): Promise<Note[]> {
    return this.run('read notes', (db) => listNotes(db, query));
  }

  add(note: { id: string; text: string; pageUrl: string; pageTitle: string }): Promise<void> {
    return this.run('save a note', (db) => insertNote(db, note, new Date().toISOString()));
  }

  update(id: string, text: string): Promise<boolean> {
    return this.run('edit a note', (db) => updateNoteText(db, id, text, new Date().toISOString()));
  }

  remove(id: string): Promise<boolean> {
    return this.run('delete a note', (db) => deleteNote(db, id));
  }
}

export const notesRepository = new NotesRepository();
