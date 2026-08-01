import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { SessionProjection } from '../auth/auth-client'
import { authClient } from '../auth/auth-client'
import { safeOAuthCallbackPath } from '../auth/SignInButton'
import {
  CREATE_ROOM_EVENT,
  type CreateRoomControlState,
  type CreateRoomEventDetail,
} from './HomeNavigation'
import { createRoom, validateCreateRoomInput } from './create-room'
import { observeHome } from './home-observability'
import type { MembershipConfirmation } from '../../server/rooms/room-service'
import { MembershipConsequencesDialog } from '../room/MembershipConsequencesDialog'

interface CreateRoomDialogProps {
  readonly session: SessionProjection | null
}

type Visibility = 'public' | 'private'

export function CreateRoomDialog({ session }: CreateRoomDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [oauthPending, setOauthPending] = useState(false)
  const [oauthError, setOauthError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<MembershipConfirmation | null>(null)
  const close = () => {
    if (dialogRef.current?.open) dialogRef.current.close()
    setConfirmation(null)
    setError(null)
    returnFocusRef.current?.focus()
  }

  const open = () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(null)
    setOauthError(null)
    setConfirmation(null)
    setName('')
    setCategory('')
    setDescription('')
    setTags('')
    setVisibility('public')
    setPassword('')
    dialog.showModal()
    firstFieldRef.current?.focus()
  }
  const beginAnonymousCreate = async (
    setControlState?: (state: CreateRoomControlState) => void,
  ) => {
    if (oauthPending) return
    const opening: CreateRoomControlState = { pending: true, error: null }
    setOauthPending(true)
    setOauthError(null)
    setControlState?.(opening)
    try {
      observeHome({
        name: 'home_discord_sign_in_started',
        properties: { intent: 'create' },
      })
      const result = await authClient.signIn.social({
        provider: 'discord',
        callbackURL: safeOAuthCallbackPath('/?intent=create'),
      })
      if (result.error) {
        const message = result.error.message || 'Unable to open Discord sign-in'
        setOauthError(message)
        setControlState?.({ pending: false, error: message })
      }
    } catch {
      const message = 'Unable to open Discord sign-in'
      setOauthError(message)
      setControlState?.({ pending: false, error: message })
    } finally {
      setOauthPending(false)
    }
  }

  useEffect(() => {
    const activate = (event: Event) => {
      const detail = (event as CustomEvent<CreateRoomEventDetail>).detail
      if (session) {
        detail?.setState({ pending: false, error: null })
        open()
      } else {
        void beginAnonymousCreate(detail?.setState)
      }
    }
    window.addEventListener(CREATE_ROOM_EVENT, activate)
    return () => window.removeEventListener(CREATE_ROOM_EVENT, activate)
  }, [session])

  useEffect(() => {
    if (!session || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('intent') !== 'create') return
    params.delete('intent')
    const query = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    open()
  }, [session])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      )]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const input = validateCreateRoomInput({
        name,
        category: category || undefined,
        description: description || undefined,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibility,
        password: visibility === 'private' ? password : undefined,
      })
      observeHome({
        name: 'home_create_submitted',
        properties: {
          visibility: input.visibility,
          category_selected: Boolean(input.category),
          tag_count: input.tags.length,
        },
      })
      const result = await createRoom({ data: { input } })
      if (result.status === 'confirmation-required') {
        setConfirmation(result.confirmation)
      } else if (result.status === 'created') {
        observeHome({
          name: 'home_create_succeeded',
          properties: {
            visibility: input.visibility,
            category_selected: Boolean(input.category),
            tag_count: input.tags.length,
          },
        })
        window.location.assign(`/rooms/${encodeURIComponent(result.room.id)}`)
        return
      } else {
        setError(createRoomError(result.status))
      }
    } catch (caught) {
      setError(caught instanceof Error ? createInputError(caught.message) : 'Unable to create room')
    } finally {
      setPending(false)
    }
  }

  const confirmCreate = async (token: MembershipConfirmation) => {
    setPending(true)
    setError(null)
    try {
      const input = validateCreateRoomInput({
        name,
        category: category || undefined,
        description: description || undefined,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        visibility,
        password: visibility === 'private' ? password : undefined,
      })
      observeHome({
        name: 'home_create_submitted',
        properties: {
          visibility: input.visibility,
          category_selected: Boolean(input.category),
          tag_count: input.tags.length,
        },
      })
      const result = await createRoom({ data: { input, confirmation: token } })
      if (result.status === 'created') {
        observeHome({
          name: 'home_create_succeeded',
          properties: {
            visibility: input.visibility,
            category_selected: Boolean(input.category),
            tag_count: input.tags.length,
          },
        })
        window.location.assign(`/rooms/${encodeURIComponent(result.room.id)}`)
        return
      }
      if (result.status === 'confirmation-required') {
        setConfirmation(result.confirmation)
      } else {
        setConfirmation(null)
        setError(createRoomError(result.status))
      }
    } catch (caught) {
      setConfirmation(null)
      setError(caught instanceof Error ? createInputError(caught.message) : 'Unable to create room')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {(oauthPending || oauthError) && (
        <p className="form-error" role="alert" aria-live="polite">
          {oauthPending ? 'Opening Discord…' : oauthError}
        </p>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby="create-room-title"
        className="create-room-dialog"
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <form className="create-room-dialog__panel" noValidate onSubmit={submit}>
          <h2 id="create-room-title">Create Room</h2>
          <p>Set the canonical room details before you invite people.</p>
          <label>
            Name
            <input
              ref={firstFieldRef}
              aria-describedby={error ? 'create-room-error' : undefined}
              aria-invalid={Boolean(error)}
              maxLength={80}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Category <span className="form-hint">Optional</span>
            <input maxLength={32} value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
          <label>
            Description <span className="form-hint">Optional, up to 140 characters</span>
            <input
              maxLength={140}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label>
            Tags <span className="form-hint">Optional, comma separated</span>
            <input maxLength={128} value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <fieldset>
            <legend>Visibility</legend>
            <label><input checked={visibility === 'public'} name="visibility" type="radio" onChange={() => setVisibility('public')} /> Public</label>
            <label><input checked={visibility === 'private'} name="visibility" type="radio" onChange={() => setVisibility('private')} /> Private</label>
          </fieldset>
          {visibility === 'private' && (
            <label>
              Password <span className="form-hint">At least 8 characters</span>
              <input
                autoComplete="new-password"
                minLength={8}
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {error && <p ref={errorRef} tabIndex={-1} id="create-room-error" className="form-error" role="alert">{error}</p>}
          <div className="create-room-dialog__actions">
            <button disabled={pending} type="button" onClick={close}>Cancel</button>
            <button aria-busy={pending} disabled={pending} type="submit">{pending ? 'Creating…' : 'Create Room'}</button>
          </div>
        </form>
      </dialog>
      <MembershipConsequencesDialog
        confirmation={confirmation}
        open={Boolean(confirmation)}
        pending={pending}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmCreate}
      />
    </>
  )
}

function createInputError(code: string) {
  const labels: Record<string, string> = {
    ROOM_NAME_LENGTH: 'Name must be between 3 and 80 characters.',
    ROOM_CATEGORY_LENGTH: 'Category must be at most 32 characters.',
    ROOM_DESCRIPTION_LENGTH: 'Description must be at most 140 characters.',
    ROOM_TAG_COUNT: 'Use no more than 5 tags.',
    ROOM_TAG_LENGTH: 'Each tag must be at most 24 characters.',
    ROOM_PASSWORD_LENGTH: 'Private passwords must be at least 8 characters.',
  }
  return labels[code] ?? 'Check the room details and try again.'
}

function createRoomError(status: string) {
  const labels: Record<string, string> = {
    unauthenticated: 'Sign in with Discord before creating a room.',
    'account-read-only': 'This account cannot create rooms right now.',
    'room-creation-sanctioned': 'This account cannot create rooms right now.',
    'all-access-sanctioned': 'This account cannot create rooms right now.',
    'rate-limited': 'Room creation is temporarily rate limited.',
    'rate-limit-unavailable': 'Room creation is temporarily unavailable.',
  }
  return labels[status] ?? 'Unable to create room.'
}
