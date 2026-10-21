import { atom } from 'nanostores'

/**
 * HIGHLIGHT-TO-COMMENT for store-backed artifacts in the right panel.
 *
 * The artifact renders in a sandboxed, opaque-origin frame the app cannot
 * reach into, so a tiny bridge script is injected into its document. The
 * bridge reports text selections (quote + character offsets + on-screen rect)
 * to the parent with `postMessage`, tagged with a per-render nonce, and paints
 * the queued comments back as highlights (CSS Custom Highlight API) when the
 * parent asks. It never touches the network, storage or the parent's DOM.
 *
 * Queued comments live in memory per artifact until the user sends them all
 * as ONE message, so the agent applies them in a single pass and saves one
 * new version.
 */

export const ARTIFACT_BRIDGE_TAG = '__hermesArtifact'

export interface ArtifactSelectionRect {
  bottom: number
  left: number
  right: number
  top: number
}

export interface ArtifactSelection {
  end: number
  quote: string
  rect: ArtifactSelectionRect
  start: number
}

export interface PendingArtifactComment {
  end: number
  id: string
  note: string
  quote: string
  start: number
  /** Version the user was looking at when they wrote it. */
  version: number
}

export type ArtifactBridgeMessage =
  | { end: number; rect?: ArtifactSelectionRect; start: number; text: string; type: 'selection' }
  | { type: 'ready' }

/** Parse a frame message; null unless it carries this render's nonce and a known shape. */
export function readArtifactBridgeMessage(data: unknown, nonce: string): ArtifactBridgeMessage | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const record = data as Record<string, unknown>

  if (record[ARTIFACT_BRIDGE_TAG] !== nonce) {
    return null
  }

  if (record.type === 'ready') {
    return { type: 'ready' }
  }

  if (record.type !== 'selection' || typeof record.text !== 'string') {
    return null
  }

  const rect = record.rect as Record<string, unknown> | undefined
  const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

  return {
    end: typeof record.end === 'number' ? record.end : -1,
    rect: rect
      ? { bottom: finite(rect.bottom), left: finite(rect.left), right: finite(rect.right), top: finite(rect.top) }
      : undefined,
    start: typeof record.start === 'number' ? record.start : -1,
    text: record.text,
    type: 'selection'
  }
}

/** Collapse whitespace so a quote reads as one line in the tray and the prompt. */
export function tidyQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function newArtifactBridgeNonce(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)

  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The script injected into the artifact document. Plain ES2015, no globals
 * leaked (IIFE). Offsets are positions in the body's text as `Range#toString`
 * sees it, so the same numbers map back to a range for highlighting; when the
 * text at those offsets no longer matches (a newer version moved it) the
 * bridge falls back to finding the quote.
 */
export function artifactBridgeScript(nonce: string): string {
  const tag = JSON.stringify(ARTIFACT_BRIDGE_TAG)
  const n = JSON.stringify(nonce)

  return `(function(){
var TAG=${tag},NONCE=${n},P=window.parent,last='';
function root(){return document.body||document.documentElement}
function post(msg){msg[TAG]=NONCE;try{P.postMessage(msg,'*')}catch(e){}}
function abs(node,off){var r=document.createRange();try{r.setStart(root(),0);r.setEnd(node,off)}catch(e){return -1}return r.toString().length}
function fromOffsets(s,e){var w=document.createTreeWalker(root(),NodeFilter.SHOW_TEXT),acc=0,t,r=document.createRange(),got=false;
while((t=w.nextNode())){var len=t.data.length;if(!got&&s<=acc+len){r.setStart(t,s-acc);got=true}if(got&&e<=acc+len){r.setEnd(t,e-acc);return r}acc+=len}return null}
function find(q){var r=document.createRange();r.selectNodeContents(root());var i=r.toString().indexOf(q);return i<0?null:fromOffsets(i,i+q.length)}
function report(){var s=window.getSelection();
if(!s||s.rangeCount===0||s.isCollapsed||!s.toString().trim()){if(last){last='';post({type:'selection',text:''})}return}
var r=s.getRangeAt(0),text=r.toString(),b=r.getBoundingClientRect?r.getBoundingClientRect():null,start=abs(r.startContainer,r.startOffset);
last=text;post({type:'selection',text:text,start:start,end:start<0?-1:start+text.length,
rect:b?{left:b.left,top:b.top,right:b.right,bottom:b.bottom}:{left:0,top:0,right:0,bottom:0}})}
document.addEventListener('mouseup',function(){setTimeout(report,0)});
document.addEventListener('keyup',function(e){if(e.shiftKey||e.key==='Shift')setTimeout(report,0)});
window.addEventListener('scroll',function(){if(last)report()},true);
function paint(items){if(!window.CSS||!CSS.highlights||typeof Highlight==='undefined')return;
if(!document.getElementById('hermes-artifact-hl')){var st=document.createElement('style');st.id='hermes-artifact-hl';
st.textContent='::highlight(hermes-pending){background-color:rgba(255,191,0,.38);color:inherit}';(document.head||document.documentElement).appendChild(st)}
var ranges=[];for(var i=0;i<items.length;i++){var it=items[i]||{},r=null;
if(typeof it.start==='number'&&it.start>=0){r=fromOffsets(it.start,it.end);if(r&&r.toString()!==it.text)r=null}
if(!r&&it.text)r=find(it.text);if(r)ranges.push(r)}
if(ranges.length)CSS.highlights.set('hermes-pending',new Highlight(...ranges));else CSS.highlights.delete('hermes-pending')}
window.addEventListener('message',function(e){if(e.source!==P)return;var d=e.data;if(!d||d[TAG]!==NONCE)return;
if(d.type==='highlights')paint(d.items||[]);
else if(d.type==='clear-selection'){var s=window.getSelection();if(s)s.removeAllRanges();last=''}});
post({type:'ready'});
})();`
}

