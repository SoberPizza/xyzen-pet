/**
 * REST helpers for chatting with builtin voice agents (`builtin_ceo`, `builtin_buddy`).
 *
 * The active agent id is passed in by the caller. Streamed output arrives
 * asynchronously over the shared buddy WebSocket bridge regardless of which
 * agent produced it — these helpers only resolve sessions/topics and post
 * user messages.
 */

import type { HttpClient } from './http'

import { HttpError } from './http'

interface TopicRead {
  id: string
  name: string
  session_id: string
}

interface RootAgentResponse {
  agent: { id: string }
  root_agent_id: string
}

/**
 * Returns the current user's root (CEO) agent id.
 *
 * Buddy must target the same per-user root agent the main web UI uses —
 * hardcoding `builtin_ceo` resolves to the system-level CEO agent, not the
 * user's actual root, which causes Buddy-originated topics to appear under a
 * stranger agent in the main UI (missing model/tool selectors, etc.).
 */
export async function fetchRootAgentId(http: HttpClient): Promise<string> {
  const res = await http.get<RootAgentResponse>('/root-agent/')
  return res.agent.id
}

interface SessionWithTopics {
  id: string
  name: string
  topics: TopicRead[]
}

interface SessionCreateRequest {
  name: string
  agent_id: string
}

interface SendMessageResponseRaw {
  message_id: string
  stream_id: string
  created_at?: string
}

export interface AgentChatHandle {
  topicId: string
  sessionId: string
}

export interface SendCeoMessageResponse {
  messageId: string
  streamId: string
}

export interface BuddyContext {
  description: string | null
  traits: string[]
}

async function fetchAgentSession(http: HttpClient, agentId: string): Promise<SessionWithTopics | null> {
  try {
    return await http.get<SessionWithTopics>(`/sessions/by-agent/${agentId}`)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
}

async function createAgentSession(http: HttpClient, agentId: string, name: string): Promise<SessionWithTopics> {
  const body: SessionCreateRequest = { name, agent_id: agentId }
  await http.post<unknown>('/sessions', body)
  const created = await fetchAgentSession(http, agentId)
  if (!created) {
    throw new Error('Session was created but could not be fetched.')
  }
  return created
}

export async function resolveAgentTopic(http: HttpClient, agentId: string): Promise<AgentChatHandle> {
  const session = (await fetchAgentSession(http, agentId)) ?? (await createAgentSession(http, agentId, 'Buddy Voice'))
  const topic = session.topics[0]
  if (!topic) {
    throw new Error(`Session for agent ${agentId} has no topic to post messages to.`)
  }
  return { topicId: topic.id, sessionId: session.id }
}

export async function resolveAgentSession(http: HttpClient, agentId: string): Promise<SessionWithTopics> {
  return (await fetchAgentSession(http, agentId)) ?? (await createAgentSession(http, agentId, 'Buddy Voice'))
}

interface GetOrCreateRecentTopicRequest {
  session_id: string
  name: string
  since: string
}

/**
 * Get-or-create the most recent user-visible topic named *name* in *sessionId*
 * created on or after *since*. Races across tabs are serialized server-side
 * via an advisory lock, so two concurrent callers return the same topic.
 */
export async function getOrCreateRecentTopic(
  http: HttpClient,
  sessionId: string,
  name: string,
  since: Date,
): Promise<TopicRead> {
  const body: GetOrCreateRecentTopicRequest = {
    session_id: sessionId,
    name,
    since: since.toISOString(),
  }
  return http.post<TopicRead>('/topics/get-or-create-recent', body)
}

export async function sendCeoMessage(
  http: HttpClient,
  topicId: string,
  message: string,
  buddyContext?: BuddyContext,
): Promise<SendCeoMessageResponse> {
  const body: Record<string, unknown> = { message, source: 'buddy' }
  if (buddyContext) body.context = { buddy: buddyContext }
  const res = await http.post<SendMessageResponseRaw>(
    `/topics/${topicId}/messages`,
    body,
  )
  return { messageId: res.message_id, streamId: res.stream_id }
}
