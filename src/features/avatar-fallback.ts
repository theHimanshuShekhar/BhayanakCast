/** Avatar fallbacks in the terminal-club world are two-character mono discs on a
    deterministic tint, the way an IRC or terminal client labels a nick it has no
    picture for. The tint is decorative account identity, never state: the six
    `--avatar-tint-*` hues sit at least 24° away from every semantic family, and
    the account's name always sits beside the disc, so no colour carries meaning
    on its own. */

const AVATAR_TINT_COUNT = 6

/** The first two alphanumeric characters of a display name, uppercased.
    `kodama_jpg` reads `KO`, `nebula.wav` reads `NE`, `_x` reads `X`. Falls back
    to `?` when a name carries no alphanumeric character at all, so the disc is
    never blank. */
export function avatarFallbackLabel(displayName: string): string {
  const characters = [...displayName].filter((character) => /[\p{L}\p{N}]/u.test(character))
  if (characters.length === 0) return '?'
  return [...characters.slice(0, 2).join('').toUpperCase()].slice(0, 2).join('')
}

/** A stable 1-based tint index for an account. Keyed on the opaque account id
    rather than the display name, so a Discord rename does not recolour a person
    mid-session. */
export function avatarTintIndex(accountKey: string): number {
  let hash = 0
  for (let index = 0; index < accountKey.length; index += 1) {
    // Same 31-multiplier walk as a string hash; the modulo keeps it in range
    // without needing the full 32-bit value.
    hash = (hash * 31 + accountKey.charCodeAt(index)) % 100_000_007
  }
  return (hash % AVATAR_TINT_COUNT) + 1
}
