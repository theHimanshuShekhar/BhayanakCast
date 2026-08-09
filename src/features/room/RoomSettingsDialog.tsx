import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  clearRoomBan,
  roomBansQueryOptions,
  updateRoomSettings,
} from './room-queries'
import type { RoomAdmitted } from './room-types'
import { observeRoom } from './room-observability'

type SettingsTab = 'metadata' | 'privacy' | 'bans'

/** Host Settings. Metadata and Privacy edit the room the Host already owns;
    Bans is the only place a cleared ban can be undone. */
export function RoomSettingsDialog({
  room,
  open,
  onClose,
}: Readonly<{ room: RoomAdmitted; open: boolean; onClose: () => void }>) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<SettingsTab>('metadata')
  const [name, setName] = useState(room.name)
  const [category, setCategory] = useState(room.category ?? '')
  const [description, setDescription] = useState(room.description ?? '')
  const [tags, setTags] = useState(room.tags.join(', '))
  const [visibility, setVisibility] = useState(room.visibility)
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clearingAccountId, setClearingAccountId] = useState<string | null>(null)
  const [banError, setBanError] = useState<string | null>(null)
  const bans = useQuery({ ...roomBansQueryOptions(room.id), enabled: open && tab === 'bans' })
  // Capture phase, so the modal answers Escape before the Details sheet or a
  // companion sheet underneath it does. Without this, Escape over the dialog
  // dismisses an invisible surface behind the scrim and moves focus there.
  useEffect(() => {
    if (!open) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', dismissOnEscape, true)
    return () => document.removeEventListener('keydown', dismissOnEscape, true)
  }, [onClose, open])

  if (!open) return null

  return (
    <div aria-labelledby="room-settings-title" aria-modal="true" className="room-dialog" role="dialog">
      <div className="room-dialog__panel">
        <h2 id="room-settings-title">Room settings</h2>
        <div className="room-dialog__tabs" role="tablist">
          {(['metadata', 'privacy', 'bans'] as const).map((value) => (
            <button
              aria-selected={tab === value}
              key={value}
              role="tab"
              type="button"
              onClick={() => setTab(value)}
            >
              {value === 'metadata' ? 'Metadata' : value === 'privacy' ? 'Privacy' : 'Bans'}
            </button>
          ))}
        </div>

        {tab === 'bans' ? (
          <div aria-live="polite">
            <p className="room-dialog__ban-guidance">
              Clearing a Room Ban lets that person use the normal Join flow again.
            </p>
            {bans.isPending && <p>Loading Room Bans…</p>}
            {(bans.isError || bans.data === null || banError) && (
              <p className="form-error" role="alert">
                {banError ?? 'Room Bans could not be loaded. Try again.'}
              </p>
            )}
            {bans.isSuccess && Array.isArray(bans.data) && (
              <ul className="room-dialog__bans">
                {bans.data.length === 0 && <li>No one is banned from this room.</li>}
                {bans.data.map((ban) => (
                  <li key={ban.accountId}>
                    <span>
                      <strong>{ban.displayName}</strong>
                      <small>Banned from this room</small>
                    </span>
                    <button
                      aria-label={`Clear Room Ban for ${ban.displayName}`}
                      aria-busy={clearingAccountId === ban.accountId}
                      disabled={clearingAccountId !== null}
                      type="button"
                      onClick={() => void clear(ban.accountId)}
                    >
                      {clearingAccountId === ban.accountId ? 'Clearing…' : 'Clear ban'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {tab === 'metadata' && (
              <>
                <label htmlFor="settings-name">Name</label>
                <input
                  id="settings-name"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />

                <label htmlFor="settings-category">Category</label>
                <input
                  id="settings-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />

                <label htmlFor="settings-description">Description</label>
                <input
                  id="settings-description"
                  maxLength={140}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />

                <label htmlFor="settings-tags">Tags</label>
                <input
                  id="settings-tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </>
            )}

            {tab === 'privacy' && (
              <>
                <label htmlFor="settings-visibility">Visibility</label>
                <select
                  id="settings-visibility"
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as typeof visibility)
                  }
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>

                {visibility === 'private' && (
                  <>
                    <label htmlFor="settings-password">
                      Password {room.visibility === 'private' ? '(leave blank to keep)' : ''}
                    </label>
                    <input
                      id="settings-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </>
                )}
              </>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="room-dialog__actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button aria-busy={pending} disabled={pending} type="submit">
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {tab === 'bans' && (
          <div className="room-dialog__actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )

  async function save() {
    setPending(true)
    setError(null)
    const result = await updateRoomSettings({
      data: {
        roomId: room.id,
        input: {
          name,
          category: category || null,
          description: description || null,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          visibility,
          password: visibility === 'private' && password ? password : null,
        },
      },
    }).catch(() => null)
    setPending(false)
    if (result?.status === 'updated') {
      onClose()
      return
    }
    setError(
      result?.status === 'password-required'
        ? 'A private room needs a password.'
        : result?.status === 'ended'
          ? 'This room has ended.'
          : 'Those settings could not be saved.',
    )
  }

  async function clear(accountId: string) {
    if (clearingAccountId) return
    setClearingAccountId(accountId)
    setBanError(null)
    observeRoom({ name: 'room_ban_clear_requested', properties: {} })
    const result = await clearRoomBan({
      data: { roomId: room.id, accountId },
    }).catch(() => null)
    if (result?.status === 'cleared') {
      await queryClient.invalidateQueries({
        queryKey: roomBansQueryOptions(room.id).queryKey,
      })
    } else {
      setBanError(
        result?.status === 'ended'
          ? 'This room has ended.'
          : 'That Room Ban could not be cleared. Try again.',
      )
    }
    setClearingAccountId(null)
  }
}
