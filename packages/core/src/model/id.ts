/**
 * UUID v4 generation that works on every target we ship to.
 *
 * Postgres columns are `uuid`, so ids have to be real UUIDs — the old
 * `Date.now()-random` scheme would have been rejected on the first sync.
 */

type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T
}

const getCrypto = (): CryptoLike | undefined =>
  (globalThis as { crypto?: CryptoLike }).crypto

const HEX: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0'),
)

export function uuid(): string {
  const c = getCrypto()

  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    // React Native without `react-native-get-random-values` installed, and
    // Hermes without the crypto polyfill. Not cryptographically strong, but
    // these ids only need to avoid collisions within one user's canvas.
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  // Version 4, variant 10xx.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  return (
    HEX[bytes[0]!]! + HEX[bytes[1]!]! + HEX[bytes[2]!]! + HEX[bytes[3]!]! + '-' +
    HEX[bytes[4]!]! + HEX[bytes[5]!]! + '-' +
    HEX[bytes[6]!]! + HEX[bytes[7]!]! + '-' +
    HEX[bytes[8]!]! + HEX[bytes[9]!]! + '-' +
    HEX[bytes[10]!]! + HEX[bytes[11]!]! + HEX[bytes[12]!]! +
    HEX[bytes[13]!]! + HEX[bytes[14]!]! + HEX[bytes[15]!]!
  )
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isUuid = (value: string): boolean => UUID_RE.test(value)
