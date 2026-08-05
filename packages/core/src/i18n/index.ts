/**
 * Two locales, flat keys, no runtime dependency. Falls back pt-BR -> en so a
 * missing key never renders as a blank string.
 */

export type Locale = 'pt' | 'en'

const en = {
  'app.name': 'antigravity',
  'canvas.empty.title': 'Your sky is empty',
  'canvas.empty.subtitle': 'Double-tap anywhere to place a note',
  'canvas.empty.subtitle.web': 'Double-click anywhere to place a note',
  'canvas.notes.one': '1 note',
  'canvas.notes.many': '{count} notes',

  'search.placeholder': 'Search — try "meeting last week"',
  'search.results.none': 'Nothing out there',
  'search.results.count': '{count} of {total}',
  'search.clear': 'Clear',
  'search.chip.remove': 'Remove filter',

  'filter.text': 'text',
  'filter.tag': 'tag',
  'filter.color': 'colour',
  'filter.system': 'system',
  'filter.dateRange': 'between',
  'filter.dateAfter': 'after',
  'filter.dateBefore': 'before',
  'filter.dateOn': 'on',
  'filter.empty': 'empty notes',
  'filter.linked': 'linked',
  'filter.unlinked': 'unlinked',
  'filter.pinned': 'pinned',

  'editor.title.placeholder': 'Title',
  'editor.body.placeholder': 'Start writing…',
  'editor.done': 'Done',
  'editor.delete': 'Delete',
  'editor.words': '{count} words',
  'editor.chars': '{count} characters',

  'blackhole.hint': 'Drag up to release',
  'blackhole.deleted': 'Note absorbed',
  'blackhole.undo': 'Restore',

  'system.suggest': '{count} notes about “{label}” — form a system?',
  'system.accept': 'Form system',
  'system.dismiss': 'Not now',
  'system.dissolve': 'Dissolve system',
  'system.escaped': 'Note left {label}',

  'sync.offline': 'Offline',
  'sync.syncing': 'Syncing…',
  'sync.synced': 'Synced',
  'sync.error': 'Sync failed',
  'sync.signIn': 'Sign in to sync',
  'sync.signOut': 'Sign out',
  'sync.localOnly': 'On this device only',
  'sync.claimed': '{count} local notes moved to your account',

  'auth.email': 'Email',
  'auth.sendLink': 'Send magic link',
  'auth.linkSent': 'Check your inbox',
  'auth.google': 'Continue with Google',
} as const

export type MessageKey = keyof typeof en

const pt: Partial<Record<MessageKey, string>> = {
  'canvas.empty.title': 'Seu céu está vazio',
  'canvas.empty.subtitle': 'Toque duas vezes em qualquer lugar para criar uma nota',
  'canvas.empty.subtitle.web': 'Clique duas vezes em qualquer lugar para criar uma nota',
  'canvas.notes.one': '1 nota',
  'canvas.notes.many': '{count} notas',

  'search.placeholder': 'Buscar — tente "reunião semana passada"',
  'search.results.none': 'Nada por aí',
  'search.results.count': '{count} de {total}',
  'search.clear': 'Limpar',
  'search.chip.remove': 'Remover filtro',

  'filter.text': 'texto',
  'filter.tag': 'tag',
  'filter.color': 'cor',
  'filter.system': 'sistema',
  'filter.dateRange': 'entre',
  'filter.dateAfter': 'depois de',
  'filter.dateBefore': 'antes de',
  'filter.dateOn': 'em',
  'filter.empty': 'notas vazias',
  'filter.linked': 'com link',
  'filter.unlinked': 'sem link',
  'filter.pinned': 'fixadas',

  'editor.title.placeholder': 'Título',
  'editor.body.placeholder': 'Comece a escrever…',
  'editor.done': 'Pronto',
  'editor.delete': 'Excluir',
  'editor.words': '{count} palavras',
  'editor.chars': '{count} caracteres',

  'blackhole.hint': 'Arraste para cima para soltar',
  'blackhole.deleted': 'Nota absorvida',
  'blackhole.undo': 'Restaurar',

  'system.suggest': '{count} notas sobre “{label}” — formar sistema?',
  'system.accept': 'Formar sistema',
  'system.dismiss': 'Agora não',
  'system.dissolve': 'Dissolver sistema',
  'system.escaped': 'Nota saiu de {label}',

  'sync.offline': 'Offline',
  'sync.syncing': 'Sincronizando…',
  'sync.synced': 'Sincronizado',
  'sync.error': 'Falha ao sincronizar',
  'sync.signIn': 'Entrar para sincronizar',
  'sync.signOut': 'Sair',
  'sync.localOnly': 'Somente neste aparelho',
  'sync.claimed': '{count} notas locais foram para a sua conta',

  'auth.email': 'E-mail',
  'auth.sendLink': 'Enviar link mágico',
  'auth.linkSent': 'Confira sua caixa de entrada',
  'auth.google': 'Continuar com Google',
}

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, pt }

export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = CATALOGS[locale][key] ?? en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** Turns "pt-BR", "pt_PT", "pt" into 'pt'; anything else into 'en'. */
export function resolveLocale(tag: string | undefined | null): Locale {
  return tag?.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

export function makeTranslator(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    translate(locale, key, params)
}
