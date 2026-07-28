import { accountState, platformSanction } from './accounts'
import { authSchema } from './auth'
import { roomBan, roomMembership } from './memberships'
import { room } from './rooms'
import { stream } from './streams'
import { streamSubscription } from './subscriptions'

import { accountPreference } from './preferences'
import { chatMute } from './chat-mutes'
import { message } from './messages'
import { report } from './reports'
import { deletionRequest, deletionRequestAudit } from './deletion-requests'
export const databaseSchema = {
  ...authSchema,
  accountState,
  platformSanction,
  room,
  roomMembership,
  roomBan,
  stream,
  streamSubscription,
  accountPreference,
  chatMute,
  message,
  report,
  deletionRequest,
  deletionRequestAudit,
}
