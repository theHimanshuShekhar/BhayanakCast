import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { publicProfileQueryKeys } from '../public-profile/public-profile-queries'
import {
  cancelAccountDeletion,
  chatMutesQueryKey,
  deletionRequestMutationKey,
  deletionRequestQueryKey,
  deletionRequestQueryOptions,
  submitAccountDeletion,
  themePreferenceQueryKey,
} from './profile-queries'
import type { DeletionRequest } from '../../server/profile/deletion-service'
import { DeletionConfirmation } from './DeletionConfirmation'

export function AccountDeletion() {
  const queryClient = useQueryClient()
  const deletionQuery = useQuery(deletionRequestQueryOptions())
  const router = useRouter()
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const submitMutation = useMutation({
    mutationKey: deletionRequestMutationKey,
    mutationFn: submitAccountDeletion,
    onSuccess: (request: DeletionRequest) => {
      queryClient.setQueryData(deletionRequestQueryKey, request)
      void Promise.all([
        router.invalidate(),
        queryClient.invalidateQueries({
          queryKey: publicProfileQueryKeys.detail(request.accountId),
        }),
        queryClient.invalidateQueries({ queryKey: ['home'] }),
      ])
      setConfirmationOpen(false)
      triggerRef.current?.focus()
    },
  })
  const cancelMutation = useMutation({
    mutationKey: deletionRequestMutationKey,
    mutationFn: cancelAccountDeletion,
    onSuccess: (request) => {
      queryClient.setQueryData(deletionRequestQueryKey, request)
      void Promise.all([
        router.invalidate(),
        queryClient.invalidateQueries({ queryKey: ['public-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['home'] }),
      ])
    },
  })

  const request = deletionQuery.data
  const isPending = request?.status === 'pending'
  const isApproved = request?.status === 'approved'
  const accountId = request && 'accountId' in request ? request.accountId : undefined
  const previousStatus = useRef(request?.status)
  useEffect(() => {
    const status = request?.status
    if (
      previousStatus.current === 'pending' &&
      accountId &&
      status !== undefined &&
      status !== 'pending'
    ) {
      void Promise.all([
        router.invalidate(),
        queryClient.invalidateQueries({ queryKey: publicProfileQueryKeys.detail(accountId) }),
        queryClient.invalidateQueries({ queryKey: ['public-profile'] }),
        queryClient.invalidateQueries({ queryKey: ['home'] }),
        queryClient.invalidateQueries({ queryKey: themePreferenceQueryKey }),
        queryClient.invalidateQueries({ queryKey: chatMutesQueryKey }),
      ])
    }
    previousStatus.current = status
  }, [accountId, chatMutesQueryKey, queryClient, request?.status, router, themePreferenceQueryKey])

  return (
    <section aria-labelledby="account-deletion-heading" className="profile-preference">
      <h2 id="account-deletion-heading">Account deletion</h2>
      {isPending ? (
        <>
          <p role="status">
            Deletion request pending. Your public activity is hidden and your account is
            read-only until this request is cancelled or reviewed.
          </p>
          <button
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? 'Cancelling request…' : 'Cancel deletion request'}
          </button>
        </>
      ) : isApproved ? (
        <p role="status">Deletion approved. This account can no longer be restored.</p>
      ) : (
        <>
          <p>Request deletion when you no longer want to use this account.</p>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setConfirmationOpen(true)}
            disabled={submitMutation.isPending}
          >
            Request account deletion
          </button>
          {request?.status === 'cancelled' || request?.status === 'rejected' ? (
            <p role="status">Your account is active again.</p>
          ) : null}
        </>
      )}
      <DeletionConfirmation
        open={confirmationOpen}
        busy={submitMutation.isPending}
        error={submitMutation.error ? 'Unable to submit this request.' : undefined}
        onCancel={() => {
          setConfirmationOpen(false)
          triggerRef.current?.focus()
        }}
        onConfirm={() => submitMutation.mutate()}
      />
      {cancelMutation.error ? <p role="alert">Unable to cancel this request.</p> : null}
    </section>
  )
}
