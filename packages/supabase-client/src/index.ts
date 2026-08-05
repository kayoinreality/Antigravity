import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export { SupabaseAdapter, type SupabaseAdapterOptions } from './adapter'
export {
  linkFromRow,
  linkToWire,
  noteFromRow,
  noteToWire,
  systemFromRow,
  systemToWire,
  type LinkRow,
  type NoteRow,
  type SystemRow,
} from './wire'

export interface SupabaseConfig {
  url: string
  anonKey: string
  /**
   * Where to persist the auth session. React Native has no localStorage, so the
   * mobile app passes an AsyncStorage-shaped wrapper over MMKV.
   */
  storage?: {
    getItem: (key: string) => Promise<string | null> | string | null
    setItem: (key: string, value: string) => Promise<void> | void
    removeItem: (key: string) => Promise<void> | void
  }
  /** False on native: there is no URL bar to read an OAuth callback from. */
  detectSessionInUrl?: boolean
}

/**
 * Returns null when the app was built without Supabase credentials.
 *
 * That is a supported configuration, not an error: the whole app works
 * local-first, and a missing key simply means this install never syncs. The
 * sync engine treats a null adapter as "disabled" and everything else carries
 * on unchanged.
 */
export function createSupabaseClient(config: Partial<SupabaseConfig>): SupabaseClient | null {
  if (!config.url || !config.anonKey) return null

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: config.detectSessionInUrl ?? true,
      ...(config.storage ? { storage: config.storage } : {}),
    },
    realtime: {
      // The canvas is a personal workspace, so the only events are this user's
      // own other devices. A low rate keeps the socket cheap on mobile.
      params: { eventsPerSecond: 4 },
    },
  })
}