/** Put the bridge at the end of the document body (or the end of the document). */
export function withArtifactBridge(html: string, nonce: string): string {
  const script = `<script>${artifactBridgeScript(nonce)}</script>`
  const close = html.toLowerCase().lastIndexOf('</body>')

  return close < 0 ? `${html}${script}` : `${html.slice(0, close)}${script}${html.slice(close)}`
}

// ── queued comments ─────────────────────────────────────────────────────────

export const $pendingArtifactComments = atom<Record<string, PendingArtifactComment[]>>({})

let commentSeq = 0

export function addPendingArtifactComment(
  artifactId: string,
  draft: Omit<PendingArtifactComment, 'id'>
): PendingArtifactComment | null {
  const note = draft.note.trim()
  const quote = draft.quote.trim()

  if (!note || !quote) {
    return null
  }

  commentSeq += 1
  const comment = { ...draft, id: `c${Date.now().toString(36)}${commentSeq}`, note, quote }
  const current = $pendingArtifactComments.get()

  $pendingArtifactComments.set({ ...current, [artifactId]: [...(current[artifactId] ?? []), comment] })

  return comment
}

export function removePendingArtifactComment(artifactId: string, commentId: string) {
  const current = $pendingArtifactComments.get()
  const next = (current[artifactId] ?? []).filter(comment => comment.id !== commentId)

  if (next.length) {
    $pendingArtifactComments.set({ ...current, [artifactId]: next })
  } else {
    clearPendingArtifactComments(artifactId)
  }
}

export function clearPendingArtifactComments(artifactId: string) {
  const current = $pendingArtifactComments.get()

  if (artifactId in current) {
    const { [artifactId]: _dropped, ...rest } = current
    $pendingArtifactComments.set(rest)
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The one message "Send all" submits: which artifact, which version, every quote and note. */
export function artifactCommentsPrompt(
  artifact: { id: string; title: string; version: number },
  comments: readonly PendingArtifactComment[]
): string {
  const viewed = [...new Set(comments.map(comment => comment.version))]
  const older = viewed.filter(version => version !== artifact.version)
  const count = comments.length === 1 ? 'this comment' : `these ${comments.length} comments`

  const header = [
    `Apply ${count} to the artifact "${artifact.title}" (id ${artifact.id}).`,
    older.length
      ? `I wrote them while viewing v${older.join(', v')}; the newest is v${artifact.version}, so check the quotes against it.`
      : `They are on v${artifact.version}, the newest version.`,
    'Read it with artifact_get, make every change in one pass, and save it as one new version with artifact_save.'
  ].join(' ')

  const body = comments.map((comment, index) => {
    const note = comment.note.replace(/\n+/g, '\n   ')

    return `${index + 1}. On "${clip(tidyQuote(comment.quote), 400)}"\n   ${note}`
  })

  return [header, '', ...body].join('\n')
}
