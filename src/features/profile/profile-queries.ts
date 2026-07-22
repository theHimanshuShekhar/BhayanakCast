import { queryOptions } from '@tanstack/react-query'
import {
  getChatMutes,
  muteAccount,
  unmuteAccount,
  type MutedAccount,
} from '../../server/profile/chat-mute-service'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference as ThemePreferenceData,
  type ThemeOverride as ThemeOverrideData,
} from '../../server/profile/preference-service'
import {
  cancelDeletionRequest,
  getDeletionRequest,
  submitDeletionRequest,
  type DeletionCommandResult,
  type DeletionRequest,
} from '../../server/profile/deletion-service'

export const themePreferenceQueryKey = ['profile', 'theme-preference'] as const
export const themePreferenceMutationKey = themePreferenceQueryKey

export function themePreferenceQueryOptions() {
  return queryOptions<ThemePreferenceData>({
    queryKey: themePreferenceQueryKey,
    queryFn: ({ signal }) => getThemePreference({ signal }),
  })
}

export function updateThemePreference(theme: ThemeOverrideData) {
  return setThemePreference({ data: { theme } })
}

export const chatMutesQueryKey = ['profile', 'chat-mutes'] as const
export const chatMuteMutationKey = ['profile', 'chat-mute'] as const

export interface ChatMutesData {
  readonly authenticated: boolean
  readonly mutes: readonly MutedAccount[]
}

export function chatMutesQueryOptions() {
  return queryOptions<ChatMutesData>({
    queryKey: chatMutesQueryKey,
    queryFn: ({ signal }) => getChatMutes({ signal }),
  })
}

export function muteChatAccount(accountId: string) {
  return muteAccount({ data: { accountId } })
}

export function unmuteChatAccount(accountId: string) {
  return unmuteAccount({ data: { accountId } })
}
export const deletionRequestQueryKey = ['profile', 'deletion-request'] as const
export const deletionRequestMutationKey = deletionRequestQueryKey

export function deletionRequestQueryOptions() {
  return queryOptions<DeletionCommandResult>({
    queryKey: deletionRequestQueryKey,
    queryFn: ({ signal }) => getDeletionRequest({ signal }),
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 5_000 : false),
  })
}

export function submitAccountDeletion() {
  return submitDeletionRequest()
}

export function cancelAccountDeletion() {
  return cancelDeletionRequest()
}

export type DeletionRequestData = DeletionRequest
