/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absent in a build without sync configured; the app then stays local-only. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
