import { atom, computed, onStop, type ReadableAtom } from 'nanostores'

/**
 * Which surface is showing a session's pending approval.
 *
 * By default it is the transcript's PendingApprovalStack. A live tool card
 * claims it while the approval belongs to its run, so the decision renders
 * inside the card and the stack steps aside instead of asking twice. The claim
 * is released on unmount, so a card scrolled out of the virtualized list hands
 * the decision straight back to the stack.
 */
const $inlineApprovalHosts = atom<Record<string, string>>({})
const hostedCache = new Map<string, ReadableAtom<boolean>>()

export function claimInlineApproval(sessionId: string, hostKey: string): () => void {
  if ($inlineApprovalHosts.get()[sessionId] !== hostKey) {
    $inlineApprovalHosts.set({ ...$inlineApprovalHosts.get(), [sessionId]: hostKey })
  }

  return () => {
    const current = $inlineApprovalHosts.get()

    if (current[sessionId] === hostKey) {
      const next = { ...current }
      delete next[sessionId]
      $inlineApprovalHosts.set(next)
    }
  }
}

export function $approvalHostedInline(sessionId: null | string): ReadableAtom<boolean> {
  const key = sessionId ?? ''
  let cached = hostedCache.get(key)

  if (!cached) {
    cached = computed($inlineApprovalHosts, hosts => Boolean(key && hosts[key]))
    onStop(cached, () => {
      if (hostedCache.get(key) === cached) {
        hostedCache.delete(key)
      }
    })
    hostedCache.set(key, cached)
  }

  return cached
}
