import { useEffect, useRef } from 'react'
import { removeSpan, translate } from '@antigravity/core'
import { useStore } from '../state/store'

/**
 * The single search field.
 *
 * There are no filter buttons anywhere in this app. What the parser recognised
 * shows up underneath as chips, which is the compromise that makes an implicit
 * query language honest: the user still typed one line, but they can see what
 * the app decided it meant, and dismissing a chip edits the line itself rather
 * than hiding state beside it.
 */
export function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const query = useStore((s) => s.query)
  const setQuery = useStore((s) => s.setQuery)
  const search = useStore((s) => s.search)
  const notes = useStore((s) => s.notes)
  const locale = useStore((s) => s.locale)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === '/' && !typing) {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('')
        inputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setQuery])

  const chips = search?.parsed.chips ?? []
  const resultCount = search?.results.length ?? 0

  return (
    <div className="search">
      <div className="search__field">
        <svg className="search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5 L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          data-testid="search-input"
          placeholder={translate(locale, 'search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            className="search__clear"
            data-testid="search-clear"
            onClick={() => setQuery('')}
            aria-label={translate(locale, 'search.clear')}
          >
            ✕
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="search__chips" data-testid="search-chips">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`chip chip--${chip.kind}`}
              title={chip.detail}
              data-testid={`chip-${chip.kind}`}
              onClick={() => setQuery(removeSpan(query, chip.span))}
            >
              <span className="chip__label">{chip.label}</span>
              <span className="chip__remove" aria-hidden="true">✕</span>
            </button>
          ))}
        </div>
      )}

      {search && (
        <div className="search__count" data-testid="search-count">
          {resultCount === 0
            ? translate(locale, 'search.results.none')
            : translate(locale, 'search.results.count', {
                count: resultCount,
                total: notes.length,
              })}
        </div>
      )}
    </div>
  )
}
