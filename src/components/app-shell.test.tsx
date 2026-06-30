// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AppShell } from './app-shell'

const authState = vi.hoisted(() => ({
  session: null as null | {
    user: { name?: string | null; email?: string | null; image?: string | null }
  },
  signInSocial: vi.fn(),
}))

vi.mock('#/lib/auth-client', () => ({
  authClient: {
    signIn: {
      social: authState.signInSocial,
    },
    useSession: () => ({ data: authState.session }),
  },
}))

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
  authState.session = null
  authState.signInSocial.mockReset()
})

describe('AppShell', () => {
  test('renders rail navigation and page content', () => {
    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    expect(screen.getByLabelText('BhayanakCast home').textContent).toContain(
      'bhayanak::cast',
    )
    expect(screen.getByLabelText('Current user profile')).toBeTruthy()
    expect(screen.queryByLabelText('New room')).toBeNull()
    expect(screen.getByRole('main').textContent).toContain('Active Rooms')
  })

  test('sends anonymous profile clicks to Discord sign-in', () => {
    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    fireEvent.click(screen.getByLabelText('Current user profile'))

    expect(authState.signInSocial).toHaveBeenCalledWith({
      provider: 'discord',
      callbackURL: '/',
    })
    expect(screen.queryByText('my profile')).toBeNull()
  })

  test('sidebar create room button requests the create modal', () => {
    const onCreateRoom = vi.fn()
    window.addEventListener('bhayanakcast:create-room', onCreateRoom)

    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    fireEvent.click(screen.getByLabelText('Create room'))

    expect(onCreateRoom).toHaveBeenCalledTimes(1)
    window.removeEventListener('bhayanakcast:create-room', onCreateRoom)
  })

  test('hides admin rail link by default', () => {
    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    expect(screen.queryByLabelText('Admin dashboard')).toBeNull()
  })

  test('marks the active rail item and renders design rail controls', () => {
    window.history.pushState({}, '', '/admin')

    render(
      <AppShell showAdminLink>
        <h1>Admin</h1>
      </AppShell>,
    )

    expect(
      screen.getByLabelText('Admin dashboard').getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByLabelText('Connected Users').textContent).toContain('0')
    expect(screen.getByLabelText('Toggle theme')).toBeTruthy()
  })

  test('uses logged-in user details in the profile button and popout', () => {
    authState.session = {
      user: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        image: 'https://example.com/ada.png',
      },
    }

    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    fireEvent.click(screen.getByLabelText('Current user profile'))

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'Ada Lovelace' })).toHaveLength(2)
  })

  test('renders one divider between profile link and sign out', () => {
    authState.session = { user: { name: 'Ada Lovelace' } }

    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    fireEvent.click(screen.getByLabelText('Current user profile'))

    const menu = screen.getByText('sign out').closest('div')
    expect(
      Array.from(menu?.children ?? []).filter(
        (child) =>
          child.tagName === 'DIV' &&
          child.className.toString().includes('border-t'),
      ),
    ).toHaveLength(1)
  })

  test('omits bottom shortcuts and profile popout clutter', () => {
    render(
      <AppShell>
        <h1>Active Rooms</h1>
      </AppShell>,
    )

    expect(screen.queryByLabelText('New room')).toBeNull()
    expect(screen.queryByLabelText('Quick actions')).toBeNull()

    fireEvent.click(screen.getByLabelText('Current user profile'))

    expect(screen.queryByText('my rooms')).toBeNull()
    expect(screen.queryByText('notifications')).toBeNull()
    expect(screen.queryByText('settings')).toBeNull()
    expect(screen.queryByText('preview empty state')).toBeNull()
  })
})
