import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  chatMuteMutationKey,
  chatMutesQueryKey,
  chatMutesQueryOptions,
  type ChatMutesData,
  unmuteChatAccount,
} from './profile-queries'

export function MutedAccounts() {
  const queryClient = useQueryClient()
  const [announcement, setAnnouncement] = useState('')
  const unmuteNames = useRef(new Map<string, string>())
  const mutesQuery = useQuery(chatMutesQueryOptions())
  const unmuteMutation = useMutation({
    mutationKey: chatMuteMutationKey,
    mutationFn: unmuteChatAccount,
    onMutate: (accountId) => {
      document.getElementById('muted-accounts-heading')?.focus()
      const previous = queryClient.getQueryData<ChatMutesData>(chatMutesQueryKey)
      queryClient.setQueryData<ChatMutesData>(chatMutesQueryKey, (current) =>
        current
          ? { ...current, mutes: current.mutes.filter((mute) => mute.accountId !== accountId) }
          : current,
      )
      return { previous }
    },
    onError: (_error, _accountId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(chatMutesQueryKey, context.previous)
      }
    },
    onSuccess: (_data, accountId) => {
      const displayName = unmuteNames.current.get(accountId) ?? 'Account'
      setAnnouncement(`Unmuted ${displayName}.`)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chatMutesQueryKey, exact: true })
    },
  })

  if (mutesQuery.isPending) {
    return (
      <section aria-labelledby="muted-accounts-heading" className="profile-muted-accounts">
        <h2 id="muted-accounts-heading" tabIndex={-1}>Muted accounts</h2>
        <p>Loading muted accounts.</p>
      </section>
    )
  }
  if (mutesQuery.isError) {
    return (
      <section aria-labelledby="muted-accounts-heading" className="profile-muted-accounts">
        <h2 id="muted-accounts-heading" tabIndex={-1}>Muted accounts</h2>
        <p role="alert">Muted accounts could not be loaded. Try again.</p>
      </section>
    )
  }
  if (!mutesQuery.data.authenticated) return null

  return (
    <section aria-labelledby="muted-accounts-heading" className="profile-muted-accounts">
      <h2 id="muted-accounts-heading" tabIndex={-1}>Muted accounts</h2>
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
      <p>Muted accounts stay hidden from your future chat presentation.</p>
      {unmuteMutation.isError && (
        <p role="alert">That account could not be unmuted. Try again.</p>
      )}
      {mutesQuery.data.mutes.length === 0 ? (
        <p>No accounts are muted.</p>
      ) : (
        <ul className="profile-muted-accounts__list">
          {mutesQuery.data.mutes.map((account) => (
            <li key={account.accountId} className="profile-muted-accounts__item">
              <div className="profile-muted-accounts__identity">
                {account.avatarUrl ? (
                  <img alt="" height="48" src={account.avatarUrl} width="48" />
                ) : (
                  <span aria-hidden="true" className="profile-muted-accounts__avatar-fallback">
                    {account.displayName.slice(0, 1).toLocaleUpperCase()}
                  </span>
                )}
                <span>{account.displayName}</span>
              </div>
              <button
                aria-label={`Unmute ${account.displayName}`}
                disabled={unmuteMutation.isPending}
                type="button"
                onClick={() => {
                  unmuteNames.current.set(account.accountId, account.displayName)
                  unmuteMutation.mutate(account.accountId)
                }}
              >
                {unmuteMutation.isPending ? 'Unmuting…' : 'Unmute'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
