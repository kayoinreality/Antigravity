import { MMKV } from 'react-native-mmkv';
import { create } from 'zustand';

type StorageLike = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
};

type CreateNoteInput = {
  title: string;
  content: string;
};

type UpdateNoteInput = {
  id: string;
  title: string;
  content: string;
};

type NotesState = {
  notes: Note[];
  isHydrated: boolean;
  hydrate: () => void;
  createNote: (input: CreateNoteInput) => void;
  updateNote: (input: UpdateNoteInput) => void;
  deleteNote: (id: string) => void;
  moveNote: (id: string, x: number, y: number) => void;
};

const STORAGE_KEY = 'antigravity.notes.v1';

const createStorage = (): StorageLike => {
  try {
    const storage = new MMKV({ id: 'antigravity-notes' });
    return {
      getString: (key: string) => storage.getString(key),
      set: (key: string, value: string) => storage.set(key, value),
      delete: (key: string) => storage.delete(key),
    };
  } catch {
    const fallback = new Map<string, string>();
    return {
      getString: (key: string) => fallback.get(key),
      set: (key: string, value: string) => {
        fallback.set(key, value);
      },
      delete: (key: string) => {
        fallback.delete(key);
      },
    };
  }
};

const storage = createStorage();

const persistNotes = (notes: Note[]) => {
  storage.set(STORAGE_KEY, JSON.stringify(notes));
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const defaultPositionForIndex = (index: number) => ({
  x: 16 + (index % 3) * 18,
  y: 96 + (index % 5) * 20,
});

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  isHydrated: false,

  hydrate: () => {
    if (get().isHydrated) {
      return;
    }

    const raw = storage.getString(STORAGE_KEY);
    if (!raw) {
      set({ isHydrated: true });
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Note[];
      if (!Array.isArray(parsed)) {
        set({ isHydrated: true, notes: [] });
        storage.delete(STORAGE_KEY);
        return;
      }

      set({ notes: parsed, isHydrated: true });
    } catch {
      set({ notes: [], isHydrated: true });
      storage.delete(STORAGE_KEY);
    }
  },

  createNote: ({ title, content }) => {
    const current = get().notes;
    const now = Date.now();
    const position = defaultPositionForIndex(current.length);

    const next: Note[] = [
      {
        id: generateId(),
        title,
        content,
        x: position.x,
        y: position.y,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ];

    set({ notes: next });
    persistNotes(next);
  },

  updateNote: ({ id, title, content }) => {
    const now = Date.now();
    const next = get().notes.map((note) =>
      note.id === id
        ? {
            ...note,
            title,
            content,
            updatedAt: now,
          }
        : note
    );

    set({ notes: next });
    persistNotes(next);
  },

  deleteNote: (id) => {
    const next = get().notes.filter((note) => note.id !== id);
    set({ notes: next });
    persistNotes(next);
  },

  moveNote: (id, x, y) => {
    const next = get().notes.map((note) =>
      note.id === id
        ? {
            ...note,
            x,
            y,
          }
        : note
    );

    set({ notes: next });
    persistNotes(next);
  },
}));
