// Changing the top-level reasoning effort invalidates the provider prompt cache. Protocols with a native
// per-message update keep it frozen and lower `Message.effort(...)` markers instead; other routes strip them.
import { type LLMRequest, type EffortPart, Message } from "./schema/messages.js"

export const effortUpdate = (message: Message): EffortPart | undefined => {
  if (message.role !== "system" || message.content.length !== 1) return undefined
  const part = message.content[0]
  return part.type === "effort" ? part : undefined
}

export const stripEffortUpdates = (request: LLMRequest) => {
  const messages = request.messages.filter((message) => effortUpdate(message) === undefined)
  return messages.length === request.messages.length ? request : { ...request, messages }
}

export const applyEffortUpdates = (request: LLMRequest): LLMRequest =>
  request.model.route.supportsEffortUpdates?.(request) ? request : stripEffortUpdates(request)

// Reverted or forked history can leave the last marker disagreeing with the requested effort.
export const resolveEffortUpdates = (request: LLMRequest, current: string | undefined) => {
  const updates = request.messages.flatMap((message) => effortUpdate(message) ?? [])
  if (updates.length === 0) return { request, effort: current }
  if (updates.at(-1)?.effort !== current) return { request: stripEffortUpdates(request), effort: current }
  return { request, effort: updates[0]?.previous }
}

// A variant that turns reasoning off ("none" on Claude) is recorded as a switch to that effort, but its requests strip
// every marker and the protocol has no such effort. Fold each stretch through such a value into one switch from the
// effort before it to the effort after it, so the request after the stretch repeats the history before it.
export const foldEffortUpdates = (request: LLMRequest, valid: (effort: string) => boolean): LLMRequest => {
  const accepted = (effort: string | undefined) => effort === undefined || valid(effort)
  const updates = request.messages.flatMap((message) => effortUpdate(message) ?? [])
  if (updates.every((update) => accepted(update.effort) && accepted(update.previous))) return request
  let before: EffortPart["previous"]
  const messages = request.messages.flatMap((message) => {
    const update = effortUpdate(message)
    if (update === undefined) return [message]
    if (!accepted(update.effort)) {
      if (accepted(update.previous)) before = update.previous
      return []
    }
    if (accepted(update.previous)) return [message]
    return update.effort === before ? [] : [Message.effort({ effort: update.effort, previous: before })]
  })
  return { ...request, messages }
}
