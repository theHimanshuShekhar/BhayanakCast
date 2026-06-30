import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('prototype design tokens', () => {
  test('ports the core prototype tokens into app styles', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

    for (const token of [
      '--color-primary:',
      '--color-live:',
      '--color-bg:',
      '--color-canvas:',
      '--color-surface:',
      "--font-mono: 'JetBrains Mono'",
      '--shadow-glow:',
      '--radius-lg:',
    ]) {
      expect(css).toContain(token)
    }
  })

  test('uses dense mono typography for the app body', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

    expect(css).toContain('--font-sans: var(--font-mono);')
    expect(css).toContain('font-family: var(--font-mono);')
    expect(css).toContain('font-size: var(--app-body-size);')
    expect(css).toContain('letter-spacing: 0.01em;')
  })

  test('disables nonessential motion for reduced-motion users', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-duration: 0.001ms !important;')
    expect(css).toContain('transition-duration: 0.001ms !important;')
    expect(css).toContain('scroll-behavior: auto !important;')
  })

  test('defines prototype motion primitives', () => {
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

    for (const primitive of [
      '.motion-live-pulse',
      '.motion-rail-glow',
      '.motion-wave-bar',
      '.motion-reaction-float',
      '.motion-tile-state',
      '.motion-pop',
    ]) {
      expect(css).toContain(primitive)
    }
  })
})
