import { accountState, anonymizedSubject, platformSanction } from './accounts'
import { authSchema } from './auth'
import { roomBan, roomMembership } from './memberships'
import { room } from './rooms'
import { stream } from './streams'
import { streamSubscription } from './subscriptions'

import { accountPreference } from './preferences'
import { chatMute } from './chat-mutes'
import { message } from './messages'
import { report, reportAudit } from './reports'
import { deletionRequest, deletionRequestAudit } from './deletion-requests'
import { retentionRunAudit } from './retention'
export const databaseSchema = {
  ...authSchema,
  accountState,
  anonymizedSubject,
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
  reportAudit,
  deletionRequest,
  deletionRequestAudit,
  retentionRunAudit,
}
