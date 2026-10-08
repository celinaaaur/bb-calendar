import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './supabase'

// ── Google Drive import ──────────────────────────────────────────────────────
// Lets the user pick file(s) straight from their existing Google Drive
// instead of uploading from their computer. Drive stays the source of truth;
// picked files are downloaded once and copied into Supabase Storage so every
// preview/mockup/download feature in the app keeps working exactly as before.
const GOOGLE_CLIENT_ID = '1034112791542-3h0erfvn96l9v8na0alrfl6g97mtvfik.apps.googleusercontent.com'
const GOOGLE_API_KEY = 'AIzaSyAVx02rQmVnOK-rCt7dBbrBSrVZKqgTDNA'

let driveTokenClient = null

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) return resolve()
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
}

async function ensureGoogleApisLoaded() {
  await loadScriptOnce('https://accounts.google.com/gsi/client')
  await loadScriptOnce('https://apis.google.com/js/api.js')
  await new Promise((resolve) => window.gapi.load('picker', resolve))
}

function getDriveAccessToken() {
  return new Promise((resolve, reject) => {
    if (!driveTokenClient) {
      driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: () => {},
      })
    }
    driveTokenClient.callback = (resp) => {
      if (resp.error) reject(resp)
      else resolve(resp.access_token)
    }
    driveTokenClient.requestAccessToken({ prompt: '' })
  })
}

// Opens the Drive picker, lets the user select image/video file(s), downloads
// them, and resolves to real File objects — the same shape uploadMultiple()
// already expects from a local <input type="file">.
async function pickFilesFromDrive({ multiple = false } = {}) {
  await ensureGoogleApisLoaded()
  const accessToken = await getDriveAccessToken()

  const docs = await new Promise((resolve) => {
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes('image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/webm')
    const builder = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) resolve(data.docs)
        else if (data.action === window.google.picker.Action.CANCEL) resolve(null)
      })
    if (multiple) builder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    builder.build().setVisible(true)
  })

  if (!docs) return []

  return Promise.all(docs.map(async (doc) => {
    const res = await fetch('https://www.googleapis.com/drive/v3/files/' + doc.id + '?alt=media', {
      headers: { Authorization: 'Bearer ' + accessToken }
    })
    const blob = await res.blob()
    return new File([blob], doc.name, { type: doc.mimeType })
  }))
}

const style = document.createElement('style')
style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400;500;700;900&family=Figtree:wght@300;400;500;600&display=swap');
  * { box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
  .bb-rich-text:empty:before { content: attr(data-placeholder); color: #B8A898; }
  .bb-rich-text ul { margin: 0; padding-left: 20px; }
  .bb-rich-text ol { margin: 0; padding-left: 20px; }
  .bb-note-body ul { margin: 4px 0; padding-left: 20px; }
  .bb-note-body ol { margin: 4px 0; padding-left: 20px; }
  body { margin: 0; background: #F5F0E8; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D4C9B0; border-radius: 4px; }
  textarea:focus, input:focus, select:focus { outline: none; }
  button { cursor: pointer; }
  .bb-app-shell { height: 100vh; height: 100dvh; }
`
document.head.appendChild(style)

const F = {
  display: "'Unbounded', 'Helvetica Neue', Arial, sans-serif",
  body: "'Figtree', system-ui, sans-serif"
}

const PALETTE = {
  cream: '#EEEBE3', creamDark: '#DAD8D0', creamMid: '#F7F6F2',
  border: '#3C2211', borderLight: '#3C2211',
  espresso: '#2C1F0E', espressoLight: '#5C4A30',
  caramel: '#3C2211', caramelLight: '#DCD7D4',
  muted: '#8A7560', mutedLight: '#B8A898',
}

const MAX_FILE_SIZE = 80 * 1024 * 1024

const isVideo = (url) => {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  return ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)
}

const imgSrc = (url, published = false) => {
  if (!url || isVideo(url)) return url
  if (published && url.includes('supabase')) {
    return url + (url.includes('?') ? '&' : '?') + 'width=800&quality=60'
  }
  return url
}

// Resizes/re-encodes large images before upload to cut Supabase storage usage.
// Skips GIFs (would destroy animation) and videos (no practical client-side
// video compression in a browser — that needs a real transcoding step).
// Only swaps in the compressed version if it actually comes out smaller.
const compressImage = (file, { maxDimension = 1920, quality = 0.82 } = {}) => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
      resolve(file)
      return
    }
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (blob && blob.size < file.size) {
          const newName = file.name.replace(/\.\w+$/, '') + '.jpg'
          resolve(new File([blob], newName, { type: 'image/jpeg' }))
        } else {
          resolve(file)
        }
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file) }
    img.src = objectUrl
  })
}

const uploadAsset = async (file) => {
  if (file.size > MAX_FILE_SIZE) return { error: 'File is too large. Maximum size is 80MB.' }
  const toUpload = await compressImage(file)
  const ext = toUpload.name.split('.').pop()
  const filename = Date.now() + '.' + ext
  const { error } = await supabase.storage.from('post-assets').upload(filename, toUpload, { upsert: true })
  if (!error) {
    const { data } = supabase.storage.from('post-assets').getPublicUrl(filename)
    return { url: data.publicUrl }
  }
  return { error: 'Upload failed. Please try again.' }
}

const uploadMultiple = async (files) => {
  const results = await Promise.all(Array.from(files).map(uploadAsset))
  const urls = results.filter(r => r.url).map(r => r.url)
  const errors = results.filter(r => r.error)
  return { urls, error: errors.length ? errors[0].error : null }
}

const downloadAsset = async (url, clientName, index) => {
  if (!url) return
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const ext = url.split('?')[0].split('.').pop().toLowerCase() || 'jpg'
    const slug = (clientName || 'post').toLowerCase().replace(/\s+/g, '-')
    const date = new Date().toISOString().slice(0, 10)
    const filename = slug + '-' + date + (index != null ? '-' + index : '') + '.' + ext
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (e) {
    window.open(url, '_blank')
  }
}

// Downloads every slide of a carousel. Sequenced with a short delay between
// each — firing several downloads at once in the same tick gets blocked or
// silently dropped by some browsers.
const downloadAllAssets = async (urls, clientName) => {
  for (let i = 0; i < urls.length; i++) {
    await downloadAsset(urls[i], clientName, i + 1)
    if (i < urls.length - 1) await new Promise(r => setTimeout(r, 400))
  }
}

function AssetPreview({ url, onRemove, maxHeight = 180 }) {
  if (!url) return null
  return (
    <div style={{ position: 'relative' }}>
      {isVideo(url)
        ? <video src={url} controls style={{ width: '100%', borderRadius: 8, maxHeight, display: 'block', background: '#000' }} />
        : <img src={url} alt="" loading="lazy" style={{ width: '100%', borderRadius: 8, maxHeight, objectFit: 'cover', display: 'block' }} />
      }
      {onRemove && (
        <button onClick={onRemove} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: 24, height: 24, color: '#fff', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      )}
    </div>
  )
}

function MultiAssetPreview({ urls, onRemove }) {
  if (!urls || urls.length === 0) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
      {urls.map((url, i) => (
        <div key={i} style={{ position: 'relative' }}>
          <AssetPreview url={url} onRemove={() => onRemove(i)} maxHeight={90} />
          <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontFamily: F.body }}>{i + 1}</div>
        </div>
      ))}
    </div>
  )
}

const fmt = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() + ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}
const fmtShort = (str) => {
  if (!str) return ''
  return new Date(str).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
const fmtTime = (str) => {
  if (!str) return ''
  return new Date(str).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}
const fmtAgo = (str) => {
  if (!str) return ''
  const diff = Date.now() - new Date(str).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  const days = Math.floor(h / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return days + 'd ago'
  return fmtShort(str)
}
// Converts a stored UTC timestamp to the local "YYYY-MM-DDTHH:mm" string a
// <input type="datetime-local"> expects. toISOString() always returns UTC,
// which silently shifts the displayed time by the timezone offset (and,
// worse, re-saves that shifted value) — this uses local date/time parts instead.
const toLocalInputValue = (str) => {
  if (!str) return ''
  const d = new Date(str)
  const pad = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

const STATUS = {
  draft:     { label: 'DRAFT',               color: '#5C4A30', bg: '#EFEBE4', dot: '#9A8F7E', border: '#D4C9B0' },
  pending:   { label: 'AWAITING APPROVAL',   color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A', border: '#E8C87A' },
  approved:  { label: 'APPROVED',            color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F', border: '#7ECBA1' },
  scheduled: { label: 'SCHEDULED',           color: '#1E4E8A', bg: '#E8F1FC', dot: '#3B72B8', border: '#A9C6E8' },
  revision:  { label: 'REVISIONS REQUESTED', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B', border: '#F4A59F' },
  published: { label: 'PUBLISHED',           color: '#444',    bg: '#F2F2F2', dot: '#888',    border: '#CCC'    },
  archived:  { label: 'ARCHIVED',            color: '#777',    bg: '#F5F5F5', dot: '#AAA',    border: '#DDD'    },
}
const FORMATS = ['post', 'carousel', 'reel', 'story']
const PLATFORMS = ['facebook', 'instagram', 'tiktok']
const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }
const formatPlatforms = (platforms) => {
  if (!Array.isArray(platforms) || platforms.length === 0) return 'Instagram'
  return platforms.map(p => PLATFORM_LABELS[p] || p).join(', ')
}
const REQUEST_TYPES = [
  { value: 'collateral_design', label: 'Collateral Design' },
  { value: 'social_media_post', label: 'Social Media Post' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'paid_ads', label: 'Paid Ads Request' },
]
const BILLING_STATUS = {
  paid:    { label: 'PAID',    color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F' },
  pending: { label: 'PENDING', color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A' },
  overdue: { label: 'OVERDUE', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B' },
}
const REQUEST_STATUS = {
  new:         { label: 'NEW',         color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F' },
  in_progress: { label: 'IN PROGRESS', color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A' },
  done:        { label: 'DONE',        color: '#444',    bg: '#F2F2F2', dot: '#888'    },
  declined:    { label: 'DECLINED',    color: '#7A2018', bg: '#FEECEA', dot: '#C0392B' },
}
const REQUEST_STATUS_ORDER = ['new', 'in_progress', 'done', 'declined']
// Industry target for Instagram engagement rate (engagements ÷ reach), food &
// beverage brands — Dash Social's 2026 Food and Beverage Industry Benchmarks
// report. Update this if a more current report becomes available; it's a
// single source of truth referenced by the Marketing Reports view.
const FNB_ENGAGEMENT_BENCHMARK = { low: 2.0, high: 2.5, source: 'Dash Social, 2026 F&B Industry Benchmarks' }
// Note: this is the closest published F&B-specific link CTR figure available,
// but it comes from paid Meta ad campaigns, not organic bio-link taps ÷
// profile visits — no organic-specific F&B benchmark is commonly published.
// Treat this as a rough reference point, not a precise apples-to-apples bar.
const FNB_CTR_BENCHMARK = { value: 1.8, source: 'Cool Nerds Marketing, 2026 CPG/F&B benchmark data (paid link CTR — closest available reference; organic-specific F&B CTR benchmarks aren\'t commonly published)' }
const fmtMoney = (n) => n == null || n === '' ? '—' : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Case/whitespace-insensitive name comparison — used to match a logged-in
// user's auth display name against the "Assigned to" field on posts, since
// those are two separately-typed strings that can drift slightly out of sync.
const normalizeName = (s) => (s || '').trim().toLowerCase()
const namesMatch = (a, b) => normalizeName(a) === normalizeName(b) && normalizeName(a) !== ''
// Only these people can see/open the Billing tab (client hub) and the
// Billing box on the Client Overview page. Add or remove emails here —
// matching is case-insensitive.
// Find a team member from a name: exact match first, then a unique first-name match
const findMember = (members, name) => {
  if (!name) return null
  const exact = (members || []).find(m => namesMatch(m.name, name))
  if (exact) return exact
  const first = normalizeName(name).split(/\s+/)[0]
  const hits = (members || []).filter(m => normalizeName(m.name).split(/\s+/)[0] === first)
  return hits.length === 1 ? hits[0] : null
}

// Who did something: a team member (avatar) or a client (brand logo)?
// side is 'team' or 'client' when we know for sure, otherwise it is worked out from the name.
function resolveActor({ who, side, members, client, currentUserName, currentUserAvatarUrl }) {
  const member = findMember(members, who)
  const isMe = !!who && !!currentUserName && (namesMatch(who, currentUserName) || normalizeName(who).split(/\s+/)[0] === normalizeName(currentUserName).split(/\s+/)[0])
  if (side === 'team' || (side !== 'client' && (member || isMe))) {
    return { kind: 'team', name: who || 'Brown Butter', src: member?.avatar_url || (isMe ? currentUserAvatarUrl : null) || null, color: PALETTE.espresso }
  }
  return { kind: 'client', name: client?.name || who || 'Client', src: client?.logo_url || null, color: client?.brand_color || PALETTE.caramel }
}

function Avatar({ actor, size = 26, ring }) {
  const initials = (actor.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div title={actor.name} style={{ width: size, height: size, borderRadius: '50%', background: actor.src ? '#fff' : actor.color, border: ring || '0.5px solid ' + PALETTE.borderLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(8, Math.round(size * 0.34)), fontWeight: 600, color: '#fff', fontFamily: F.body, flexShrink: 0, overflow: 'hidden' }}>
      {actor.src ? <img src={actor.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </div>
  )
}

const BILLING_ALLOWED_EMAILS = ['celina@brown-butter.com', 'briana@brown-butter.com']
// Where the client portal is hosted (no trailing slash). Each client's link
// in the copy-paste approval reminder is this plus their slug, e.g.
// www.brown-butter.com/smoove. Leave empty to leave the link line out.
const PORTAL_BASE_URL = 'www.brown-butter.com'
const canAccessBilling = (email) => BILLING_ALLOWED_EMAILS.includes((email || '').trim().toLowerCase())
const fmtDateLong = (str) => str ? new Date(str + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
// Notes saved before rich text existed are plain text with real newline
// characters, which HTML ignores — convert those to <br> so old notes don't
// lose their line breaks. New notes already contain real HTML tags, so
// they're left as-is.
const renderNoteBody = (body) => {
  if (!body) return ''
  return /</.test(body) ? body : body.replace(/\n/g, '<br>')
}
const statusLine = (s) => ({ draft: 'Draft: hidden from the client until you send it for review', pending: 'Awaiting client approval', approved: 'Approved — ready to schedule', scheduled: 'Scheduled — will auto-mark as published 24h after posting time', revision: 'Client requested revisions', published: 'Published', archived: 'Archived' }[s] || '')

// Renders a video sized to its real aspect ratio (read from the file itself once
// metadata loads) instead of forcing every video into a fixed 9:16 frame — a
// horizontal video shows fully horizontal, a vertical one stays vertical, no
// black letterbox bars either way. Falls back to 9:16 only until that loads.
function AdaptiveVideo({ src, style }) {
  const [ratio, setRatio] = useState(null)
  useEffect(() => { setRatio(null) }, [src])
  const handleLoaded = (e) => {
    const v = e.target
    if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
  }
  return (
    <video
      src={src}
      controls
      onLoadedMetadata={handleLoaded}
      style={{ width: '100%', aspectRatio: ratio || '9/16', objectFit: 'contain', display: 'block', background: '#000', ...style }}
    />
  )
}

function PlatformPicker({ selected, onChange }) {
  const toggle = (p) => {
    if (selected.includes(p)) onChange(selected.filter(x => x !== p))
    else onChange([...selected, p])
  }
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {PLATFORMS.map(p => (
        <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}>
          <input type="checkbox" checked={selected.includes(p)} onChange={() => toggle(p)} style={{ accentColor: PALETTE.caramel, width: 14, height: 14, cursor: 'pointer' }} />
          {PLATFORM_LABELS[p]}
        </label>
      ))}
    </div>
  )
}

function CaptionText({ text, handle, style: extra }) {
  return (
    <div style={{ fontFamily: F.body, fontSize: 11, color: '#111', lineHeight: 1.6, ...extra }}>
      {handle && <span style={{ fontWeight: 600 }}>{handle}{' '}</span>}
      {(text || '').split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}
    </div>
  )
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.pending
  return <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: s.bg, color: s.color, border: '0.5px solid ' + s.border, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{s.label}</span>
}

function TodayQueue({ posts, clients, onSelect, currentUserName }) {
  const now = new Date()
  const todayPosts = posts.filter(p => {
    if (p.status === 'archived' || p.status === 'draft') return false
    const d = new Date(p.scheduled_at)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))

  if (todayPosts.length === 0) return null

  const doneCount = todayPosts.filter(p => p.status === 'published').length
  const pendingCount = todayPosts.length - doneCount

  return (
    <div style={{ margin: '20px 26px 48px', background: '#fff', border: '0.5px solid ' + PALETTE.caramel, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '11px 16px', background: PALETTE.caramelLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: F.display, color: PALETTE.espresso, fontSize: 14 }}>Up for publishing today</span>
          <span style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {now.toLocaleDateString('en-PH', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {doneCount > 0 && <span style={{ fontFamily: F.body, fontSize: 11, color: '#2A7D4F', fontWeight: 500 }}>{doneCount} published</span>}
          {pendingCount > 0 && <span style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, fontWeight: 500 }}>{pendingCount} remaining</span>}
        </div>
      </div>
      <div style={{ display: 'flex', overflowX: 'auto', padding: '14px 16px', gap: 12, scrollbarWidth: 'none' }}>
        {todayPosts.map(post => {
          const client = clients.find(c => c.id === post.client_id)
          const hasVid = isVideo(post.image_url)
          const isDone = post.status === 'published'
          return (
            <div key={post.id} onClick={() => onSelect(post)} style={{ flexShrink: 0, width: 160, borderRadius: 8, overflow: 'hidden', border: '0.5px solid ' + (isDone ? '#7ECBA1' : PALETTE.border), background: isDone ? '#F0FAF4' : '#fff', cursor: 'pointer', transition: 'all 0.15s', opacity: isDone ? 0.8 : 1 }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(44,31,14,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
            >
              <div style={{ height: 90, background: PALETTE.creamDark, position: 'relative', overflow: 'hidden' }}>
                {post.image_url && !hasVid && <img src={imgSrc(post.image_url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {post.image_url && hasVid && (
                  post.cover_url
                    ? <img src={imgSrc(post.cover_url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill={PALETTE.caramel}><path d="M8 5v14l11-7z"/></svg>
                      </div>
                )}
                {!post.image_url && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, color: PALETTE.caramel, fontSize: 13 }}>BB</div>}
                {isDone && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(42,125,79,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#2A7D4F', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>✓</div>
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, fontWeight: 500, marginBottom: 2 }}>{fmtTime(post.scheduled_at)}</div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.muted, marginBottom: 4 }}>{client?.name || '—'}{post.campaign ? ' · ' + post.campaign : ''}</div>
                <p style={{ margin: '0 0 6px', fontFamily: F.body, fontSize: 11, color: PALETTE.espresso, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 300 }}>{post.caption}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Badge status={post.status} />
                  {post.designer && (
                    <span style={{ fontFamily: F.body, fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 9, fontWeight: 500, background: namesMatch(post.designer, currentUserName) ? PALETTE.caramel : PALETTE.creamDark, color: namesMatch(post.designer, currentUserName) ? PALETTE.cream : PALETTE.muted }}>
                      {post.designer}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IGGrid({ posts, onSelectPost }) {
  const grid = [...posts].filter(p => p.status !== 'archived').sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)).slice(0, 9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2 }}>
      {grid.map((p, i) => (
        <div key={i} onClick={() => p && onSelectPost && onSelectPost(p)} style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: 2, position: 'relative', background: p ? (p.image_url ? 'transparent' : 'hsl(' + (28 + i * 8) + ',20%,' + (86 - i * 2) + '%)') : '#E8E0D0', cursor: p && onSelectPost ? 'pointer' : 'default', transition: 'opacity 0.12s' }}
          onMouseEnter={e => { if (p && onSelectPost) e.currentTarget.style.opacity = 0.75 }}
          onMouseLeave={e => { e.currentTarget.style.opacity = 1 }}
        >
          {p?.image_url && !isVideo(p.image_url) && <img src={imgSrc(p.image_url, p.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {p?.image_url && isVideo(p.image_url) && (
            p.cover_url
              ? <>
                  <img src={imgSrc(p.cover_url, p.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', bottom: 3, left: 3, width: 14, height: 14, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="7" height="7" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>
                </>
              : <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>
          )}
          {p && !p.image_url && <div style={{ padding: 3, fontSize: 6, color: PALETTE.muted, lineHeight: 1.3 }}>{p.caption?.slice(0, 30)}</div>}
          {p && <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: STATUS[p.status]?.dot || '#ccc', border: '1px solid rgba(255,255,255,0.8)' }} />}
        </div>
      ))}
    </div>
  )
}

function DragHint({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#FBF1DF', border: '0.5px solid #E8C87A', borderRadius: 8, padding: '8px 12px', fontFamily: F.body, fontSize: 12, color: '#6B4A12' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" /></svg>
      <span>{children}</span>
    </div>
  )
}

function CalendarView({ posts, onSelect, onMove }) {
  const now = new Date()
  const [dragId, setDragId] = useState(null)
  const [overDay, setOverDay] = useState(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1) }} style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 6, padding: '6px 14px', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Prev</button>
        <span style={{ fontFamily: F.display, fontSize: 18, color: PALETTE.espresso, flex: 1, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }} style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 6, padding: '6px 14px', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Next</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <DragHint><b style={{ fontWeight: 500 }}>Drag a post to another day to reschedule it.</b> The time stays the same and the move is logged in the post's History. Published posts can't be moved.</DragHint>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: PALETTE.border }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ background: PALETTE.creamDark, padding: '7px 4px', textAlign: 'center', fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const dayPosts = day ? posts.filter(p => { const d = new Date(p.scheduled_at); return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day }) : []
          const isToday = day && now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
          return (
            <div key={i}
              onDragOver={e => { if (day && dragId) { e.preventDefault(); if (overDay !== day) setOverDay(day) } }}
              onDragLeave={() => { if (overDay === day) setOverDay(null) }}
              onDrop={e => {
                e.preventDefault()
                const post = posts.find(p => p.id === dragId)
                setOverDay(null); setDragId(null)
                if (post && day) onMove && onMove(post, new Date(year, month, day))
              }}
              style={{ background: day && overDay === day && dragId ? '#FBF1DF' : '#fff', minHeight: 80, padding: 5, borderTop: isToday ? '2px solid ' + PALETTE.caramel : 'none', outline: day && overDay === day && dragId ? '1.5px dashed ' + PALETTE.caramel : 'none', outlineOffset: '-2px', transition: 'background 0.1s' }}>
              {day && <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: isToday ? 500 : 400, color: isToday ? PALETTE.caramel : PALETTE.mutedLight, marginBottom: 3 }}>{day}</div>}
              {dayPosts.map(p => (
                <div key={p.id} onClick={() => onSelect(p)}
                  draggable={p.status !== 'published'}
                  onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); setDragId(p.id) }}
                  onDragEnd={() => { setDragId(null); setOverDay(null) }}
                  title={p.status === 'published' ? 'Published posts can\'t be moved' : 'Drag to another day to reschedule (keeps the same time)'}
                  style={{ background: STATUS[p.status]?.bg || PALETTE.cream, borderLeft: '2px solid ' + (STATUS[p.status]?.dot || '#ccc'), padding: '2px 4px', marginBottom: 2, borderRadius: 2, cursor: p.status === 'published' ? 'pointer' : 'grab', opacity: dragId === p.id ? 0.4 : 1, fontFamily: F.body, fontSize: 9, color: PALETTE.espresso, lineHeight: 1.4 }}>
                  {p.status !== 'published' && <span aria-hidden="true" style={{ color: PALETTE.mutedLight, marginRight: 3, letterSpacing: '-1px' }}>⋮⋮</span>}{fmtTime(p.scheduled_at)} — {p.caption?.slice(0, 18)}...
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NotificationsPanel({ notifications, onClose, onMarkAllRead, onSelect }) {
  const unread = notifications.filter(n => !n.read).length
  return (
    <div style={{ position: 'absolute', top: 48, right: 16, width: 300, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 10, border: '0.5px solid ' + PALETTE.border, boxShadow: '0 8px 32px rgba(44,31,14,0.16)', zIndex: 300, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: F.display, fontSize: 15, color: PALETTE.espresso }}>Notifications</span>
        {unread > 0 && <button onClick={onMarkAllRead} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, fontWeight: 500 }}>Mark all read</button>}
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {notifications.length === 0
          ? <div style={{ padding: '24px 16px', textAlign: 'center', fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic' }}>All caught up.</div>
          : notifications.map((n, i) => (
            <div key={i} onClick={() => onSelect(n)} style={{ padding: '11px 16px', borderBottom: '0.5px solid ' + PALETTE.borderLight, background: n.read ? '#fff' : PALETTE.creamMid, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamDark}
              onMouseLeave={e => e.currentTarget.style.background = n.read ? '#fff' : PALETTE.creamMid}
            >
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.read ? 'transparent' : PALETTE.caramel, flexShrink: 0, marginTop: 5, border: n.read ? '0.5px solid ' + PALETTE.border : 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 700, color: PALETTE.caramel, letterSpacing: '0.02em', marginBottom: 3 }}>{n.client}</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{n.message}</div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 3 }}>{fmtAgo(n.created_at)}</div>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  )
}

function DashboardCarousel({ images, published }) {
  const [idx, setIdx] = useState(0)
  const total = images.length
  const goTo = (i) => setIdx(Math.max(0, Math.min(total - 1, i)))

  return (
    <div style={{ width: '100%', aspectRatio: '4/5', position: 'relative', overflow: 'hidden', background: PALETTE.creamDark }}>
      <div style={{
        display: 'flex', position: 'absolute', top: 0, left: 0, height: '100%', width: '100%',
        transform: `translateX(-${idx * 100}%)`, transition: 'transform 0.3s ease'
      }}>
        {images.map((url, i) => (
          <div key={i} style={{ minWidth: '100%', height: '100%', position: 'relative' }}>
            {isVideo(url)
              ? <video src={url} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
              : <img src={imgSrc(url, published)} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            }
          </div>
        ))}
      </div>

      {/* Left/right tap zones */}
      {idx > 0 && <div onClick={() => goTo(idx - 1)} style={{ position: 'absolute', left: 0, top: 0, width: '30%', height: '100%', cursor: 'pointer', zIndex: 5 }} />}
      {idx < total - 1 && <div onClick={() => goTo(idx + 1)} style={{ position: 'absolute', right: 0, top: 0, width: '30%', height: '100%', cursor: 'pointer', zIndex: 5 }} />}

      {/* Arrow chevrons */}
      {idx > 0 && (
        <div onClick={() => goTo(idx - 1)} style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </div>
      )}
      {idx < total - 1 && (
        <div onClick={() => goTo(idx + 1)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      )}

      {/* Slide counter badge */}
      <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: F.body, fontSize: 9, fontWeight: 500, padding: '2px 7px', borderRadius: 9, zIndex: 6 }}>
        {idx + 1}/{total}
      </div>

      {/* Dot indicators */}
      <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4, zIndex: 6 }}>
        {images.map((_, i) => (
          <div key={i} onClick={() => goTo(i)} style={{ width: 4, height: 4, borderRadius: '50%', background: i === idx ? '#3897F0' : 'rgba(255,255,255,0.8)', cursor: 'pointer', boxShadow: '0 0 2px rgba(0,0,0,0.3)' }} />
        ))}
      </div>
    </div>
  )
}

function RightPanel({ post, comments, versions, statusChanges, designOptions, clients, teamMembers, onRefresh, onClose, isMobile, currentUserName, onUpdatePostLocal }) {
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [editing, setEditing] = useState(false)
  const [inlineField, setInlineField] = useState(null) // which Details row is being edited inline right now, if any
  const [editCaption, setEditCaption] = useState(post.caption)
  const [editScheduled, setEditScheduled] = useState(toLocalInputValue(post.scheduled_at))
  const [editFormat, setEditFormat] = useState(post.format || 'post')
  const [editPlatforms, setEditPlatforms] = useState(Array.isArray(post.platforms) && post.platforms.length > 0 ? post.platforms : ['instagram'])
  const [editSlideCount, setEditSlideCount] = useState(post.slide_count || '')
  const [editDesigner, setEditDesigner] = useState(post.designer || '')
  const [editCampaign, setEditCampaign] = useState(post.campaign || '')
  const [editImages, setEditImages] = useState(Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []))
  const [editCoverUrl, setEditCoverUrl] = useState(post.cover_url || '')
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importingDrive, setImportingDrive] = useState(false)
  const [uploadingOptions, setUploadingOptions] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef()
  const coverFileRef = useRef()
  const optionsFileRef = useRef()

  const client = clients.find(c => c.id === post.client_id)
  const handle = client?.ig_handle || client?.name?.toLowerCase().replace(/\s+/g, '.') || 'handle'
  const isPublished = post.status === 'published'
  const displaySrc = imgSrc(post.image_url, isPublished)

  useEffect(() => {
    setEditCaption(post.caption)
    setEditScheduled(toLocalInputValue(post.scheduled_at))
    setEditFormat(post.format || 'post')
    setEditPlatforms(Array.isArray(post.platforms) && post.platforms.length > 0 ? post.platforms : ['instagram'])
    setEditSlideCount(post.slide_count || '')
    setEditDesigner(post.designer || '')
    setEditCampaign(post.campaign || '')
    setEditImages(Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []))
    setEditCoverUrl(post.cover_url || '')
    setEditing(false)
    setInlineField(null)
    setUploadError(null)
  }, [post.id])

  const processFiles = async (files) => {
    if (!files || !files.length) return
    setUploadError(null)
    setUploading(true)
    const { urls, error } = await uploadMultiple(files)
    if (urls.length) setEditImages(prev => [...prev, ...urls])
    if (error) setUploadError(error)
    setUploading(false)
  }

  const handleFile = async (e) => {
    await processFiles(e.target.files)
  }

  const handleDriveImport = async () => {
    setUploadError(null); setImportingDrive(true)
    try {
      const files = await pickFilesFromDrive({ multiple: editFormat === 'carousel' })
      await processFiles(files)
    } catch (err) {
      console.error('Drive import error:', err)
      setUploadError('Could not import from Drive. Please try again.')
    }
    setImportingDrive(false)
  }

  const handleAddDesignOptions = async (e) => {
    const files = e.target.files
    if (!files || !files.length) return
    setUploadingOptions(true)
    const results = await Promise.all(Array.from(files).map(uploadAsset))
    const successful = results.filter(r => r.url)
    if (successful.length) {
      await supabase.from('design_options').insert(
        successful.map((r, i) => ({ post_id: post.id, image_url: r.url, label: 'Option ' + (designOptions.length + i + 1) }))
      )
    }
    setUploadingOptions(false)
    onRefresh()
  }

  const deleteDesignOption = async (id) => {
    if (!window.confirm('Delete this design option?')) return
    await supabase.from('design_options').delete().eq('id', id)
    onRefresh()
  }

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    const { url, error } = await uploadAsset(file)
    if (url) setEditCoverUrl(url)
    if (error) setUploadError(error)
    setUploadingCover(false)
  }

  const removeEditImage = (i) => setEditImages(prev => prev.filter((_, idx) => idx !== i))

  const saveEdit = async () => {
    if (!editCaption.trim() || !editDesigner.trim() || !editScheduled) return
    setSaving(true)

    const newScheduledIso = new Date(editScheduled).toISOString()
    const newImageUrl = editImages[0] || null
    const newCoverUrl = editImages[0] && isVideo(editImages[0]) ? (editCoverUrl || null) : null
    const newCampaign = editCampaign.trim() || null

    // Figure out exactly what changed so History shows a real audit trail,
    // not just a single generic "updated" entry
    const changes = []
    if (editCaption.trim() !== (post.caption || '')) changes.push('updated the caption')
    if (newScheduledIso !== post.scheduled_at) changes.push('changed the scheduled time to ' + fmt(newScheduledIso))
    if (editFormat !== (post.format || 'post')) changes.push('changed the format to ' + editFormat.charAt(0).toUpperCase() + editFormat.slice(1))
    if (editDesigner.trim() !== (post.designer || '')) changes.push('changed who\'s assigned to ' + editDesigner.trim())
    if (newCampaign !== (post.campaign || null)) changes.push('updated the content pillar')
    if (JSON.stringify([...editPlatforms].sort()) !== JSON.stringify([...(post.platforms || ['instagram'])].sort())) changes.push('changed the platform to ' + formatPlatforms(editPlatforms))
    if (newImageUrl !== (post.image_url || null)) changes.push(post.image_url ? 'replaced the asset' : 'uploaded an asset')
    if (newCoverUrl !== (post.cover_url || null) && newImageUrl === (post.image_url || null)) changes.push('updated the cover photo')

    await supabase.from('posts').update({
      caption: editCaption.trim(), scheduled_at: newScheduledIso,
      format: editFormat, slide_count: editFormat === 'carousel' ? (editImages.length || (editSlideCount ? parseInt(editSlideCount) : null)) : null,
      designer: editDesigner.trim(), campaign: newCampaign,
      platforms: editPlatforms,
      image_url: newImageUrl,
      images: editFormat === 'carousel' && editImages.length > 1 ? editImages : null,
      cover_url: newCoverUrl,
    }).eq('id', post.id)

    if (changes.length > 0) {
      await supabase.from('versions').insert(
        changes.map((note, i) => ({ post_id: post.id, version_number: versions.length + i + 1, note, author: currentUserName }))
      )
    }

    setSaving(false); setEditing(false); onRefresh()
  }

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({ post_id: post.id, author: currentUserName, author_type: 'agency', text: newComment.trim() })
    setNewComment(''); setSaving(false); onRefresh()
  }

  const updateStatus = async (status) => {
    // Optimistic: reflect the new status in the shared posts list immediately,
    // so the badge/button state updates instantly instead of waiting on the
    // round trip. Reverts if the save actually fails.
    const previousStatus = post.status
    onUpdatePostLocal && onUpdatePostLocal(post.id, { status })
    const { error } = await supabase.from('posts').update({ status }).eq('id', post.id)
    if (error) {
      console.error('Status update error:', error)
      onUpdatePostLocal && onUpdatePostLocal(post.id, { status: previousStatus })
      alert('Could not update status: ' + error.message)
      return
    }
    await supabase.from('status_changes').insert({ post_id: post.id, status, changed_by: currentUserName })
    onRefresh()
  }

  // Inline field editing — click a Details row, edit it in place, saves
  // immediately (optimistic, with rollback on failure) without opening the
  // full edit form. Used for the short property-style fields; Assets and
  // Caption still go through the full form since they need more room.
  const saveInlineField = async (dbField, value, changeNote) => {
    const previous = post[dbField]
    onUpdatePostLocal && onUpdatePostLocal(post.id, { [dbField]: value })
    setInlineField(null)
    const { error } = await supabase.from('posts').update({ [dbField]: value }).eq('id', post.id)
    if (error) {
      console.error('Inline field update error:', error)
      onUpdatePostLocal && onUpdatePostLocal(post.id, { [dbField]: previous })
      alert('Could not save: ' + error.message)
      return
    }
    if (changeNote) {
      await supabase.from('versions').insert({ post_id: post.id, version_number: versions.length + 1, note: changeNote, author: currentUserName })
    }
    onRefresh()
  }

  const deletePost = async () => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    await supabase.from('posts').delete().eq('id', post.id)
    onRefresh(); onClose()
  }

  const archivePost = async () => {
    await supabase.from('posts').update({ status: 'archived' }).eq('id', post.id)
    onRefresh(); onClose()
  }

  const handleDownload = async () => {
    setDownloading(true)
    if (Array.isArray(post.images) && post.images.length > 1) {
      await downloadAllAssets(post.images, client?.name)
    } else {
      await downloadAsset(post.image_url, client?.name)
    }
    setDownloading(false)
  }

  const handleKeyDown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendComment() }

  const formatLabel = post.format ? post.format.charAt(0).toUpperCase() + post.format.slice(1) + (post.slide_count ? ' · ' + post.slide_count + ' slides' : '') : 'Post'
  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body }
  const labelStyle = { fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6, display: 'block' }

  return (
    <div style={isMobile ? {
  position: 'fixed', inset: 0, width: '100%', background: '#fff', display: 'flex',
  flexDirection: 'column', zIndex: 300, overflowY: 'auto', WebkitOverflowScrolling: 'touch'
} : {
  width: 340, background: '#fff', borderLeft: '0.5px solid ' + PALETTE.border, display: 'flex',
  flexDirection: 'column', flexShrink: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch'
}}>
      <div style={{ padding: '14px 18px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, position: 'sticky', top: 0, zIndex: 5, background: '#fff' }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <Badge status={post.status} />
          <div style={{ fontFamily: F.display, fontSize: 13, color: PALETTE.espresso, marginTop: 7, lineHeight: 1.4 }}>{post.caption?.slice(0, 60)}{post.caption?.length > 60 ? '…' : ''}</div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 16, color: PALETTE.mutedLight, lineHeight: 1, flexShrink: 0, padding: 2, marginTop: 2 }}
          onMouseEnter={e => e.currentTarget.style.color = PALETTE.espresso}
          onMouseLeave={e => e.currentTarget.style.color = PALETTE.mutedLight}
        >✕</button>
      </div>

      {editing ? (
        <div style={{ padding: '12px 18px', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
          <span style={labelStyle}>Assets {uploading && <span style={{ color: PALETTE.caramel, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>uploading...</span>}</span>
          <MultiAssetPreview urls={editImages} onRemove={removeEditImage} />
          <div onClick={() => fileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 6, padding: '16px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
            <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>+ {editFormat === 'carousel' ? 'Add photos (select multiple)' : 'Replace asset'}</div>
            <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginTop: 4 }}>Image, GIF, or video (max 80MB each)</div>
          </div>
          <button type="button" onClick={handleDriveImport} disabled={importingDrive} style={{ width: '100%', marginTop: 6, padding: '8px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', color: PALETTE.espresso, fontFamily: F.body, fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M8.6 15l3.43-5.94L19.4 15H8.6z" fill="#EA4335"/><path d="M1.15 15L7.71 3.5 11.14 9 4.58 20.94 1.15 15z" fill="#4285F4"/><path d="M1.15 15h11.4l3.43 5.94H4.58L1.15 15z" fill="#34A853"/><path d="M7.71 3.5h5.15L19.4 15H8.6L7.71 3.5z" fill="#FBBC04"/></svg>
            {importingDrive ? 'Importing from Drive...' : 'Import from Google Drive'}
          </button>
          {uploadError && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', marginTop: 6 }}>{uploadError}</div>}
          <input ref={fileRef} type="file" accept="image/*,video/*,.gif" multiple={editFormat === 'carousel'} onChange={handleFile} style={{ display: 'none' }} />

          {editImages[0] && isVideo(editImages[0]) && (
            <div style={{ marginTop: 14 }}>
              <span style={labelStyle}>Cover photo {uploadingCover && <span style={{ color: PALETTE.caramel, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>uploading...</span>}</span>
              {editCoverUrl ? (
                <AssetPreview url={editCoverUrl} onRemove={() => setEditCoverUrl('')} maxHeight={100} />
              ) : (
                <div onClick={() => coverFileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 6, padding: '14px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>+ Upload cover image</div>
                </div>
              )}
              <input ref={coverFileRef} type="file" accept="image/*" onChange={handleCoverFile} style={{ display: 'none' }} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '12px 16px', background: PALETTE.creamMid, borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>

          {/* ── Story mockup ── */}
          {post.format?.toLowerCase() === 'story' ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 180, background: '#111', borderRadius: 24, padding: '8px 5px', boxShadow: '0 8px 28px rgba(44,31,14,0.18)' }}>
                {/* Notch */}
                <div style={{ width: 50, height: 5, background: '#222', borderRadius: 4, margin: '0 auto 5px' }} />
                {/* Story frame */}
                <div style={{ borderRadius: 14, overflow: 'hidden', position: 'relative', aspectRatio: '9/16', background: '#1A1A1A' }}>
                  {/* Media */}
                  {post.image_url && !isVideo(post.image_url) && (
                    <img src={displaySrc} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {post.image_url && isVideo(post.image_url) && (
                    <video src={post.image_url} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
                  )}
                  {!post.image_url && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: F.display, color: PALETTE.caramel, fontSize: 11 }}>No asset</span>
                    </div>
                  )}
                  {/* Progress bars */}
                  <div style={{ position: 'absolute', top: 8, left: 6, right: 6, display: 'flex', gap: 3, zIndex: 10 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} style={{ flex: 1, height: 2, borderRadius: 2, background: i === 1 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }} />
                    ))}
                  </div>
                  {/* Header: avatar + handle */}
                  <div style={{ position: 'absolute', top: 18, left: 6, right: 6, display: 'flex', alignItems: 'center', gap: 6, zIndex: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, overflow: 'hidden' }}>
                      {client?.logo_url ? <img src={client.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (client?.name || 'BB').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F.body, fontSize: 8, fontWeight: 600, color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{handle}</div>
                      <div style={{ fontFamily: F.body, fontSize: 7, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>{post.scheduled_at ? fmtShort(post.scheduled_at) : 'Scheduled'}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 }}>···</div>
                  </div>
                  {/* Caption overlay */}
                  {post.caption && (
                    <div style={{ position: 'absolute', bottom: 22, left: 6, right: 6, zIndex: 10 }}>
                      <div style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', borderRadius: 5, padding: '4px 6px', fontFamily: F.body, fontSize: 7, color: '#fff', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.caption}</div>
                    </div>
                  )}
                  {/* Reply bar */}
                  <div style={{ position: 'absolute', bottom: 6, left: 6, right: 6, display: 'flex', alignItems: 'center', gap: 5, zIndex: 10 }}>
                    <div style={{ flex: 1, height: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', paddingLeft: 7 }}>
                      <span style={{ fontFamily: F.body, fontSize: 7, color: 'rgba(255,255,255,0.6)' }}>Send message</span>
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </div>
                </div>
                {/* Home indicator */}
                <div style={{ width: 44, height: 3, background: '#444', borderRadius: 3, margin: '5px auto 2px' }} />
              </div>
            </div>
          ) : post.format?.toLowerCase() === 'carousel' && Array.isArray(post.images) && post.images.length > 1 ? (
            /* ── Carousel mockup ── */
            <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '1.5px solid ' + PALETTE.caramel, overflow: 'hidden' }}>{client?.logo_url ? <img src={client.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (client?.name || 'BB').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 600, color: '#111' }}>{handle}</div>
                  {post.campaign && <div style={{ fontFamily: F.body, fontSize: 9, color: '#999' }}>{post.campaign}</div>}
                </div>
                <div style={{ fontSize: 14, color: '#888', letterSpacing: 2 }}>···</div>
              </div>
              <DashboardCarousel images={post.images} published={isPublished} />
              <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                <div style={{ marginLeft: 'auto' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
              </div>
              <div style={{ padding: '0 10px 10px' }}>
                <CaptionText text={post.caption} handle={handle} />
                {post.scheduled_at && <div style={{ fontFamily: F.body, fontSize: 10, color: '#999', marginTop: 4 }}>{fmtShort(post.scheduled_at)}</div>}
              </div>
            </div>
          ) : (
            /* ── Feed / Reel mockup ── */
            <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '1.5px solid ' + PALETTE.caramel, overflow: 'hidden' }}>{client?.logo_url ? <img src={client.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (client?.name || 'BB').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 600, color: '#111' }}>{handle}</div>
                  {post.campaign && <div style={{ fontFamily: F.body, fontSize: 9, color: '#999' }}>{post.campaign}</div>}
                </div>
                <div style={{ fontSize: 14, color: '#888', letterSpacing: 2 }}>···</div>
              </div>
              {post.image_url
                ? isVideo(post.image_url)
                  ? <AdaptiveVideo src={post.image_url} />
                  : <img src={displaySrc} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', aspectRatio: '4/5', background: PALETTE.creamDark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: F.display, color: PALETTE.caramel, fontSize: 13 }}>No asset</span>
                  </div>
              }
              <div style={{ padding: '8px 10px 4px', display: 'flex', gap: 12, alignItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                <div style={{ marginLeft: 'auto' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
              </div>
              <div style={{ padding: '0 10px 10px' }}>
                <CaptionText text={post.caption} handle={handle} />
                {post.scheduled_at && <div style={{ fontFamily: F.body, fontSize: 10, color: '#999', marginTop: 4 }}>{fmtShort(post.scheduled_at)}</div>}
              </div>
            </div>
          )}

          {post.image_url && (
            <button onClick={handleDownload} disabled={downloading} style={{ width: '100%', marginTop: 10, padding: '9px 0', borderRadius: 7, border: '0.5px solid ' + PALETTE.border, background: downloading ? PALETTE.creamDark : '#fff', color: PALETTE.espresso, fontFamily: F.body, fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.15s' }}
              onMouseEnter={e => { if (!downloading) { e.currentTarget.style.background = PALETTE.espresso; e.currentTarget.style.color = PALETTE.cream } }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = PALETTE.espresso }}
            >
              {downloading ? 'Downloading…' : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> {Array.isArray(post.images) && post.images.length > 1 ? 'Download all assets (' + post.images.length + ')' : 'Download asset'}</>}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
        {[
          ['details', 'Details'],
          ['comments', 'Comments' + (comments.length > 0 ? ' (' + comments.length + ')' : '')],
          ['history', 'History' + ((versions.length + statusChanges.length + comments.length) > 0 ? ' (' + (versions.length + statusChanges.length + comments.length + 1) + ')' : '')]
        ].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ flex: 1, padding: '11px 0', border: 'none', background: 'transparent', fontFamily: F.body, fontSize: 10, fontWeight: activeTab === k ? 500 : 400, color: activeTab === k ? PALETTE.espresso : PALETTE.muted, borderBottom: activeTab === k ? '1.5px solid ' + PALETTE.caramel : '1.5px solid transparent', transition: 'all 0.15s', letterSpacing: '0.03em' }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: '18px' }}>
        {activeTab === 'details' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, textTransform: 'uppercase' }}>Details</span>
              {!editing
                ? <button onClick={() => setEditing(true)} style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 5, padding: '4px 12px', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = PALETTE.creamDark; e.currentTarget.style.color = PALETTE.espresso }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = PALETTE.muted }}
                  >Edit</button>
                : <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setEditing(false)} style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 5, padding: '4px 10px', fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>Cancel</button>
                    <button onClick={saveEdit} disabled={saving || !editCaption.trim() || !editDesigner.trim()} style={{ background: PALETTE.espresso, border: 'none', borderRadius: 5, padding: '4px 12px', fontFamily: F.body, fontSize: 11, color: PALETTE.cream, opacity: saving || !editCaption.trim() || !editDesigner.trim() ? 0.5 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
                  </div>
              }
            </div>

            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>Platform</label>
                  <PlatformPicker selected={editPlatforms} onChange={setEditPlatforms} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Format</label>
                    <select value={editFormat} onChange={e => setEditFormat(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                      {FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                    </select>
                  </div>
                  {editFormat === 'carousel' && <div><label style={labelStyle}>Slides</label><input type="number" min="2" max="20" value={editSlideCount} onChange={e => setEditSlideCount(e.target.value)} placeholder="e.g. 4" style={inputStyle} /></div>}
                </div>
                <div><label style={{ ...labelStyle, color: !editDesigner.trim() ? '#C0392B' : PALETTE.mutedLight }}>Assigned to <span style={{ color: '#C0392B' }}>*</span></label>
                  <select value={editDesigner} onChange={e => setEditDesigner(e.target.value)} style={{ ...inputStyle, borderColor: !editDesigner.trim() ? '#F4A59F' : PALETTE.border }}>
                    <option value="">Select a team member</option>
                    {teamMembers.map(tm => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
                  </select>
                </div>
                <div><label style={labelStyle}>Content Pillar (optional)</label><input value={editCampaign} onChange={e => setEditCampaign(e.target.value)} placeholder="e.g. Behind the Scenes" style={inputStyle} /></div>
                <div>
                  <label style={labelStyle}>Caption</label>
                  <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                  <div style={{ fontFamily: F.body, fontSize: 9, color: editCaption.length > 2200 ? '#C0392B' : PALETTE.mutedLight, textAlign: 'right', marginTop: 2 }}>{editCaption.length} / 2,200</div>
                </div>
                <div><label style={labelStyle}>Scheduled</label><input type="datetime-local" value={editScheduled} onChange={e => setEditScheduled(e.target.value)} style={inputStyle} /></div>
              </div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {/* Client — not editable */}
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'start' }}>
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>Client</span>
                  <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}>{client?.name}</span>
                </div>

                {/* Platform — click to reveal the picker inline, saves on every toggle */}
                <div onClick={() => inlineField !== 'platforms' && setInlineField('platforms')} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'start', padding: '3px 6px', margin: '0 -6px 4px', borderRadius: 5, cursor: inlineField === 'platforms' ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (inlineField !== 'platforms') e.currentTarget.style.background = PALETTE.creamMid }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>Platform</span>
                  {inlineField === 'platforms' ? (
                    <div onClick={e => e.stopPropagation()}>
                      <PlatformPicker selected={editPlatforms} onChange={next => { setEditPlatforms(next); saveInlineField('platforms', next, 'changed the platform to ' + formatPlatforms(next)) }} />
                    </div>
                  ) : (
                    <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}>{formatPlatforms(post.platforms)}</span>
                  )}
                </div>

                {/* Format */}
                <div onClick={() => inlineField !== 'format' && setInlineField('format')} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'center', padding: '3px 6px', margin: '0 -6px 4px', borderRadius: 5, cursor: inlineField === 'format' ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (inlineField !== 'format') e.currentTarget.style.background = PALETTE.creamMid }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Format</span>
                  {inlineField === 'format' ? (
                    <select autoFocus value={editFormat} onChange={e => { setEditFormat(e.target.value); saveInlineField('format', e.target.value, 'changed the format to ' + e.target.value.charAt(0).toUpperCase() + e.target.value.slice(1)) }} onBlur={() => setInlineField(null)} onClick={e => e.stopPropagation()} style={{ ...inputStyle, padding: '4px 8px' }}>
                      {FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}>{formatLabel}</span>
                  )}
                </div>

                {/* Assigned to */}
                <div onClick={() => inlineField !== 'designer' && setInlineField('designer')} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'center', padding: '3px 6px', margin: '0 -6px 4px', borderRadius: 5, cursor: inlineField === 'designer' ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (inlineField !== 'designer') e.currentTarget.style.background = PALETTE.creamMid }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Assigned to</span>
                  {inlineField === 'designer' ? (
                    <select autoFocus value={editDesigner} onChange={e => { setEditDesigner(e.target.value); saveInlineField('designer', e.target.value, 'changed who\'s assigned to ' + e.target.value) }} onBlur={() => setInlineField(null)} onClick={e => e.stopPropagation()} style={{ ...inputStyle, padding: '4px 8px' }}>
                      <option value="">Select a team member</option>
                      {teamMembers.map(tm => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontFamily: F.body, fontSize: 12, color: post.designer ? PALETTE.espresso : PALETTE.mutedLight, fontStyle: post.designer ? 'normal' : 'italic' }}>{post.designer || 'Not set'}</span>
                  )}
                </div>

                {/* Content Pillar */}
                <div onClick={() => inlineField !== 'campaign' && setInlineField('campaign')} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'center', padding: '3px 6px', margin: '0 -6px 4px', borderRadius: 5, cursor: inlineField === 'campaign' ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (inlineField !== 'campaign') e.currentTarget.style.background = PALETTE.creamMid }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Content Pillar</span>
                  {inlineField === 'campaign' ? (
                    <input
                      autoFocus value={editCampaign} onChange={e => setEditCampaign(e.target.value)} onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } if (e.key === 'Escape') { setEditCampaign(post.campaign || ''); setInlineField(null) } }}
                      onBlur={() => saveInlineField('campaign', editCampaign.trim() || null, 'updated the content pillar')}
                      placeholder="e.g. Behind the Scenes" style={{ ...inputStyle, padding: '4px 8px' }}
                    />
                  ) : (
                    <span style={{ fontFamily: F.body, fontSize: 12, color: post.campaign ? PALETTE.espresso : PALETTE.mutedLight, fontStyle: post.campaign ? 'normal' : 'italic' }}>{post.campaign || 'Not set'}</span>
                  )}
                </div>

                {/* Scheduled */}
                <div onClick={() => inlineField !== 'scheduled' && setInlineField('scheduled')} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 4, alignItems: 'center', padding: '3px 6px', margin: '0 -6px 4px', borderRadius: 5, cursor: inlineField === 'scheduled' ? 'default' : 'pointer' }}
                  onMouseEnter={e => { if (inlineField !== 'scheduled') e.currentTarget.style.background = PALETTE.creamMid }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Scheduled</span>
                  {inlineField === 'scheduled' ? (
                    <input
                      autoFocus type="datetime-local" value={editScheduled} onChange={e => setEditScheduled(e.target.value)} onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Escape') { setEditScheduled(toLocalInputValue(post.scheduled_at)); setInlineField(null) } }}
                      onBlur={() => { if (editScheduled) saveInlineField('scheduled_at', new Date(editScheduled).toISOString(), 'changed the scheduled time to ' + fmt(new Date(editScheduled).toISOString())); else setInlineField(null) }}
                      style={{ ...inputStyle, padding: '4px 8px' }}
                    />
                  ) : (
                    <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}>{fmt(post.scheduled_at)}</span>
                  )}
                </div>
              </div>
            )}

            <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />

            {post.status !== 'archived' && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, textTransform: 'uppercase' }}>Design Options</span>
                  {post.selected_option_id && <span style={{ fontFamily: F.body, fontSize: 10, color: '#2A7D4F', fontWeight: 500 }}>Client picked one ✓</span>}
                </div>
                <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginBottom: 10, lineHeight: 1.5 }}>
                  {post.selected_option_id
                    ? 'The client already chose their favorite — it\'s now the post\'s asset above.'
                    : 'Upload a few design directions and the client will pick their favorite instead of the usual approve/revise flow.'}
                </div>
                {designOptions.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                    {designOptions.map(opt => (
                      <div key={opt.id} style={{ position: 'relative' }}>
                        <div style={{ aspectRatio: '1', borderRadius: 6, overflow: 'hidden', border: '1.5px solid ' + (opt.id === post.selected_option_id ? '#2A7D4F' : PALETTE.borderLight), background: PALETTE.creamDark }}>
                          {isVideo(opt.image_url)
                            ? <video src={opt.image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted />
                            : <img src={opt.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          }
                        </div>
                        <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginTop: 3, textAlign: 'center' }}>{opt.label}</div>
                        {opt.id === post.selected_option_id && (
                          <div style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: '#2A7D4F', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9 }}>✓</div>
                        )}
                        {!post.selected_option_id && (
                          <button onClick={() => deleteDesignOption(opt.id)} style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', fontSize: 10, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!post.selected_option_id && (
                  <>
                    <button onClick={() => optionsFileRef.current.click()} disabled={uploadingOptions} style={{ width: '100%', padding: '8px 0', borderRadius: 6, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>
                      {uploadingOptions ? 'Uploading...' : '+ Add design option(s)'}
                    </button>
                    <input ref={optionsFileRef} type="file" accept="image/*,video/*" multiple onChange={handleAddDesignOptions} style={{ display: 'none' }} />
                  </>
                )}
              </div>
            )}

            <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />

            {post.status !== 'archived' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 10, textTransform: 'uppercase' }}>Update Status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                  {['draft', 'pending', 'approved', 'scheduled', 'revision', 'published'].map(k => {
                    const s = STATUS[k]
                    const labels = { draft: 'Move back to draft (hide from client)', pending: post.status === 'draft' ? 'Send to client for review' : 'Reset to pending', approved: 'Mark as approved', scheduled: 'Mark as scheduled', revision: 'Request revisions', published: 'Mark as published' }
                    const isCurrent = post.status === k
                    return (
                      <button key={k} onClick={() => updateStatus(k)} style={{ padding: '8px 12px', borderRadius: 6, border: '0.5px solid ' + (isCurrent ? s.dot : PALETTE.borderLight), background: isCurrent ? s.bg : '#fff', color: isCurrent ? s.color : PALETTE.muted, fontWeight: isCurrent ? 500 : 400, fontSize: 11, fontFamily: F.body, textAlign: 'left', transition: 'all 0.15s' }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = PALETTE.creamMid }}
                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = '#fff' }}
                      >{labels[k]}</button>
                    )
                  })}
                </div>
                <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, textAlign: 'center', letterSpacing: '0.05em' }}>{statusLine(post.status)}</div>
              </div>
            )}

            <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              {post.status !== 'archived' && (
                <button onClick={archivePost} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >Archive</button>
              )}
              <button onClick={deletePost} style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', background: '#FEECEA', fontFamily: F.body, fontSize: 11, color: '#9B2B20', fontWeight: 500 }}>Delete post</button>
            </div>
          </div>
        )}

        {activeTab === 'comments' && (
          <div>
            {comments.length === 0
              ? <p style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', margin: '0 0 16px', lineHeight: 1.6 }}>No comments yet.</p>
              : comments.map(c => (
                <div key={c.id} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '0.5px dashed ' + PALETTE.borderLight }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'baseline' }}>
                    <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 500, color: PALETTE.espresso }}>{c.author_type === 'agency' ? (c.author || 'Brown Butter') : c.author + (client ? ' (' + client.name + ')' : '')}</span>
                    <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{fmtShort(c.created_at)}</span>
                  </div>
                  <p style={{ margin: 0, fontFamily: F.body, fontSize: 13, color: PALETTE.espressoLight, lineHeight: 1.65 }}>{c.text}</p>
                </div>
              ))
            }
            <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: '10px 14px', marginTop: 8 }}>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={handleKeyDown} placeholder="Leave a note..." rows={3} style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 13, color: PALETTE.espresso, resize: 'none', fontFamily: F.body, lineHeight: 1.6 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid ' + PALETTE.borderLight }}>
                <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>⌘ + Enter to send</span>
                <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{ padding: '6px 14px', borderRadius: 5, border: '0.5px solid ' + PALETTE.border, background: newComment.trim() ? PALETTE.espresso : '#fff', color: newComment.trim() ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 12, opacity: saving ? 0.5 : 1, transition: 'all 0.15s' }}>Post comment</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (() => {
          // Build a unified activity timeline from versions, logged status changes, and comments
          const timeline = []

          // Post edits from versions table — caption, schedule, asset, designer, pillar, etc.
          versions.forEach(v => {
            const note = v.note || 'updated this post'
            const icon = note.includes('caption') ? '✎'
              : note.includes('scheduled time') ? '🕐'
              : note.includes('format') ? '▦'
              : note.includes('assigned to') ? '🧑'
              : note.includes('content pillar') ? '🏷'
              : note.includes('platform') ? '📣'
              : note.includes('asset') ? '🖼'
              : note.includes('cover photo') ? '🎞'
              : '✎'
            timeline.push({
              ts: new Date(v.created_at).getTime(),
              date: v.created_at,
              icon,
              iconColor: PALETTE.muted,
              iconBg: PALETTE.creamDark,
              who: v.author || 'Brown Butter',
              action: note,
              detail: null,
              tag: null,
            })
          })

          // Every logged status change, in order — not just the current status
          const statusEvents = {
            approved:  { icon: '✓', iconColor: '#2A7D4F', iconBg: '#E8F8EE', action: 'approved this post' },
            scheduled: { icon: '◷', iconColor: '#1E4E8A', iconBg: '#E8F1FC', action: 'marked as scheduled' },
            revision:  { icon: '↩', iconColor: '#C0392B', iconBg: '#FEECEA', action: 'requested revisions' },
            published: { icon: '✦', iconColor: PALETTE.caramel, iconBg: PALETTE.caramelLight, action: 'marked as published' },
            pending:   { icon: '○', iconColor: PALETTE.muted, iconBg: PALETTE.creamDark, action: 'reset to pending' },
            draft:     { icon: '✎', iconColor: PALETTE.muted, iconBg: PALETTE.creamDark, action: 'saved this as a draft' },
          }
          statusChanges.forEach(sc => {
            const ev = statusEvents[sc.status]
            if (!ev) return
            timeline.push({
              ts: new Date(sc.created_at).getTime(),
              date: sc.created_at,
              icon: ev.icon,
              iconColor: ev.iconColor,
              iconBg: ev.iconBg,
              who: sc.changed_by || 'Brown Butter',
              action: ev.action,
              detail: null,
              tag: null,
            })
          })

          // Safety net: if the post's current status was set without a logged change
          // (created as approved, changed from another screen, older posts), still show it.
          if (statusEvents[post.status] && post.status !== 'pending' && !statusChanges.some(sc => sc.status === post.status)) {
            const ev = statusEvents[post.status]
            const when = post.updated_at || post.created_at
            timeline.push({ ts: new Date(when).getTime(), date: when, icon: ev.icon, iconColor: ev.iconColor, iconBg: ev.iconBg, who: 'Brown Butter', side: 'team', action: ev.action, detail: null, tag: null })
          }

          // Every comment, from both the agency and the client
          comments.forEach(c => {
            timeline.push({
              ts: new Date(c.created_at).getTime(),
              date: c.created_at,
              icon: '💬',
              iconColor: PALETTE.espresso,
              iconBg: PALETTE.creamMid,
              who: c.author_type === 'agency' ? (c.author || 'Brown Butter') : (c.author || client?.name || 'Client'),
              side: c.author_type === 'agency' ? 'team' : 'client',
              action: 'commented',
              detail: c.text ? (c.text.length > 140 ? c.text.slice(0, 140) + '…' : c.text) : null,
              tag: null,
            })
          })

          // Post created entry
          timeline.push({
            ts: new Date(post.created_at).getTime(),
            date: post.created_at,
            icon: '+',
            iconColor: PALETTE.caramel,
            iconBg: PALETTE.caramelLight,
            who: post.created_by || 'Brown Butter',
            side: 'team',
            action: 'created this post',
            detail: null,
            tag: null,
          })

          timeline.sort((a, b) => b.ts - a.ts)

          if (timeline.length === 0) {
            return <p style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', margin: 0, lineHeight: 1.6 }}>No history yet.</p>
          }

          return (
            <div style={{ position: 'relative' }}>
              {/* Vertical line */}
              <div style={{ position: 'absolute', left: 13, top: 6, bottom: 6, width: 1, background: PALETTE.borderLight }} />
              {timeline.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 20, position: 'relative' }}>
                  {/* Avatar (team) or brand logo (client), with the event icon as a small badge */}
                  <div style={{ position: 'relative', width: 26, height: 26, flexShrink: 0, zIndex: 1 }}>
                    <Avatar size={26} actor={resolveActor({ who: item.who, side: item.side, members: teamMembers, client, currentUserName, currentUserAvatarUrl: null })} />
                    <div style={{ position: 'absolute', right: -4, bottom: -4, width: 14, height: 14, borderRadius: '50%', background: item.iconBg, border: '1px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: item.iconColor, fontWeight: 700 }}>{item.icon}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 500 }}>{item.who}</span>
                      {' '}{item.action}
                      {item.tag && <span style={{ fontFamily: F.display, fontSize: 11, color: item.tagColor, marginLeft: 5 }}>{item.tag}</span>}
                    </div>
                    {item.detail && (
                      <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginTop: 4, lineHeight: 1.5, background: PALETTE.creamMid, borderRadius: 5, padding: '5px 8px', borderLeft: '2px solid ' + PALETTE.border }}>{item.detail}</div>
                    )}
                    <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 3 }}>{fmtAgo(item.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function ComposeModal({ clients, teamMembers, onClose, onSaved, currentUserName }) {
  const [clientId, setClientId] = useState(clients[0]?.id || '')
  const [caption, setCaption] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [format, setFormat] = useState('post')
  const [platforms, setPlatforms] = useState(['instagram'])
  const [slideCount, setSlideCount] = useState('')
  const [designer, setDesigner] = useState('')
  const [campaign, setCampaign] = useState('')
  const [images, setImages] = useState([])
  const [coverUrl, setCoverUrl] = useState('')
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [importingDrive, setImportingDrive] = useState(false)
  const [designOptionUrls, setDesignOptionUrls] = useState([])
  const [uploadingOptions, setUploadingOptions] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()
  const coverFileRef = useRef()
  const optionsFileRef = useRef()

  const processFiles = async (files) => {
    if (!files || !files.length) return
    setUploadError(null); setUploading(true)
    const { urls, error } = await uploadMultiple(files)
    if (urls.length) setImages(prev => [...prev, ...urls])
    if (error) setUploadError(error)
    setUploading(false)
  }

  const handleFile = async (e) => {
    await processFiles(e.target.files)
  }

  const handleDriveImport = async () => {
    setUploadError(null); setImportingDrive(true)
    try {
      const files = await pickFilesFromDrive({ multiple: format === 'carousel' })
      await processFiles(files)
    } catch (err) {
      console.error('Drive import error:', err)
      setUploadError('Could not import from Drive. Please try again.')
    }
    setImportingDrive(false)
  }

  const handleAddDesignOptions = async (e) => {
    const files = e.target.files
    if (!files || !files.length) return
    setUploadingOptions(true)
    const { urls, error } = await uploadMultiple(files)
    if (urls.length) setDesignOptionUrls(prev => [...prev, ...urls])
    if (error) setUploadError(error)
    setUploadingOptions(false)
  }

  const removeDesignOption = (i) => setDesignOptionUrls(prev => prev.filter((_, idx) => idx !== i))

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    const { url, error } = await uploadAsset(file)
    if (url) setCoverUrl(url)
    if (error) setUploadError(error)
    setUploadingCover(false)
  }

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i))

  const canSave = caption.trim() && scheduledAt && clientId && designer.trim()

  const handleSave = async (status = 'pending') => {
    if (!canSave) return; setSaving(true)
    const { data: newPost, error } = await supabase.from('posts').insert({
      client_id: clientId, caption: caption.trim(), scheduled_at: new Date(scheduledAt).toISOString(),
      image_url: images[0] || null,
      images: format === 'carousel' && images.length > 1 ? images : null,
      cover_url: images[0] && isVideo(images[0]) ? (coverUrl || null) : null,
      platforms, status, format,
      slide_count: format === 'carousel' ? (images.length || (slideCount ? parseInt(slideCount) : null)) : null,
      designer: designer.trim(), campaign: campaign.trim() || null,
      created_by: currentUserName
    }).select().single()

    if (error) {
      console.error('Post creation error:', error)
      setSaving(false)
      alert('Could not create the post: ' + error.message)
      return
    }

    if (newPost && designOptionUrls.length > 0) {
      const { error: optError } = await supabase.from('design_options').insert(
        designOptionUrls.map((url, i) => ({ post_id: newPost.id, image_url: url, label: 'Option ' + (i + 1) }))
      )
      if (optError) console.error('Design option insert error:', optError)
    }

    if (newPost && status !== 'pending') {
      await supabase.from('status_changes').insert({ post_id: newPost.id, status, changed_by: currentUserName })
    }

    setSaving(false); onSaved(); onClose()
  }

  const fieldLabel = (text, required) => <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>{text} {required && <span style={{ color: '#C0392B' }}>*</span>}</div>
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 13, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,31,14,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', WebkitOverflowScrolling: 'touch', boxShadow: '0 20px 60px rgba(44,31,14,0.2)' }}>
        <div style={{ padding: '16px 22px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PALETTE.espresso, borderRadius: '14px 14px 0 0' }}>
          <span style={{ fontFamily: F.display, color: PALETTE.cream, fontSize: 17 }}>New Post</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: PALETTE.cream, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>{fieldLabel('Client', true)}<select value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div>{fieldLabel('Platform')}<PlatformPicker selected={platforms} onChange={setPlatforms} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{fieldLabel('Format')}<select value={format} onChange={e => setFormat(e.target.value)} style={inputStyle}>{FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}</select></div>
            {format === 'carousel' && <div>{fieldLabel('Slides')}<input type="number" min="2" max="20" value={slideCount} onChange={e => setSlideCount(e.target.value)} placeholder="e.g. 4" style={inputStyle} /></div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{fieldLabel('Assigned to', true)}
              <select value={designer} onChange={e => setDesigner(e.target.value)} style={{ ...inputStyle, borderColor: !designer.trim() ? '#F4A59F' : PALETTE.border }}>
                <option value="">Select a team member</option>
                {teamMembers.map(tm => <option key={tm.id} value={tm.name}>{tm.name}</option>)}
              </select>
            </div>
            <div>{fieldLabel('Content Pillar (optional)')}<input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. Behind the Scenes" style={inputStyle} /></div>
          </div>
          <div>
            {fieldLabel(format === 'carousel' ? 'Assets (select multiple for carousel)' : 'Asset')}
            {uploading && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, marginBottom: 6 }}>Uploading...</div>}
            {uploadError && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', marginBottom: 6 }}>{uploadError}</div>}
            <MultiAssetPreview urls={images} onRemove={removeImage} />
            <div onClick={() => fileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 8, padding: '22px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
              <div style={{ fontFamily: F.body, fontSize: 22, color: PALETTE.caramel, marginBottom: 4 }}>+</div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>{format === 'carousel' ? 'Click to upload photos (select multiple)' : 'Click to upload'}</div>
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 3 }}>Image, GIF, or video · max 80MB each</div>
            </div>
            <button type="button" onClick={handleDriveImport} disabled={importingDrive} style={{ width: '100%', marginTop: 8, padding: '9px 0', borderRadius: 7, border: '0.5px solid ' + PALETTE.border, background: '#fff', color: PALETTE.espresso, fontFamily: F.body, fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8.6 15l3.43-5.94L19.4 15H8.6z" fill="#EA4335"/><path d="M1.15 15L7.71 3.5 11.14 9 4.58 20.94 1.15 15z" fill="#4285F4"/><path d="M1.15 15h11.4l3.43 5.94H4.58L1.15 15z" fill="#34A853"/><path d="M7.71 3.5h5.15L19.4 15H8.6L7.71 3.5z" fill="#FBBC04"/></svg>
              {importingDrive ? 'Importing from Drive...' : 'Import from Google Drive'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*,.gif" multiple={format === 'carousel'} onChange={handleFile} style={{ display: 'none' }} />
          </div>
          {images[0] && isVideo(images[0]) && (
            <div>
              {fieldLabel('Cover photo (optional)')}
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 8, lineHeight: 1.5 }}>Videos can't auto-generate a thumbnail — upload a still so this shows properly in grid previews instead of a black box.</div>
              {uploadingCover && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, marginBottom: 6 }}>Uploading...</div>}
              {coverUrl ? (
                <AssetPreview url={coverUrl} onRemove={() => setCoverUrl('')} maxHeight={120} />
              ) : (
                <div onClick={() => coverFileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 8, padding: '16px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>+ Upload cover image</div>
                </div>
              )}
              <input ref={coverFileRef} type="file" accept="image/*" onChange={handleCoverFile} style={{ display: 'none' }} />
            </div>
          )}
          <div>
            {fieldLabel('Design Options (optional)')}
            <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 8, lineHeight: 1.5 }}>Instead of a single final asset, upload a few directions and the client picks their favorite — that pick becomes the post's asset and approves it in one step.</div>
            {designOptionUrls.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                {designOptionUrls.map((url, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <AssetPreview url={url} onRemove={() => removeDesignOption(i)} maxHeight={90} />
                    <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 9, padding: '1px 5px', borderRadius: 3, fontFamily: F.body }}>Option {i + 1}</div>
                  </div>
                ))}
              </div>
            )}
            {uploadingOptions && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, marginBottom: 6 }}>Uploading...</div>}
            <div onClick={() => optionsFileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 8, padding: '16px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
              <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>+ Add design option(s)</div>
            </div>
            <input ref={optionsFileRef} type="file" accept="image/*,video/*" multiple onChange={handleAddDesignOptions} style={{ display: 'none' }} />
          </div>
          <div>{fieldLabel('Caption', true)}<textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write your caption..." rows={4} style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }} /><div style={{ fontFamily: F.body, fontSize: 9, color: caption.length > 2200 ? '#C0392B' : PALETTE.mutedLight, textAlign: 'right', marginTop: 2 }}>{caption.length} / 2,200</div></div>
          <div>{fieldLabel('Schedule date and time', true)}<input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={inputStyle} /></div>
          <button onClick={() => handleSave('pending')} disabled={saving || !canSave} style={{ padding: '12px 0', borderRadius: 8, border: 'none', background: canSave ? PALETTE.espresso : PALETTE.creamDark, color: canSave ? PALETTE.cream : PALETTE.mutedLight, fontFamily: F.body, fontSize: 13, fontWeight: 500, cursor: canSave ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}>{saving ? 'Saving...' : 'Send to Client for Review'}</button>
          <button onClick={() => handleSave('draft')} disabled={saving || !canSave} title="Saves the post for the team only. The client won't see it until you send it for review." style={{ padding: '11px 0', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: '#fff', color: canSave ? PALETTE.espresso : PALETTE.mutedLight, fontFamily: F.body, fontSize: 13, fontWeight: 500, cursor: canSave ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}>Save as draft (hidden from client)</button>
          {!designer.trim() && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', textAlign: 'center', marginTop: -8 }}>Assigned to is required</div>}
        </div>
      </div>
    </div>
  )
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
    setLoading(false)
  }

  const inputStyle = { width: '100%', padding: '12px 14px', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 14, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }

  return (
    <div className="bb-app-shell" style={{ background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={handleLogin} style={{ width: '100%', maxWidth: 340 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontFamily: F.display, fontSize: 26, color: PALETTE.espresso, marginBottom: 4 }}>Brown Butter</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Team Workspace</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
          <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
          {error && <div style={{ fontFamily: F.body, fontSize: 12, color: '#C0392B', textAlign: 'center' }}>{error}</div>}
          <button type="submit" disabled={loading || !email.trim() || !password} style={{ padding: '12px 0', borderRadius: 8, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontFamily: F.body, fontSize: 14, fontWeight: 500, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, textAlign: 'center', marginTop: 20 }}>Need an account? Ask whoever set up the dashboard to add you in Supabase.</div>
      </form>
    </div>
  )
}

// Lightweight rich text editor for meeting notes — uses the browser's own
// contentEditable + formatting commands rather than pulling in a whole
// editor library. Stores/returns HTML; keep it to simple formatting only
// (bold, italic, bullet/numbered lists) since that's all the toolbar exposes.
function RichTextEditor({ value, onChange, placeholder }) {
  const editorRef = useRef()
  const initialized = useRef(false)

  useEffect(() => {
    if (editorRef.current && !initialized.current) {
      editorRef.current.innerHTML = value || ''
      initialized.current = true
    }
  }, [])

  const exec = (command) => {
    editorRef.current.focus()
    document.execCommand(command, false, null)
    onChange(editorRef.current.innerHTML)
  }

  const toolbarBtnStyle = { background: '#fff', border: '0.5px solid ' + PALETTE.border, borderRadius: 5, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('bold')} style={{ ...toolbarBtnStyle, fontWeight: 700 }}>B</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('italic')} style={{ ...toolbarBtnStyle, fontStyle: 'italic' }}>I</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('insertUnorderedList')} style={toolbarBtnStyle}>•≡</button>
        <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => exec('insertOrderedList')} style={toolbarBtnStyle}>1≡</button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={e => onChange(e.currentTarget.innerHTML)}
        data-placeholder={placeholder || ''}
        className="bb-rich-text"
        style={{ width: '100%', minHeight: 120, padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body, lineHeight: 1.6, boxSizing: 'border-box', overflowY: 'auto' }}
      />
    </div>
  )
}

// Links helpers: tidy accidental "https://https://" URLs, label the destination
// (Google Docs, Canva...), and group by the custom category the team typed.
const fixUrl = (u) => (u || '').replace(/^https?:\/\/(https?:\/\/)/i, '$1')
const linkSite = (url) => {
  try {
    const u = new URL(fixUrl(url))
    const h = u.hostname.replace(/^www\./, '')
    if (h === 'docs.google.com') {
      if (u.pathname.startsWith('/spreadsheets')) return 'Google Sheets'
      if (u.pathname.startsWith('/presentation')) return 'Google Slides'
      if (u.pathname.startsWith('/forms')) return 'Google Forms'
      return 'Google Docs'
    }
    if (h === 'drive.google.com') return 'Google Drive'
    if (h.includes('canva.')) return 'Canva'
    if (h.includes('figma.com')) return 'Figma'
    if (h.includes('notion.')) return 'Notion'
    if (h.includes('dropbox.com')) return 'Dropbox'
    if (h.includes('youtube.com') || h === 'youtu.be') return 'YouTube'
    if (h.includes('airtable.com')) return 'Airtable'
    return h
  } catch { return 'Open link' }
}
const LINK_UNCAT = 'Other'
const groupLinks = (links) => {
  const map = new Map()
  links.forEach(l => {
    const raw = (l.category || '').trim() || LINK_UNCAT
    const key = raw.toLowerCase()
    if (!map.has(key)) map.set(key, { name: raw, items: [] })
    map.get(key).items.push(l)
  })
  return [...map.values()].sort((a, b) => a.name === LINK_UNCAT ? 1 : b.name === LINK_UNCAT ? -1 : a.name.localeCompare(b.name))
}

function ClientHubView({ client, onClose, initialTab, onClientUpdated, currentUserEmail }) {
  const canBilling = canAccessBilling(currentUserEmail)
  const [tab, setTab] = useState((initialTab === 'billing' && !canBilling) ? 'notes' : (initialTab || 'notes')) // 'notes' | 'billing' | 'links'
  const [notes, setNotes] = useState([])
  const [cycles, setCycles] = useState([])
  const [reimbursements, setReimbursements] = useState([])
  const [links, setLinks] = useState([])
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const invoiceFileRef = useRef()
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const receiptFileRef = useRef()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editingNoteId, setEditingNoteId] = useState(null) // null = closed, 'new' = new note, else note id
  const [noteTitle, setNoteTitle] = useState('')
  const [noteDate, setNoteDate] = useState('')
  const [noteBody, setNoteBody] = useState('')

  const [editingCycleId, setEditingCycleId] = useState(null)
  const [cycleStart, setCycleStart] = useState('')
  const [cycleEnd, setCycleEnd] = useState('')
  const [cycleAmount, setCycleAmount] = useState('')
  const [cycleStatus, setCycleStatus] = useState('pending')
  const [cycleInvoiceUrl, setCycleInvoiceUrl] = useState('')
  const [cycleNotes, setCycleNotes] = useState('')

  const [editingReimbursementId, setEditingReimbursementId] = useState(null)
  const [reimbDate, setReimbDate] = useState('')
  const [reimbDescription, setReimbDescription] = useState('')
  const [reimbAmount, setReimbAmount] = useState('')
  const [reimbStatus, setReimbStatus] = useState('pending')
  const [reimbReceiptUrl, setReimbReceiptUrl] = useState('')
  const [reimbNotes, setReimbNotes] = useState('')

  const [editingLinkId, setEditingLinkId] = useState(null)
  const [linkTitle, setLinkTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkCategory, setLinkCategory] = useState('')
  const [linkFilter, setLinkFilter] = useState('all')

  const fetchHub = async () => {
    setLoading(true)
    const [n, c, r, l] = await Promise.all([
      supabase.from('meeting_notes').select('*').eq('client_id', client.id).order('meeting_date', { ascending: false }),
      supabase.from('billing_cycles').select('*').eq('client_id', client.id).order('cycle_start', { ascending: false }),
      supabase.from('reimbursements').select('*').eq('client_id', client.id).order('date', { ascending: false }),
      supabase.from('important_links').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    ])
    if (n.data) setNotes(n.data)
    if (c.data) setCycles(c.data)
    if (r.data) setReimbursements(r.data)
    if (l.data) setLinks(l.data)
    setLoading(false)
  }

  useEffect(() => { fetchHub() }, [client.id])

  const startNewNote = () => { setEditingNoteId('new'); setNoteTitle(''); setNoteDate(new Date().toISOString().slice(0, 10)); setNoteBody('') }
  const startEditNote = (n) => { setEditingNoteId(n.id); setNoteTitle(n.title); setNoteDate(n.meeting_date); setNoteBody(renderNoteBody(n.body)) }

  const saveNote = async () => {
    if (!noteTitle.trim() || !noteDate) return
    setSaving(true)
    if (editingNoteId === 'new') {
      await supabase.from('meeting_notes').insert({ client_id: client.id, title: noteTitle.trim(), meeting_date: noteDate, body: noteBody.trim() })
    } else {
      await supabase.from('meeting_notes').update({ title: noteTitle.trim(), meeting_date: noteDate, body: noteBody.trim() }).eq('id', editingNoteId)
    }
    setSaving(false); setEditingNoteId(null)
    fetchHub()
  }

  const deleteNote = async (id) => {
    if (!window.confirm('Delete this meeting note?')) return
    await supabase.from('meeting_notes').delete().eq('id', id)
    fetchHub()
  }

  const startNewLink = () => { setEditingLinkId('new'); setLinkTitle(''); setLinkUrl(''); setLinkCategory(linkFilter !== 'all' && linkFilter !== LINK_UNCAT ? linkFilter : '') }
  const startEditLink = (l) => { setEditingLinkId(l.id); setLinkTitle(l.title); setLinkUrl(fixUrl(l.url)); setLinkCategory(l.category || '') }

  const saveLink = async () => {
    if (!linkTitle.trim() || !linkUrl.trim()) return
    setSaving(true)
    const url = fixUrl(/^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : 'https://' + linkUrl.trim())
    const category = linkCategory.trim() || null
    if (editingLinkId === 'new') {
      await supabase.from('important_links').insert({ client_id: client.id, title: linkTitle.trim(), url, category })
    } else {
      await supabase.from('important_links').update({ title: linkTitle.trim(), url, category }).eq('id', editingLinkId)
    }
    setSaving(false); setEditingLinkId(null)
    fetchHub()
  }

  const deleteLink = async (id) => {
    if (!window.confirm('Delete this link?')) return
    await supabase.from('important_links').delete().eq('id', id)
    fetchHub()
  }

  const handleInvoiceUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingInvoice(true)
    const { url, error } = await uploadAsset(file)
    if (url) setCycleInvoiceUrl(url)
    if (error) alert('Could not upload invoice: ' + error)
    setUploadingInvoice(false)
    e.target.value = ''
  }

  const invoiceFileName = (url) => {
    if (!url) return ''
    try { return decodeURIComponent(url.split('/').pop().split('?')[0]) } catch { return url }
  }

  const startNewCycle = () => { setEditingCycleId('new'); setCycleStart(''); setCycleEnd(''); setCycleAmount(''); setCycleStatus('pending'); setCycleInvoiceUrl(''); setCycleNotes('') }
  const startEditCycle = (c) => { setEditingCycleId(c.id); setCycleStart(c.cycle_start); setCycleEnd(c.cycle_end); setCycleAmount(c.amount ?? ''); setCycleStatus(c.status || 'pending'); setCycleInvoiceUrl(c.invoice_url || ''); setCycleNotes(c.notes || '') }

  const saveCycle = async () => {
    if (!cycleStart || !cycleEnd) return
    setSaving(true)
    const payload = {
      client_id: client.id, cycle_start: cycleStart, cycle_end: cycleEnd,
      amount: cycleAmount ? parseFloat(cycleAmount) : null, status: cycleStatus,
      invoice_url: cycleInvoiceUrl.trim() || null, notes: cycleNotes.trim() || null
    }
    if (editingCycleId === 'new') {
      await supabase.from('billing_cycles').insert(payload)
    } else {
      await supabase.from('billing_cycles').update(payload).eq('id', editingCycleId)
    }
    setSaving(false); setEditingCycleId(null)
    fetchHub()
  }

  const deleteCycle = async (id) => {
    if (!window.confirm('Delete this billing cycle?')) return
    await supabase.from('billing_cycles').delete().eq('id', id)
    fetchHub()
  }

  // Reimbursements — money Brown Butter owes back to the client (ad spend
  // they fronted, event/prop costs, etc.), distinct from billing_cycles
  // which is money the client owes Brown Butter.
  const startNewReimbursement = () => { setEditingReimbursementId('new'); setReimbDate(new Date().toISOString().slice(0, 10)); setReimbDescription(''); setReimbAmount(''); setReimbStatus('pending'); setReimbReceiptUrl(''); setReimbNotes('') }
  const startEditReimbursement = (r) => { setEditingReimbursementId(r.id); setReimbDate(r.date); setReimbDescription(r.description || ''); setReimbAmount(r.amount ?? ''); setReimbStatus(r.status || 'pending'); setReimbReceiptUrl(r.receipt_url || ''); setReimbNotes(r.notes || '') }

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingReceipt(true)
    const { url, error } = await uploadAsset(file)
    if (url) setReimbReceiptUrl(url)
    if (error) alert('Could not upload receipt: ' + error)
    setUploadingReceipt(false)
    e.target.value = ''
  }

  const saveReimbursement = async () => {
    if (!reimbDate || !reimbDescription.trim()) return
    setSaving(true)
    const payload = {
      client_id: client.id, date: reimbDate, description: reimbDescription.trim(),
      amount: reimbAmount ? parseFloat(reimbAmount) : null, status: reimbStatus,
      receipt_url: reimbReceiptUrl.trim() || null, notes: reimbNotes.trim() || null
    }
    if (editingReimbursementId === 'new') {
      await supabase.from('reimbursements').insert(payload)
    } else {
      await supabase.from('reimbursements').update(payload).eq('id', editingReimbursementId)
    }
    setSaving(false); setEditingReimbursementId(null)
    fetchHub()
  }

  const deleteReimbursement = async (id) => {
    if (!window.confirm('Delete this reimbursement?')) return
    await supabase.from('reimbursements').delete().eq('id', id)
    fetchHub()
  }

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }
  const labelStyle = { fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6, display: 'block' }
  const sortedNotes = [...notes].sort((a, b) => new Date(b.meeting_date) - new Date(a.meeting_date))
  const sortedCycles = [...cycles].sort((a, b) => new Date(b.cycle_start) - new Date(a.cycle_start))
  const sortedReimbursements = [...reimbursements].sort((a, b) => new Date(b.date) - new Date(a.date))

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 26px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PALETTE.espresso, flexShrink: 0, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: PALETTE.cream, fontFamily: F.body, fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: 0 }}>
            ← Back
          </button>
          <span style={{ fontFamily: F.display, color: PALETTE.cream, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{client.name} — Client Hub</span>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0, background: '#fff' }}>
        {[['notes', 'Meeting Notes'], ...(canBilling ? [['billing', 'Billing']] : []), ['links', 'Links']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '12px 0', border: 'none', background: 'transparent', fontFamily: F.body, fontSize: 12, fontWeight: tab === k ? 500 : 400, color: tab === k ? PALETTE.espresso : PALETTE.muted, borderBottom: tab === k ? '1.5px solid ' + PALETTE.caramel : '1.5px solid transparent' }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '28px 40px', maxWidth: 760, WebkitOverflowScrolling: 'touch' }}>
          {loading ? (
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, textAlign: 'center', padding: 30 }}>Loading…</div>
          ) : tab === 'notes' ? (
            <div>
              {editingNoteId ? (
                <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><label style={labelStyle}>Title</label><input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="e.g. Q3 Strategy Check-in" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Date</label><input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Notes</label><RichTextEditor key={editingNoteId} value={noteBody} onChange={setNoteBody} placeholder="Write your notes..." /></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingNoteId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                    <button onClick={saveNote} disabled={saving || !noteTitle.trim() || !noteDate} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save note'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={startNewNote} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 16 }}>+ New meeting note</button>
              )}

              {sortedNotes.length === 0 && !editingNoteId && (
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No meeting notes yet.</div>
              )}
              {sortedNotes.map(n => (
                <div key={n.id} style={{ border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 10 }}>
                    <div style={{ fontFamily: F.display, fontSize: 14, color: PALETTE.espresso }}>{n.title}</div>
                    <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, whiteSpace: 'nowrap' }}>{fmtDateLong(n.meeting_date)}</div>
                  </div>
                  <div className="bb-note-body" style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight, lineHeight: 1.6, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: renderNoteBody(n.body) }} />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => startEditNote(n)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                    <button onClick={() => deleteNote(n.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'billing' && !canBilling ? (
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', textAlign: 'center', padding: '30px 0' }}>You don't have access to Billing.</div>
          ) : tab === 'billing' ? (
            <div>
              {editingCycleId ? (
                <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><label style={labelStyle}>Cycle start</label><input type="date" value={cycleStart} onChange={e => setCycleStart(e.target.value)} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Cycle end</label><input type="date" value={cycleEnd} onChange={e => setCycleEnd(e.target.value)} style={inputStyle} /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><label style={labelStyle}>Amount (₱)</label><input type="number" step="0.01" value={cycleAmount} onChange={e => setCycleAmount(e.target.value)} placeholder="e.g. 45000" style={inputStyle} /></div>
                    <div><label style={labelStyle}>Status</label><select value={cycleStatus} onChange={e => setCycleStatus(e.target.value)} style={inputStyle}><option value="pending">Pending</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></div>
                  </div>
                  <div>
                    <label style={labelStyle}>Invoice (optional)</label>
                    {cycleInvoiceUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invoiceFileName(cycleInvoiceUrl)}</span>
                        <a href={cycleInvoiceUrl} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, flexShrink: 0 }}>View</a>
                        <button onClick={() => invoiceFileRef.current.click()} disabled={uploadingInvoice} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, flexShrink: 0 }}>{uploadingInvoice ? 'Uploading…' : 'Replace'}</button>
                        <button onClick={() => setCycleInvoiceUrl('')} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B', flexShrink: 0 }}>Remove</button>
                      </div>
                    ) : (
                      <button onClick={() => invoiceFileRef.current.click()} disabled={uploadingInvoice} style={{ width: '100%', padding: '9px 0', borderRadius: 6, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>
                        {uploadingInvoice ? 'Uploading…' : '+ Upload invoice (PDF or image)'}
                      </button>
                    )}
                    <input ref={invoiceFileRef} type="file" accept="application/pdf,image/*" onChange={handleInvoiceUpload} style={{ display: 'none' }} />
                  </div>
                  <div><label style={labelStyle}>Notes (optional)</label><textarea value={cycleNotes} onChange={e => setCycleNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingCycleId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                    <button onClick={saveCycle} disabled={saving || !cycleStart || !cycleEnd} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save cycle'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={startNewCycle} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 16 }}>+ New billing cycle</button>
              )}

              {sortedCycles.length === 0 && !editingCycleId && (
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No billing cycles yet.</div>
              )}
              {sortedCycles.map(c => (
                <div key={c.id} style={{ border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>{fmtDateLong(c.cycle_start)} – {fmtDateLong(c.cycle_end)}</div>
                    <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: BILLING_STATUS[c.status]?.bg || '#F2F2F2', color: BILLING_STATUS[c.status]?.color || '#555', textTransform: 'uppercase' }}>{BILLING_STATUS[c.status]?.label || c.status}</span>
                  </div>
                  <div style={{ fontFamily: F.body, fontSize: 14, color: PALETTE.espresso, marginBottom: 6 }}>{fmtMoney(c.amount)}</div>
                  {c.notes && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginBottom: 6, lineHeight: 1.5 }}>{c.notes}</div>}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button onClick={() => startEditCycle(c)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                    <button onClick={() => deleteCycle(c.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                    {c.invoice_url && <a href={c.invoice_url} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginLeft: 'auto' }}>Invoice ↗</a>}
                  </div>
                </div>
              ))}

              <div style={{ height: '0.5px', background: PALETTE.borderLight, margin: '24px 0 18px' }} />
              <div style={{ fontFamily: F.display, fontSize: 15, color: PALETTE.espresso, marginBottom: 4 }}>Reimbursements</div>
              <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginBottom: 14 }}>Money Brown Butter owes {client.name} back — ad spend, event costs, etc.</div>

              {editingReimbursementId ? (
                <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div><label style={labelStyle}>Date</label><input type="date" value={reimbDate} onChange={e => setReimbDate(e.target.value)} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Amount (₱)</label><input type="number" step="0.01" value={reimbAmount} onChange={e => setReimbAmount(e.target.value)} placeholder="e.g. 3500" style={inputStyle} /></div>
                  </div>
                  <div><label style={labelStyle}>Description</label><input value={reimbDescription} onChange={e => setReimbDescription(e.target.value)} placeholder="e.g. Ad spend fronted for boosted posts" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Status</label><select value={reimbStatus} onChange={e => setReimbStatus(e.target.value)} style={inputStyle}><option value="pending">Pending</option><option value="paid">Paid</option></select></div>
                  <div>
                    <label style={labelStyle}>Receipt (optional)</label>
                    {reimbReceiptUrl ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid }}>
                        <span style={{ flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{invoiceFileName(reimbReceiptUrl)}</span>
                        <a href={reimbReceiptUrl} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, flexShrink: 0 }}>View</a>
                        <button onClick={() => receiptFileRef.current.click()} disabled={uploadingReceipt} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, flexShrink: 0 }}>{uploadingReceipt ? 'Uploading…' : 'Replace'}</button>
                        <button onClick={() => setReimbReceiptUrl('')} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B', flexShrink: 0 }}>Remove</button>
                      </div>
                    ) : (
                      <button onClick={() => receiptFileRef.current.click()} disabled={uploadingReceipt} style={{ width: '100%', padding: '9px 0', borderRadius: 6, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>
                        {uploadingReceipt ? 'Uploading…' : '+ Upload receipt (PDF or image)'}
                      </button>
                    )}
                    <input ref={receiptFileRef} type="file" accept="application/pdf,image/*" onChange={handleReceiptUpload} style={{ display: 'none' }} />
                  </div>
                  <div><label style={labelStyle}>Notes (optional)</label><textarea value={reimbNotes} onChange={e => setReimbNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingReimbursementId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                    <button onClick={saveReimbursement} disabled={saving || !reimbDate || !reimbDescription.trim()} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save reimbursement'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={startNewReimbursement} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 16 }}>+ New reimbursement</button>
              )}

              {sortedReimbursements.length === 0 && !editingReimbursementId && (
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>No reimbursements logged yet.</div>
              )}
              {sortedReimbursements.map(r => (
                <div key={r.id} style={{ border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>{fmtDateLong(r.date)}</div>
                    <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: BILLING_STATUS[r.status]?.bg || '#F2F2F2', color: BILLING_STATUS[r.status]?.color || '#555', textTransform: 'uppercase' }}>{BILLING_STATUS[r.status]?.label || r.status}</span>
                  </div>
                  <div style={{ fontFamily: F.body, fontSize: 14, color: PALETTE.espresso, marginBottom: 4 }}>{fmtMoney(r.amount)}</div>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight, marginBottom: 6 }}>{r.description}</div>
                  {r.notes && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginBottom: 6, lineHeight: 1.5 }}>{r.notes}</div>}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button onClick={() => startEditReimbursement(r)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                    <button onClick={() => deleteReimbursement(r.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                    {r.receipt_url && <a href={r.receipt_url} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginLeft: 'auto' }}>Receipt ↗</a>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 24, color: PALETTE.espresso, marginBottom: 4 }}>Important Links</div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 24, fontWeight: 300 }}>
                {links.length} link{links.length !== 1 ? 's' : ''} for {client.name} · visible in their Client Portal
              </div>

              {editingLinkId ? (
                <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><label style={labelStyle}>Title</label><input value={linkTitle} onChange={e => setLinkTitle(e.target.value)} placeholder="e.g. Canva board" style={inputStyle} /></div>
                  <div><label style={labelStyle}>URL</label><input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." style={inputStyle} /></div>
                  <div>
                    <label style={labelStyle}>Category</label>
                    <input value={linkCategory} onChange={e => setLinkCategory(e.target.value)} placeholder="e.g. Scripts, Menu, Planning (leave blank for Other)" style={inputStyle} />
                    {groupLinks(links).filter(g => g.name !== LINK_UNCAT).length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {groupLinks(links).filter(g => g.name !== LINK_UNCAT).map(g => (
                          <button key={g.name} type="button" onClick={() => setLinkCategory(g.name)} style={{ padding: '4px 10px', borderRadius: 20, border: '0.5px solid ' + PALETTE.border, background: linkCategory.trim().toLowerCase() === g.name.toLowerCase() ? PALETTE.espresso : '#fff', color: linkCategory.trim().toLowerCase() === g.name.toLowerCase() ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 11 }}>{g.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setEditingLinkId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                    <button onClick={saveLink} disabled={saving || !linkTitle.trim() || !linkUrl.trim()} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save link'}</button>
                  </div>
                </div>
              ) : (
                <button onClick={startNewLink} style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: '1.5px dashed ' + PALETTE.border, background: PALETTE.creamMid, fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 16 }}>+ New link</button>
              )}

              {(() => {
                if (links.length === 0 && !editingLinkId) {
                  return <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 16, padding: '48px 0', textAlign: 'center' }}>No links yet</div>
                }
                const groups = groupLinks(links)
                const activeFilter = groups.some(g => g.name === linkFilter) ? linkFilter : 'all'
                const shown = activeFilter === 'all' ? groups : groups.filter(g => g.name === activeFilter)
                return (
                  <>
                    {groups.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                        {[{ name: 'all', label: 'All', n: links.length }, ...groups.map(g => ({ name: g.name, label: g.name, n: g.items.length }))].map(ch => (
                          <button key={ch.name} onClick={() => setLinkFilter(ch.name)} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid ' + (activeFilter === ch.name ? PALETTE.espresso : PALETTE.border), background: activeFilter === ch.name ? PALETTE.espresso : '#fff', color: activeFilter === ch.name ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 11, fontWeight: activeFilter === ch.name ? 500 : 400, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                            {ch.label}<span style={{ fontSize: 10, opacity: 0.7 }}>{ch.n}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {shown.map(g => (
                      <div key={g.name} style={{ marginBottom: 22 }}>
                        <div style={{ fontFamily: F.body, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 10 }}>{g.name} · {g.items.length}</div>
                        {g.items.map(l => (
                          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '14px 20px', marginBottom: 10, transition: 'background 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
                            onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 15, color: PALETTE.espresso, marginBottom: 7 }}>{l.title}</div>
                              <a href={fixUrl(l.url)} target="_blank" rel="noreferrer" title={fixUrl(l.url)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, background: PALETTE.caramelLight, color: PALETTE.caramel, fontFamily: F.body, fontSize: 11, fontWeight: 500, textDecoration: 'none' }}>{linkSite(l.url)} ↗</a>
                            </div>
                            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                              <button onClick={() => startEditLink(l)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.muted }}>Edit</button>
                              <button onClick={() => deleteLink(l.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                )
              })()}
            </div>
          )}
      </div>
    </div>
  )
}

// Lightweight bar chart — plain divs sized by percentage of the max value in
// the series, no charting library dependency. Good enough for "here are the
// numbers over time" without pulling in recharts just for this one view.
function ReportBarChart({ data, color, format }) {
  const max = Math.max(1, ...data.map(d => d.value || 0))
  const fmtVal = format || (n => (n ?? 0).toLocaleString())
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 150, paddingTop: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
          <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.espresso, fontWeight: 500, whiteSpace: 'nowrap' }}>{d.value == null ? '—' : fmtVal(d.value)}</div>
          <div style={{ width: '100%', maxWidth: 36, height: Math.max(4, (d.value || 0) / max * 100) + '%', background: color, borderRadius: '5px 5px 2px 2px', transition: 'height 0.3s ease' }} />
          <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 50, textAlign: 'center' }}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}

function MarketingReportsView({ client }) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null) // null | 'new' | report id
  const [expandedIds, setExpandedIds] = useState(() => new Set()) // report history rows are collapsed by default
  const toggleExpanded = (id) => setExpandedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const blankForm = {
    period_start: '', period_end: '', followers: '', reach: '', impressions: '',
    profile_visits: '', bio_link_taps: '',
    total_interactions: '',
    views_post: '', views_reel: '', views_story: '',
    followers_pct: '', nonfollowers_pct: '',
    notes: ''
  }
  const [form, setForm] = useState(blankForm)

  const fetchReports = async () => {
    setLoading(true)
    const { data } = await supabase.from('analytics_reports').select('*').eq('client_id', client.id).order('period_start', { ascending: true })
    if (data) setReports(data)
    setLoading(false)
  }
  useEffect(() => { fetchReports() }, [client.id])

  const startNew = () => { setEditingId('new'); setForm(blankForm) }
  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      period_start: r.period_start, period_end: r.period_end,
      followers: r.followers ?? '', reach: r.reach ?? '', impressions: r.impressions ?? '',
      profile_visits: r.profile_visits ?? '', bio_link_taps: r.bio_link_taps ?? '',
      total_interactions: r.total_interactions ?? '',
      views_post: r.views_post ?? '', views_reel: r.views_reel ?? '', views_story: r.views_story ?? '',
      followers_pct: r.followers_pct ?? '', nonfollowers_pct: r.nonfollowers_pct ?? '',
      notes: r.notes || ''
    })
  }

  const numOrNull = (v) => v === '' || v == null ? null : parseInt(v, 10)
  // Follower-share fields are percentages (0–100), so keep decimals rather
  // than truncating to a whole number like the count fields.
  const pctOrNull = (v) => v === '' || v == null ? null : Math.max(0, Math.min(100, parseFloat(v)))

  const saveReport = async () => {
    if (!form.period_start || !form.period_end) return
    setSaving(true)
    const payload = {
      client_id: client.id, period_start: form.period_start, period_end: form.period_end,
      followers: numOrNull(form.followers), reach: numOrNull(form.reach), impressions: numOrNull(form.impressions),
      profile_visits: numOrNull(form.profile_visits), bio_link_taps: numOrNull(form.bio_link_taps),
      total_interactions: numOrNull(form.total_interactions),
      views_post: numOrNull(form.views_post), views_reel: numOrNull(form.views_reel), views_story: numOrNull(form.views_story),
      followers_pct: pctOrNull(form.followers_pct), nonfollowers_pct: pctOrNull(form.nonfollowers_pct),
      notes: form.notes.trim() || null
    }
    if (editingId === 'new') {
      await supabase.from('analytics_reports').insert(payload)
    } else {
      await supabase.from('analytics_reports').update(payload).eq('id', editingId)
    }
    setSaving(false); setEditingId(null)
    fetchReports()
  }

  const deleteReport = async (id) => {
    if (!window.confirm('Delete this report?')) return
    await supabase.from('analytics_reports').delete().eq('id', id)
    fetchReports()
  }

  // Ads Reports — paid spend/results, logged separately from organic
  // performance above since not every client runs ads every period.
  const [adReports, setAdReports] = useState([])
  const [adLoading, setAdLoading] = useState(true)
  const [adSaving, setAdSaving] = useState(false)
  const [editingAdId, setEditingAdId] = useState(null) // null | 'new' | report id
  const [expandedAdIds, setExpandedAdIds] = useState(() => new Set())
  const toggleAdExpanded = (id) => setExpandedAdIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const blankAdForm = { platform: 'Meta', period_start: '', period_end: '', amount_spent: '', impressions: '', reach: '', clicks: '', results: '', notes: '' }
  const [adForm, setAdForm] = useState(blankAdForm)

  const fetchAdReports = async () => {
    setAdLoading(true)
    const { data } = await supabase.from('ad_reports').select('*').eq('client_id', client.id).order('period_start', { ascending: true })
    if (data) setAdReports(data)
    setAdLoading(false)
  }
  useEffect(() => { fetchAdReports() }, [client.id])

  const startNewAd = () => { setEditingAdId('new'); setAdForm(blankAdForm) }
  const startEditAd = (r) => {
    setEditingAdId(r.id)
    setAdForm({
      platform: r.platform || 'Meta', period_start: r.period_start, period_end: r.period_end,
      amount_spent: r.amount_spent ?? '', impressions: r.impressions ?? '', reach: r.reach ?? '',
      clicks: r.clicks ?? '', results: r.results ?? '', notes: r.notes || ''
    })
  }

  const numOrNullAd = (v) => v === '' || v == null ? null : parseInt(v, 10)
  const moneyOrNull = (v) => v === '' || v == null ? null : parseFloat(v)

  const saveAdReport = async () => {
    if (!adForm.period_start || !adForm.period_end) return
    setAdSaving(true)
    const payload = {
      client_id: client.id, platform: adForm.platform, period_start: adForm.period_start, period_end: adForm.period_end,
      amount_spent: moneyOrNull(adForm.amount_spent), impressions: numOrNullAd(adForm.impressions), reach: numOrNullAd(adForm.reach),
      clicks: numOrNullAd(adForm.clicks), results: numOrNullAd(adForm.results), notes: adForm.notes.trim() || null
    }
    if (editingAdId === 'new') {
      await supabase.from('ad_reports').insert(payload)
    } else {
      await supabase.from('ad_reports').update(payload).eq('id', editingAdId)
    }
    setAdSaving(false); setEditingAdId(null)
    fetchAdReports()
  }

  const deleteAdReport = async (id) => {
    if (!window.confirm('Delete this ad report?')) return
    await supabase.from('ad_reports').delete().eq('id', id)
    fetchAdReports()
  }

  const sortedAds = [...adReports].sort((a, b) => new Date(a.period_start) - new Date(b.period_start))
  const latestAd = sortedAds[sortedAds.length - 1]
  const priorAd = sortedAds[sortedAds.length - 2]
  const ctrOfAd = (r) => (r.impressions ? Math.round((r.clicks || 0) / r.impressions * 10000) / 100 : null)
  const cpcOfAd = (r) => (r.clicks ? Math.round((r.amount_spent || 0) / r.clicks * 100) / 100 : null)
  const totalAdSpend = sortedAds.reduce((sum, r) => sum + (r.amount_spent || 0), 0)

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }
  const labelStyle = { fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6, display: 'block' }

  const sorted = [...reports].sort((a, b) => new Date(a.period_start) - new Date(b.period_start))
  const latest = sorted[sorted.length - 1]
  const prior = sorted[sorted.length - 2]

  const delta = (a, b) => {
    if (a == null || b == null) return null
    const diff = a - b
    const pct = b === 0 ? null : Math.round((diff / b) * 100)
    return { diff, pct }
  }
  const engagementOf = (r) => r.total_interactions || 0
  // Engagement rate = total engagements ÷ reach × 100 — the standard way to
  // express engagement so it's comparable across periods regardless of how
  // many people a post happened to reach. Null (shows as "—") if reach isn't
  // logged for that period, rather than silently dividing by zero.
  const engagementRateOf = (r) => {
    if (!r.reach) return null
    return Math.round((engagementOf(r) / r.reach) * 1000) / 10 // 1 decimal place
  }

  const chartSeries = sorted.slice(-8) // last 8 periods so bars stay readable
  const followersData = chartSeries.map(r => ({ label: fmtShort(r.period_start), value: r.followers }))
  const reachData = chartSeries.map(r => ({ label: fmtShort(r.period_start), value: r.reach }))
  const engagementData = chartSeries.map(r => ({ label: fmtShort(r.period_start), value: engagementRateOf(r) }))

  const kpiCard = (label, value, deltaInfo, description, formatValue, extra) => {
    const fmtVal = formatValue || (v => v.toLocaleString())
    return (
    <div style={{ flex: 1, minWidth: 150, background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 24, color: PALETTE.espresso, marginBottom: deltaInfo ? 4 : 6 }}>{value == null ? '—' : fmtVal(value)}</div>
      {deltaInfo && deltaInfo.diff != null && (
        <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: deltaInfo.diff >= 0 ? '#2A7D4F' : '#C0392B', marginBottom: 6 }}>
          {deltaInfo.diff >= 0 ? '↑' : '↓'} {deltaInfo.diffLabel != null ? deltaInfo.diffLabel : Math.abs(deltaInfo.diff).toLocaleString()}{deltaInfo.pct != null ? ' (' + Math.abs(deltaInfo.pct) + '%)' : ''} vs last period
        </div>
      )}
      {extra}
      {description && <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, lineHeight: 1.5, borderTop: '0.5px solid ' + PALETTE.borderLight, paddingTop: 6, marginTop: 2 }}>{description}</div>}
    </div>
  )}

  return (
    <div style={{ padding: '20px 26px 60px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 26, color: PALETTE.espresso, lineHeight: 1 }}>Marketing Reports</div>
          <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>{client.name} · {reports.length} report{reports.length !== 1 ? 's' : ''} logged</div>
        </div>
        <button onClick={startNew} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontFamily: F.body, fontSize: 12, fontWeight: 500, flexShrink: 0 }}>+ Log new report</button>
      </div>

      {loading ? (
        <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, textAlign: 'center', padding: 40 }}>Loading…</div>
      ) : (
        <>
          {editingId && (
            <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 10, padding: 18, marginBottom: 24 }}>
              <div style={{ fontFamily: F.display, fontSize: 15, color: PALETTE.espresso, marginBottom: 14 }}>{editingId === 'new' ? 'Log a new report' : 'Edit report'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div><label style={labelStyle}>Period start</label><input type="date" value={form.period_start} onChange={e => setForm({ ...form, period_start: e.target.value })} style={inputStyle} /></div>
                <div><label style={labelStyle}>Period end</label><input type="date" value={form.period_end} onChange={e => setForm({ ...form, period_end: e.target.value })} style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {[['followers', 'Followers'], ['reach', 'Reach'], ['impressions', 'Impressions'], ['profile_visits', 'Profile Visits'], ['bio_link_taps', 'Bio Link Taps'], ['total_interactions', 'Total Interactions']].map(([key, lbl]) => (
                  <div key={key}><label style={labelStyle}>{lbl}</label><input type="number" min="0" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder="0" style={inputStyle} /></div>
                ))}
              </div>

              <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6 }}>Views by content type (optional)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                {[['views_post', 'Post'], ['views_reel', 'Reel'], ['views_story', 'Story']].map(([key, lbl]) => (
                  <div key={key}><label style={labelStyle}>{lbl}</label><input type="number" min="0" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder="0" style={inputStyle} /></div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div><label style={labelStyle}>% Followers (optional)</label><input type="number" min="0" max="100" step="0.1" value={form.followers_pct} onChange={e => setForm({ ...form, followers_pct: e.target.value })} placeholder="0" style={inputStyle} /></div>
                <div><label style={labelStyle}>% Non-followers (optional)</label><input type="number" min="0" max="100" step="0.1" value={form.nonfollowers_pct} onChange={e => setForm({ ...form, nonfollowers_pct: e.target.value })} placeholder="0" style={inputStyle} /></div>
              </div>

              <div style={{ marginBottom: 14 }}><label style={labelStyle}>Notes (optional)</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Any context worth remembering about this period" /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                <button onClick={saveReport} disabled={saving || !form.period_start || !form.period_end} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save report'}</button>
              </div>
            </div>
          )}

          {reports.length === 0 && !editingId ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontFamily: F.display, color: PALETTE.mutedLight, fontSize: 18 }}>No reports logged yet</div>
            </div>
          ) : (
            <>
              {latest && (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
                  {kpiCard('Followers', latest.followers, prior ? delta(latest.followers, prior.followers) : null, 'Total accounts following the profile as of this period.')}
                  {kpiCard('Reach', latest.reach, prior ? delta(latest.reach, prior.reach) : null, 'Unique accounts that saw at least one post.')}
                  {kpiCard('Impressions', latest.impressions, prior ? delta(latest.impressions, prior.impressions) : null, 'Total times posts were displayed, including repeat views.')}
                  {(() => {
                    const latestRate = engagementRateOf(latest)
                    const priorRate = prior ? engagementRateOf(prior) : null
                    const rateDelta = (latestRate != null && priorRate != null)
                      ? { diff: latestRate - priorRate, diffLabel: Math.abs(Math.round((latestRate - priorRate) * 10) / 10) + ' pts', pct: null }
                      : null
                    const { low, high } = FNB_ENGAGEMENT_BENCHMARK
                    const benchmarkBadge = latestRate != null && (() => {
                      const status = latestRate < low ? 'below' : latestRate > high ? 'above' : 'within'
                      const color = status === 'below' ? '#C0392B' : '#2A7D4F'
                      const label = status === 'below' ? 'Below' : status === 'above' ? 'Above' : 'Within'
                      return (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 10, background: status === 'below' ? '#FEECEA' : '#E8F8EE', fontFamily: F.body, fontSize: 10, fontWeight: 500, color, marginBottom: 6 }}>
                          {label} F&amp;B benchmark ({low}–{high}%)
                        </div>
                      )
                    })()
                    return kpiCard('Engagement rate', latestRate, rateDelta, 'Total interactions as a share of reach.', v => v.toFixed(1) + '%', benchmarkBadge)
                  })()}
                  {(() => {
                    const ctrOf = (r) => (r.profile_visits ? Math.round((r.bio_link_taps || 0) / r.profile_visits * 1000) / 10 : null)
                    const latestCtr = ctrOf(latest)
                    const priorCtr = prior ? ctrOf(prior) : null
                    const ctrDelta = (latestCtr != null && priorCtr != null)
                      ? { diff: latestCtr - priorCtr, diffLabel: Math.abs(Math.round((latestCtr - priorCtr) * 10) / 10) + ' pts', pct: null }
                      : null
                    const ctrBadge = latestCtr != null && (() => {
                      const isBelow = latestCtr < FNB_CTR_BENCHMARK.value
                      const color = isBelow ? '#C0392B' : '#2A7D4F'
                      return (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 10, background: isBelow ? '#FEECEA' : '#E8F8EE', fontFamily: F.body, fontSize: 10, fontWeight: 500, color, marginBottom: 6 }}>
                          {isBelow ? 'Below' : 'At/above'} F&amp;B reference ({FNB_CTR_BENCHMARK.value}%)
                        </div>
                      )
                    })()
                    return kpiCard('Profile → Link CTR', latestCtr, ctrDelta, 'Bio link taps as a share of profile visits.', v => v.toFixed(1) + '%', ctrBadge)
                  })()}
                </div>
              )}

              {chartSeries.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 28 }}>
                  <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, marginBottom: 4 }}>Followers over time</div>
                    <ReportBarChart data={followersData} color={PALETTE.caramel} />
                  </div>
                  <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, marginBottom: 4 }}>Reach over time</div>
                    <ReportBarChart data={reachData} color="#3B72B8" />
                  </div>
                  <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '16px 18px' }}>
                    <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, marginBottom: 4 }}>Engagement rate over time</div>
                    <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginBottom: 6 }}>Total interactions ÷ reach · F&amp;B benchmark: {FNB_ENGAGEMENT_BENCHMARK.low}–{FNB_ENGAGEMENT_BENCHMARK.high}%</div>
                    <ReportBarChart data={engagementData} color="#2A7D4F" format={v => v.toFixed(1) + '%'} />
                  </div>
                </div>
              )}

              {latest && (latest.views_post != null || latest.views_reel != null || latest.views_story != null) && (
                <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, marginBottom: 4 }}>Views by content type</div>
                  <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginBottom: 6 }}>Most recent period: {fmtDateLong(latest.period_start)} – {fmtDateLong(latest.period_end)}</div>
                  <ReportBarChart
                    data={[
                      { label: 'Post', value: latest.views_post },
                      { label: 'Reel', value: latest.views_reel },
                      { label: 'Story', value: latest.views_story },
                    ]}
                    color={PALETTE.caramel}
                  />
                </div>
              )}

              {latest && (latest.followers_pct != null || latest.nonfollowers_pct != null) && (
                <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '16px 18px', marginBottom: 28 }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, marginBottom: 4 }}>Followers vs. non-followers reached</div>
                  <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginBottom: 14 }}>Most recent period: {fmtDateLong(latest.period_start)} – {fmtDateLong(latest.period_end)}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, marginBottom: 6 }}>
                    <span>{latest.followers_pct != null ? latest.followers_pct + '% followers' : '—'}</span>
                    <span style={{ color: PALETTE.mutedLight }}>{latest.nonfollowers_pct != null ? latest.nonfollowers_pct + '% non-followers' : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: PALETTE.creamDark }}>
                    <div style={{ width: (latest.followers_pct || 0) + '%', background: PALETTE.caramel }} />
                    <div style={{ width: (latest.nonfollowers_pct || 0) + '%', background: '#B8A898' }} />
                  </div>
                </div>
              )}

              <div style={{ fontFamily: F.display, fontSize: 16, color: PALETTE.espresso, marginBottom: 12 }}>All reports</div>
              {[...sorted].reverse().map(r => {
                const isOpen = expandedIds.has(r.id)
                return (
                <div key={r.id} style={{ border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, marginBottom: 10, background: '#fff', overflow: 'hidden' }}>
                  <div onClick={() => toggleExpanded(r.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                      <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>{fmtDateLong(r.period_start)} – {fmtDateLong(r.period_end)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => startEdit(r)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                      <button onClick={() => deleteReport(r.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '0 14px 14px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                        {[['Followers', r.followers], ['Reach', r.reach], ['Impressions', r.impressions], ['Profile visits', r.profile_visits], ['Bio link taps', r.bio_link_taps], ['Total interactions', r.total_interactions], ['Post views', r.views_post], ['Reel views', r.views_reel], ['Story views', r.views_story], ['Followers reached', r.followers_pct != null ? r.followers_pct + '%' : null], ['Non-followers reached', r.nonfollowers_pct != null ? r.nonfollowers_pct + '%' : null]].filter(([, v]) => v != null).map(([lbl, v]) => (
                          <div key={lbl} style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>{lbl} </span>{v.toLocaleString()}</div>
                        ))}
                      </div>
                      {r.notes && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>{r.notes}</div>}
                    </div>
                  )}
                </div>
                )
              })}
            </>
          )}
        </>
      )}

      <div style={{ borderTop: '0.5px solid ' + PALETTE.borderLight, marginTop: 32, paddingTop: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 22, color: PALETTE.espresso, lineHeight: 1 }}>📢 Ads Reports</div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>Paid spend & results, if any — {adReports.length} report{adReports.length !== 1 ? 's' : ''} logged</div>
          </div>
          <button onClick={startNewAd} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontFamily: F.body, fontSize: 12, fontWeight: 500, flexShrink: 0 }}>+ Log ad report</button>
        </div>

        {adLoading ? (
          <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, textAlign: 'center', padding: 40 }}>Loading…</div>
        ) : (
          <>
            {editingAdId && (
              <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 10, padding: 18, marginBottom: 24 }}>
                <div style={{ fontFamily: F.display, fontSize: 15, color: PALETTE.espresso, marginBottom: 14 }}>{editingAdId === 'new' ? 'Log a new ad report' : 'Edit ad report'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={labelStyle}>Platform</label>
                    <select value={adForm.platform} onChange={e => setAdForm({ ...adForm, platform: e.target.value })} style={inputStyle}>
                      {['Meta', 'Google', 'TikTok', 'Other'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><label style={labelStyle}>Period start</label><input type="date" value={adForm.period_start} onChange={e => setAdForm({ ...adForm, period_start: e.target.value })} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Period end</label><input type="date" value={adForm.period_end} onChange={e => setAdForm({ ...adForm, period_end: e.target.value })} style={inputStyle} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
                  <div><label style={labelStyle}>Amount spent (₱)</label><input type="number" min="0" step="0.01" value={adForm.amount_spent} onChange={e => setAdForm({ ...adForm, amount_spent: e.target.value })} placeholder="0" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Impressions</label><input type="number" min="0" value={adForm.impressions} onChange={e => setAdForm({ ...adForm, impressions: e.target.value })} placeholder="0" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Reach</label><input type="number" min="0" value={adForm.reach} onChange={e => setAdForm({ ...adForm, reach: e.target.value })} placeholder="0" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Clicks</label><input type="number" min="0" value={adForm.clicks} onChange={e => setAdForm({ ...adForm, clicks: e.target.value })} placeholder="0" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Results</label><input type="number" min="0" value={adForm.results} onChange={e => setAdForm({ ...adForm, results: e.target.value })} placeholder="0" style={inputStyle} /></div>
                </div>
                <div style={{ marginBottom: 14 }}><label style={labelStyle}>Notes (optional)</label><textarea value={adForm.notes} onChange={e => setAdForm({ ...adForm, notes: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="e.g. campaign name, objective, anything worth remembering" /></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEditingAdId(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Cancel</button>
                  <button onClick={saveAdReport} disabled={adSaving || !adForm.period_start || !adForm.period_end} style={{ flex: 1, padding: '9px 0', borderRadius: 6, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 12, color: PALETTE.cream, opacity: adSaving ? 0.6 : 1 }}>{adSaving ? 'Saving…' : 'Save ad report'}</button>
                </div>
              </div>
            )}

            {adReports.length === 0 && !editingAdId ? (
              <div style={{ padding: '30px 0 10px', textAlign: 'center' }}>
                <div style={{ fontFamily: F.display, color: PALETTE.mutedLight, fontSize: 16 }}>No ad reports logged yet</div>
              </div>
            ) : (
              <>
                {latestAd && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
                    {kpiCard('Amount spent', latestAd.amount_spent, priorAd ? delta(latestAd.amount_spent, priorAd.amount_spent) : null, latestAd.platform + ' spend this period.', v => fmtMoney(v))}
                    {kpiCard('Impressions', latestAd.impressions, priorAd ? delta(latestAd.impressions, priorAd.impressions) : null, 'Total times ads were displayed.')}
                    {kpiCard('Clicks', latestAd.clicks, priorAd ? delta(latestAd.clicks, priorAd.clicks) : null, 'CTR: ' + (ctrOfAd(latestAd) != null ? ctrOfAd(latestAd) + '%' : '—') + ' · CPC: ' + (cpcOfAd(latestAd) != null ? fmtMoney(cpcOfAd(latestAd)) : '—'))}
                    {kpiCard('Results', latestAd.results, priorAd ? delta(latestAd.results, priorAd.results) : null, 'Conversions/leads/whatever the campaign was optimized for.')}
                    {kpiCard('Total spend logged', totalAdSpend || null, null, 'Sum across all ' + sortedAds.length + ' logged period' + (sortedAds.length !== 1 ? 's' : '') + '.', v => fmtMoney(v))}
                  </div>
                )}

                <div style={{ fontFamily: F.display, fontSize: 16, color: PALETTE.espresso, marginBottom: 12 }}>All ad reports</div>
                {[...sortedAds].reverse().map(r => {
                  const isOpen = expandedAdIds.has(r.id)
                  return (
                  <div key={r.id} style={{ border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, marginBottom: 10, background: '#fff', overflow: 'hidden' }}>
                    <div onClick={() => toggleAdExpanded(r.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, transition: 'transform 0.15s', display: 'inline-block', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                        <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.05em', color: PALETTE.caramel, textTransform: 'uppercase', background: PALETTE.creamMid, padding: '2px 6px', borderRadius: 4 }}>{r.platform}</span>
                        <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>{fmtDateLong(r.period_start)} – {fmtDateLong(r.period_end)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => startEditAd(r)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                        <button onClick={() => deleteAdReport(r.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                          {[['Amount spent', r.amount_spent != null ? fmtMoney(r.amount_spent) : null], ['Impressions', r.impressions], ['Reach', r.reach], ['Clicks', r.clicks], ['CTR', ctrOfAd(r) != null ? ctrOfAd(r) + '%' : null], ['CPC', cpcOfAd(r) != null ? fmtMoney(cpcOfAd(r)) : null], ['Results', r.results]].filter(([, v]) => v != null).map(([lbl, v]) => (
                            <div key={lbl} style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>{lbl} </span>{typeof v === 'number' ? v.toLocaleString() : v}</div>
                          ))}
                        </div>
                        {r.notes && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>{r.notes}</div>}
                      </div>
                    )}
                  </div>
                  )
                })}
              </>
            )}
          </>
        )}
      </div>

      <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, textAlign: 'center', marginTop: 30, lineHeight: 1.6, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
        Food &amp; beverage engagement benchmark ({FNB_ENGAGEMENT_BENCHMARK.low}–{FNB_ENGAGEMENT_BENCHMARK.high}%) sourced from {FNB_ENGAGEMENT_BENCHMARK.source}.
        <br />CTR reference ({FNB_CTR_BENCHMARK.value}%) sourced from {FNB_CTR_BENCHMARK.source}.
      </div>
    </div>
  )
}

// ── Request reply thread ──────────────────────────────────────────────────────
// Two-way conversation under each client request. Agency replies show on the
// client's portal and the client's replies show here.
function RequestThread({ request, replies, authorType, authorName, otherLabel, onSent }) {
  const thread = replies.filter(r => r.request_id === request.id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const last = thread[thread.length - 1]
  const needsReply = !!last && last.author_type !== authorType
  const [open, setOpen] = useState(needsReply)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    const { error } = await supabase.from('request_replies').insert({ request_id: request.id, author_type: authorType, author: authorName, body: text.trim() })
    setSending(false)
    if (error) { alert('Could not send reply: ' + error.message); return }
    setText('')
    onSent && onSent()
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>
        <span>{open ? '▾' : '▸'} Replies{thread.length > 0 ? ' (' + thread.length + ')' : ''}</span>
        {needsReply && <span style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', background: '#FFF6E6', color: '#8A5A00', border: '0.5px solid #E8C87A', padding: '2px 7px', borderRadius: 10 }}>{otherLabel}</span>}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {thread.length === 0 && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', marginBottom: 10 }}>No replies yet.</div>}
          {thread.map(r => {
            const fromAgency = r.author_type === 'agency'
            return (
              <div key={r.id} style={{ display: 'flex', justifyContent: fromAgency ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '85%', background: fromAgency ? PALETTE.caramelLight : PALETTE.creamMid, border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '8px 12px' }}>
                  <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.muted, marginBottom: 3 }}>{r.author || (fromAgency ? 'Brown Butter' : 'Client')} · {fmtAgo(r.created_at)}</div>
                  <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{r.body}</div>
                </div>
              </div>
            )
          })}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            rows={2}
            placeholder="Write a reply"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, lineHeight: 1.5, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={send} disabled={sending || !text.trim()} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: text.trim() ? PALETTE.espresso : PALETTE.creamDark, color: text.trim() ? PALETTE.cream : PALETTE.mutedLight, fontFamily: F.body, fontSize: 12, fontWeight: 500, opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Global search (Cmd/Ctrl + K) ──────────────────────────────────────────────
function SearchModal({ clients, posts, requests, onClose, onPickClient, onPickPost, onPickRequest, onPickNote, onPickLink, isMobile }) {
  const [q, setQ] = useState('')
  const [notes, setNotes] = useState([])
  const [links, setLinks] = useState([])
  const [active, setActive] = useState(0)
  const inputRef = useRef()

  useEffect(() => {
    inputRef.current && inputRef.current.focus()
    supabase.from('meeting_notes').select('*').then(({ data }) => { if (data) setNotes(data) })
    supabase.from('important_links').select('*').then(({ data }) => { if (data) setLinks(data) })
  }, [])

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (...fields) => {
    const hay = fields.filter(Boolean).join(' ').toLowerCase()
    return tokens.every(t => hay.includes(t))
  }
  const cname = (id) => clients.find(c => c.id === id)?.name || ''
  const plain = (html) => (html || '').replace(/<[^>]*>/g, ' ')

  const groups = tokens.length === 0 ? [] : [
    { key: 'clients', label: 'Clients', items: clients.filter(c => match(c.name, c.handle, c.instagram_handle)).slice(0, 5).map(c => ({ id: 'c' + c.id, title: c.name, sub: 'Client', pick: () => onPickClient(c.id) })) },
    { key: 'posts', label: 'Posts', items: posts.filter(p => match(p.caption, p.campaign, p.designer, cname(p.client_id))).slice(0, 6).map(p => ({ id: 'p' + p.id, title: (p.caption || 'Untitled post').slice(0, 90), sub: cname(p.client_id) + ' · ' + (STATUS[p.status]?.label || p.status), pick: () => onPickPost(p) })) },
    { key: 'requests', label: 'Requests', items: requests.filter(r => match(r.title, r.description, cname(r.client_id))).slice(0, 5).map(r => ({ id: 'r' + r.id, title: r.title, sub: cname(r.client_id) + ' · Request', pick: () => onPickRequest(r) })) },
    { key: 'notes', label: 'Meeting notes', items: notes.filter(n => match(n.title, plain(n.body), cname(n.client_id))).slice(0, 5).map(n => ({ id: 'n' + n.id, title: n.title || 'Meeting note', sub: cname(n.client_id) + ' · Meeting note', pick: () => onPickNote(n) })) },
    { key: 'links', label: 'Links', items: links.filter(l => match(l.title, l.url, l.category, cname(l.client_id))).slice(0, 5).map(l => ({ id: 'l' + l.id, title: l.title, sub: cname(l.client_id) + (l.category ? ' · ' + l.category : '') + ' · ' + linkSite(l.url), pick: () => onPickLink(l) })) },
  ].filter(g => g.items.length > 0)
  const flat = groups.flatMap(g => g.items)

  useEffect(() => { setActive(0) }, [q])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(flat.length - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); flat[active].pick(); onClose() }
  }

  let idx = -1
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,31,14,0.45)', zIndex: 500, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: isMobile ? 60 : '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(580px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 12, border: '0.5px solid ' + PALETTE.border, boxShadow: '0 16px 48px rgba(44,31,14,0.28)', overflow: 'hidden' }}>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Search clients, posts, requests, notes, links" style={{ border: 'none', outline: 'none', padding: '16px 18px', fontFamily: F.body, fontSize: 15, color: PALETTE.espresso, borderBottom: '0.5px solid ' + PALETTE.borderLight, background: '#fff' }} />
        <div style={{ overflowY: 'auto', padding: '6px 0 8px' }}>
          {tokens.length === 0 && <div style={{ padding: '18px', fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight }}>Start typing to search across everything.</div>}
          {tokens.length > 0 && flat.length === 0 && <div style={{ padding: '18px', fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight }}>No results for "{q}".</div>}
          {groups.map(g => (
            <div key={g.key}>
              <div style={{ padding: '10px 18px 4px', fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: PALETTE.mutedLight }}>{g.label}</div>
              {g.items.map(it => {
                idx += 1
                const i = idx
                return (
                  <div key={it.id} onClick={() => { it.pick(); onClose() }} onMouseEnter={() => setActive(i)} style={{ padding: '9px 18px', cursor: 'pointer', background: active === i ? PALETTE.creamMid : 'transparent' }}>
                    <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                    <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub}</div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        {!isMobile && <div style={{ padding: '8px 18px', borderTop: '0.5px solid ' + PALETTE.borderLight, fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>Up and down to move, Enter to open, Esc to close</div>}
      </div>
    </div>
  )
}

function RequestsView({ requests, clients, selectedClient, onRefresh, replies, currentUserName }) {
  const setRequestStatus = async (id, status) => {
    const { error } = await supabase.from('requests').update({ status }).eq('id', id)
    if (error) {
      console.error('Failed to update request status:', error)
      alert('Could not update status: ' + error.message)
      return
    }
    onRefresh && onRefresh()
  }

  const deleteRequest = async (id) => {
    if (!window.confirm('Delete this request?')) return
    const { error } = await supabase.from('requests').delete().eq('id', id)
    if (error) {
      console.error('Failed to delete request:', error)
      alert('Could not delete request: ' + error.message)
      return
    }
    onRefresh && onRefresh()
  }

  const [typeFilter, setTypeFilter] = useState('all')

  const filtered = requests
    .filter(r => selectedClient === 'all' || r.client_id === selectedClient)
    .filter(r => typeFilter === 'all' || r.request_type === typeFilter)
  const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  return (
    <div style={{ padding: '28px 40px', maxWidth: 760 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {[['all', 'All Types'], ...REQUEST_TYPES.map(t => [t.value, t.label])].map(([value, label]) => (
          <button key={value} onClick={() => setTypeFilter(value)} style={{ padding: '7px 14px', borderRadius: 20, border: '0.5px solid ' + (typeFilter === value ? PALETTE.caramel : PALETTE.border), background: typeFilter === value ? PALETTE.espresso : '#fff', color: typeFilter === value ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 12, fontWeight: typeFilter === value ? 500 : 400, whiteSpace: 'nowrap' }}>{label}</button>
        ))}
      </div>
      {sorted.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <div style={{ fontFamily: F.display, color: PALETTE.mutedLight, fontSize: 18 }}>No requests yet</div>
        </div>
      ) : sorted.map(r => {
        const s = REQUEST_STATUS[r.status] || REQUEST_STATUS.new
        const client = clients.find(c => c.id === r.client_id)
        return (
          <div key={r.id} style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: F.display, fontSize: 16, color: PALETTE.espresso }}>{r.title}</div>
                {selectedClient === 'all' && client && (
                  <span style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight }}>· {client.name}</span>
                )}
              </div>
              <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: s.bg, color: s.color, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{s.label}</span>
            </div>
            {r.request_type && (
              <div style={{ display: 'inline-block', fontFamily: F.body, fontSize: 10, color: PALETTE.muted, background: PALETTE.creamMid, padding: '2px 8px', borderRadius: 10, marginBottom: 8 }}>
                {REQUEST_TYPES.find(t => t.value === r.request_type)?.label || r.request_type}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 8 }}>
              {r.deadline && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>Needed by </span>{fmtDateLong(r.deadline)}</div>}
              {r.budget && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>Budget </span>{r.budget}</div>}
              {r.goal && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>Goal </span>{r.goal}</div>}
              {r.platforms && r.platforms.length > 0 && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight }}><span style={{ color: PALETTE.mutedLight }}>Platform </span>{formatPlatforms(r.platforms)}</div>}
            </div>
            {r.pegs && (
              <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight, lineHeight: 1.6, marginBottom: 10, background: PALETTE.creamMid, borderRadius: 6, padding: '8px 10px' }}>
                <span style={{ color: PALETTE.mutedLight, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Pegs / Inspiration</span><br />{r.pegs}
              </div>
            )}
            {r.description && <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espressoLight, lineHeight: 1.65, marginBottom: 10 }}>{r.description}</div>}
            <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginBottom: 14 }}>Submitted {fmtAgo(r.created_at)}</div>
            <RequestThread request={r} replies={replies || []} authorType="agency" authorName={currentUserName} otherLabel="Client replied" onSent={onRefresh} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {REQUEST_STATUS_ORDER.filter(k => k !== r.status).map(k => (
                <button key={k} onClick={() => setRequestStatus(r.id, k)} style={{ padding: '6px 12px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, transition: 'all 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                >Mark {REQUEST_STATUS[k].label.toLowerCase()}</button>
              ))}
              <button onClick={() => deleteRequest(r.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B', marginLeft: 'auto' }}>Delete</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ClientOverview({ client, posts, comments, requests, statusChanges, onSelectPost, onOpenHub, onGoToRequests, onGoToReports, onGoToFilter, onClientUpdated, isMobile, currentUserEmail }) {
  const canBilling = canAccessBilling(currentUserEmail)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoFileRef = useRef()

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    const { url, error } = await uploadAsset(file)
    if (url) {
      await supabase.from('clients').update({ logo_url: url }).eq('id', client.id)
      onClientUpdated && onClientUpdated()
    }
    if (error) alert('Could not upload logo: ' + error)
    setUploadingLogo(false)
    e.target.value = ''
  }

  // Lightweight fetch — just enough for a one-line summary on the Marketing
  // Reports box, without loading full report detail on the overview screen.
  const [latestReport, setLatestReport] = useState(null)
  const [reportsCount, setReportsCount] = useState(0)
  useEffect(() => {
    supabase.from('analytics_reports').select('period_end, total_interactions, reach')
      .eq('client_id', client.id).order('period_end', { ascending: false })
      .then(({ data }) => {
        if (data) {
          setReportsCount(data.length)
          setLatestReport(data[0] || null)
        }
      })
  }, [client.id])
  const latestEngagementRate = (() => {
    if (!latestReport || !latestReport.reach) return null
    const eng = latestReport.total_interactions || 0
    return Math.round((eng / latestReport.reach) * 1000) / 10
  })()


  const clientPosts = posts.filter(p => p.client_id === client.id)
  const clientRequests = requests.filter(r => r.client_id === client.id)
  const clientPostIds = new Set(clientPosts.map(p => p.id))
  const clientComments = comments.filter(c => clientPostIds.has(c.post_id))
  const clientStatusChanges = statusChanges.filter(s => clientPostIds.has(s.post_id))

  const counts = {
    pending: clientPosts.filter(p => p.status === 'pending').length,
    revision: clientPosts.filter(p => p.status === 'revision').length,
    approved: clientPosts.filter(p => p.status === 'approved').length,
    scheduled: clientPosts.filter(p => p.status === 'scheduled').length,
    published: clientPosts.filter(p => p.status === 'published').length,
  }
  const openRequests = clientRequests.filter(r => r.status === 'new' || r.status === 'in_progress').length

  // Approval nudge: "Nudge in portal" stamps clients.approval_nudged_at, which
  // makes a reminder banner appear in that client's portal while posts are
  // still awaiting approval. "Copy message" gives a ready-to-send note.
  const [nudging, setNudging] = useState(false)
  const [copiedNudge, setCopiedNudge] = useState(false)
  const [nudgeDraft, setNudgeDraft] = useState(null) // null = use the generated message
  useEffect(() => { setNudgeDraft(null) }, [client.id])
  const pendingPosts = clientPosts.filter(p => p.status === 'pending')
  const earliestPending = pendingPosts
    .filter(p => p.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0]
  const nudgeMessage = (() => {
    const n = pendingPosts.length
    const when = earliestPending
      ? ' The earliest is scheduled for ' + new Date(earliestPending.scheduled_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric' }) + '.'
      : ''
    const link = PORTAL_BASE_URL && client.slug ? PORTAL_BASE_URL + '/' + client.slug : ''
    return 'Hi!\n\n'
      + 'Just a quick reminder that ' + n + ' post' + (n !== 1 ? 's are' : ' is') + ' still waiting for approval.' + when + '\n\n'
      + (link ? 'You can review here: ' + link + '\n\n' : '')
      + 'Thank you! :)'
  })()
  const messageText = nudgeDraft ?? nudgeMessage
  const nudgeClient = async () => {
    setNudging(true)
    const { error } = await supabase.from('clients').update({ approval_nudged_at: new Date().toISOString() }).eq('id', client.id)
    setNudging(false)
    if (error) { alert('Could not send nudge: ' + error.message); return }
    onClientUpdated && onClientUpdated()
  }
  const copyNudge = async () => {
    try {
      await navigator.clipboard.writeText(messageText)
      setCopiedNudge(true)
      setTimeout(() => setCopiedNudge(false), 2000)
    } catch {
      window.prompt('Copy this message:', messageText)
    }
  }

  // Merge comments + status changes + new requests into one recent-activity feed
  const activity = []
  clientComments.forEach(c => {
    const post = clientPosts.find(p => p.id === c.post_id)
    const who = c.author_type === 'agency' ? (c.author || 'Brown Butter') : c.author
    activity.push({
      ts: new Date(c.created_at).getTime(), date: c.created_at,
      who, action: 'commented',
      detail: post?.caption || 'a post',
      post,
    })
  })
  clientStatusChanges.forEach(s => {
    if (!['approved', 'revision'].includes(s.status)) return
    const post = clientPosts.find(p => p.id === s.post_id)
    activity.push({
      ts: new Date(s.created_at).getTime(), date: s.created_at,
      who: s.changed_by || client.name,
      action: s.status === 'approved' ? 'approved' : 'requested revisions',
      detail: post?.caption || 'a post',
      post,
    })
  })
  clientRequests.forEach(r => {
    activity.push({
      ts: new Date(r.created_at).getTime(), date: r.created_at,
      who: client.name, action: 'submitted a request',
      detail: r.title,
      post: null,
    })
  })
  activity.sort((a, b) => b.ts - a.ts)
  const recentActivity = activity.slice(0, 6)

  const statCard = (label, n, filterKey, dot) => (
    <div onClick={() => onGoToFilter(filterKey)} style={{ flex: isMobile ? '1 1 calc(50% - 5px)' : 1, background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
        <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontFamily: F.display, fontSize: 26, color: PALETTE.espresso }}>{n}</div>
    </div>
  )

  return (
    <div style={{ padding: isMobile ? '18px 16px 40px' : '24px 26px 48px' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: client.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '2px solid ' + PALETTE.caramel, overflow: 'hidden' }}>{client.logo_url ? <img src={client.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (client.name || 'BB').slice(0, 2).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.display, fontSize: 24, color: PALETTE.espresso, lineHeight: 1.1 }}>{client.name}</div>
          {client.ig_handle && <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, marginTop: 2 }}>@{client.ig_handle}</div>}
          {(() => { const si = seenInfo(client.portal_last_seen_at); return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontFamily: F.body, fontSize: 11, color: si.color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: si.dot }} />{si.text}
            </div>
          ) })()}
        </div>
        <button onClick={() => logoFileRef.current.click()} disabled={uploadingLogo} style={{ padding: '6px 12px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 11, color: PALETTE.espresso, flexShrink: 0 }}>
          {uploadingLogo ? 'Uploading...' : client.logo_url ? 'Change logo' : 'Upload logo'}
        </button>
        <input ref={logoFileRef} type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {statCard('Awaiting approval', counts.pending, 'pending', '#C4893A')}
        {statCard('Revisions', counts.revision, 'revision', '#C0392B')}
        {statCard('Approved', counts.approved, 'approved', '#2A7D4F')}
        {statCard('Scheduled', counts.scheduled, 'scheduled', '#3B72B8')}
        {statCard('Published', counts.published, 'published', '#888')}
      </div>

      {counts.pending > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#FFF6E6', border: '0.5px solid #E8C87A', borderRadius: 10, padding: '12px 16px', marginBottom: 24 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 500, color: '#8A5A00' }}>{counts.pending} post{counts.pending !== 1 ? 's' : ''} awaiting {client.name}'s approval</div>
            <div style={{ fontFamily: F.body, fontSize: 11, color: '#8A5A00', opacity: 0.8, marginTop: 2 }}>
              {client.approval_nudged_at
                ? 'Last nudged ' + new Date(client.approval_nudged_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : 'Not nudged yet'}
            </div>
          </div>
          <button onClick={nudgeClient} disabled={nudging} style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontFamily: F.body, fontSize: 12, fontWeight: 500, opacity: nudging ? 0.6 : 1 }}>{nudging ? 'Sending…' : 'Nudge in portal'}</button>
          <button onClick={copyNudge} style={{ padding: '7px 14px', borderRadius: 6, border: '0.5px solid #E8C87A', background: '#fff', color: '#8A5A00', fontFamily: F.body, fontSize: 12, fontWeight: 500 }}>{copiedNudge ? 'Copied' : 'Copy message'}</button>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8A5A00' }}>Message to copy · edit before copying</label>
              {nudgeDraft !== null && nudgeDraft !== nudgeMessage && (
                <button onClick={() => setNudgeDraft(null)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#8A5A00', textDecoration: 'underline', padding: 0 }}>Reset to default</button>
              )}
            </div>
            <textarea
              value={messageText}
              onChange={e => setNudgeDraft(e.target.value)}
              rows={7}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '0.5px solid #E8C87A', background: '#fff', fontFamily: F.body, fontSize: 12, lineHeight: 1.6, color: PALETTE.espresso, resize: 'vertical' }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20 }}>

        <div>
          <div style={{ fontFamily: F.display, fontSize: 16, color: PALETTE.espresso, marginBottom: 10 }}>Feed preview</div>
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '0.5px solid ' + PALETTE.borderLight }}>
            <IGGrid posts={clientPosts} onSelectPost={onSelectPost} />
          </div>
        </div>

        <div>
          <div style={{ fontFamily: F.display, fontSize: 16, color: PALETTE.espresso, marginBottom: 10 }}>Recent activity</div>
          {recentActivity.length === 0
            ? <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic' }}>Nothing yet.</div>
            : (
              <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, overflow: 'hidden' }}>
                {recentActivity.map((a, i) => {
                  const actionColors = {
                    commented: { bg: PALETTE.caramelLight, color: PALETTE.caramel },
                    approved: { bg: '#E8F8EE', color: '#2A7D4F' },
                    'requested revisions': { bg: '#FEECEA', color: '#C0392B' },
                    'submitted a request': { bg: '#E8F1FC', color: '#1E4E8A' },
                  }
                  const ac = actionColors[a.action] || actionColors.commented
                  return (
                    <div key={i} onClick={() => a.post && onSelectPost(a.post)} style={{ padding: '10px 14px', borderTop: i > 0 ? '0.5px solid ' + PALETTE.borderLight : 'none', cursor: a.post ? 'pointer' : 'default' }}
                      onMouseEnter={e => { if (a.post) e.currentTarget.style.background = PALETTE.creamMid }}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ display: 'inline-block', background: ac.bg, color: ac.color, fontFamily: F.body, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, marginBottom: 6 }}>
                        {a.who} {a.action}
                      </div>
                      <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>"{a.detail}"</div>
                      <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 4 }}>{fmtAgo(a.date)}</div>
                    </div>
                  )
                })}
              </div>
            )
          }
        </div>

      </div>
    </div>
  )
}

// Simple line icons for the sidebar (stroke follows the text color)
const NAV_ICONS = {
  today: 'M3 10.5L12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5',
  queue: 'M4 7h16M4 12h16M4 17h10',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  requests: 'M4 5h16v11H4zM4 13h5l1 2h4l1-2h5',
  reports: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  notes: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  links: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  billing: 'M3 6h18v12H3zM3 10h18M7 15h3',
}
const NavIcon = ({ name }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><path d={NAV_ICONS[name]} /></svg>
)

// Hover (or tap) the small "i" next to a card title to see what the card means
function InfoTip({ text }) {
  const [pos, setPos] = useState(null)
  const show = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const flip = r.bottom + 130 > window.innerHeight
    setPos({ x: Math.min(Math.max(12, r.left - 14), window.innerWidth - 276), y: flip ? r.top - 8 : r.bottom + 8, flip })
  }
  return (
    <span tabIndex={0} role="button" aria-label={'What is this? ' + text}
      onMouseEnter={show} onMouseLeave={() => setPos(null)}
      onFocus={show} onBlur={() => setPos(null)}
      onClick={(e) => { e.stopPropagation(); pos ? setPos(null) : show(e) }}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, borderRadius: '50%', border: '1px solid ' + PALETTE.mutedLight, color: PALETTE.muted, fontFamily: F.body, fontSize: 9, fontWeight: 600, fontStyle: 'italic', cursor: 'help', flexShrink: 0, lineHeight: 1, textTransform: 'none', letterSpacing: 0 }}>
      i
      {pos && (
        <span role="tooltip" style={{ position: 'fixed', left: pos.x, top: pos.y, transform: pos.flip ? 'translateY(-100%)' : 'none', width: 260, background: PALETTE.espresso, color: '#F5F0E8', borderRadius: 8, padding: '10px 12px', fontFamily: F.body, fontSize: 11, fontWeight: 400, fontStyle: 'normal', lineHeight: 1.5, textAlign: 'left', zIndex: 600, pointerEvents: 'none', boxShadow: '0 8px 24px rgba(44,31,14,0.25)' }}>{text}</span>
      )}
    </span>
  )
}

const CARD_ICONS = {
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  list: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  calendar: NAV_ICONS.calendar,
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  inbox: NAV_ICONS.requests,
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  check: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12l3 3 5-6',
}

// ── Recurring reminders ───────────────────────────────────────────────────────
// Reminders live in recurring_reminders (weekly or monthly, optional audience of
// emails). Completions live in reminder_completions, one row per occurrence, so
// ticking one off clears it for everyone it applies to until the next date.
const dayKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const DAY_MS = 86400000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }

function reminderOccurrences(r, now) {
  const today = startOfDay(now)
  if (r.frequency === 'monthly') {
    const md = r.month_day || 1
    const at = (y, m) => new Date(y, m, Math.min(md, new Date(y, m + 1, 0).getDate()))
    const thisMonth = at(today.getFullYear(), today.getMonth())
    if (thisMonth <= today) return { today, last: thisMonth, next: at(today.getFullYear(), today.getMonth() + 1) }
    return { today, last: at(today.getFullYear(), today.getMonth() - 1), next: thisMonth }
  }
  const wd = r.weekday ?? 1
  const diff = (today.getDay() - wd + 7) % 7
  return { today, last: new Date(today.getTime() - diff * DAY_MS), next: new Date(today.getTime() + (diff === 0 ? 7 : 7 - diff) * DAY_MS) }
}

function reminderState(r, now, doneSet) {
  const { today, last, next } = reminderOccurrences(r, now)
  const created = r.created_at ? startOfDay(new Date(r.created_at)) : null
  const key = dayKey(last)
  const done = doneSet.has(r.id + '|' + key)
  const daysLate = Math.round((today - last) / DAY_MS)
  const daysToNext = Math.round((next - today) / DAY_MS)
  let status = null
  if (last.getTime() === today.getTime()) status = done ? 'done' : 'today'
  else if (!done && (!created || last >= created)) status = 'overdue'
  else if (daysToNext <= 3) status = 'soon'
  return { status, key, daysLate, daysToNext, next }
}

const reminderSchedule = (r) => r.frequency === 'monthly'
  ? 'The ' + ordinal(r.month_day || 1) + ' of every month'
  : 'Every ' + WEEKDAYS[r.weekday ?? 1]

const reminderVisible = (r, email) => {
  if (r.active === false) return false
  const aud = Array.isArray(r.audience) ? r.audience.map(a => (a || '').trim().toLowerCase()) : []
  return aud.length === 0 || aud.includes((email || '').trim().toLowerCase())
}

const seenInfo = (str) => {
  if (!str) return { text: 'Never signed in', color: PALETTE.mutedLight, dot: '#B8A898' }
  const ts = new Date(str).getTime()
  const hrs = (Date.now() - ts) / 3600000
  const text = hrs > 24 * 14 ? 'Last signed in ' + new Date(ts).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : 'Last signed in ' + agoShort(ts)
  return { text, color: hrs < 24 ? '#1E6E3E' : hrs < 24 * 7 ? PALETTE.muted : '#8A5A00', dot: hrs < 24 ? '#2A7D4F' : hrs < 24 * 7 ? '#B8A898' : '#C4893A' }
}

const agoShort = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60)
  if (h < 24) return h + 'h ago'
  const d = Math.round(h / 24)
  return d + 'd ago'
}

// ── Today (home) view ─────────────────────────────────────────────────────────
// Landing page for the team: reminders, the logged-in user's workload, this
// week's schedule, who is waiting on whom, and a quick coverage read on every
// client. Scoped to the client picked in the top-bar switcher (or all clients).
function TodayHome({ teamMembers = [], currentUserAvatarUrl, firstName, posts, clients, requests, comments, statusChanges, requestReplies, reminders, reminderDone, selectedClient, currentUserName, currentUserEmail, isMobile, onGo, onSelectPost, onPickClient, onToggleReminder, onOpenReminderLink, onRefresh }) {
  const now = new Date()
  const today = startOfDay(now)
  const inScope = (cid) => selectedClient === 'all' || cid === selectedClient
  const scoped = posts.filter(p => inScope(p.client_id))
  const live = (p) => p.status !== 'published' && p.status !== 'archived'
  const sameDay = (str) => {
    if (!str) return false
    const d = new Date(str)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }
  const clientOf = (id) => clients.find(c => c.id === id)

  // Reminders that are due, overdue, done today, or coming up within 3 days
  const reminderRows = reminders
    .filter(r => reminderVisible(r, currentUserEmail))
    .map(r => ({ r, ...reminderState(r, now, reminderDone) }))
    .filter(x => x.status)
    .sort((a, b) => ['overdue', 'today', 'soon', 'done'].indexOf(a.status) - ['overdue', 'today', 'soon', 'done'].indexOf(b.status))
  const openReminders = reminderRows.filter(x => x.status === 'overdue' || x.status === 'today').length

  // On your plate
  const mine = scoped.filter(p => namesMatch(p.designer, currentUserName) && live(p))
  const rank = (p) => p.status === 'revision' ? 0 : sameDay(p.scheduled_at) ? 1 : p.status === 'draft' ? 2 : 3
  const plate = [...mine].sort((a, b) => rank(a) - rank(b) || new Date(a.scheduled_at || 8.64e15) - new Date(b.scheduled_at || 8.64e15))
  const plateShown = plate.slice(0, 6)

  const awaiting = scoped.filter(p => p.status === 'pending').length
  const revisions = scoped.filter(p => p.status === 'revision').length
  const openReqList = requests.filter(r => (r.status === 'new' || r.status === 'in_progress') && inScope(r.client_id))

  const hour = now.getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLong = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  const summaryBits = []
  if (openReminders) summaryBits.push(openReminders + ' reminder' + (openReminders !== 1 ? 's' : ''))
  if (mine.length) summaryBits.push(mine.length + ' post' + (mine.length !== 1 ? 's' : '') + ' on your plate')
  if (awaiting) summaryBits.push(awaiting + ' waiting on clients')
  if (openReqList.length) summaryBits.push(openReqList.length + ' open request' + (openReqList.length !== 1 ? 's' : ''))
  const summary = summaryBits.length ? summaryBits.join(', ') : 'You are all caught up'

  const chips = [
    { n: mine.length, label: 'Assigned to you', onClick: () => onGo('queue', 'active', { mine: true }) },
    { n: awaiting, label: 'Awaiting clients', onClick: () => onGo('queue', 'pending', { mine: false }) },
    { n: revisions, label: 'Revisions', hot: true, onClick: () => onGo('queue', 'revision', { mine: false }) },
    { n: openReqList.length, label: 'Open requests', onClick: () => onGo('requests') },
  ]

  // This week (Mon to Sun) + next up
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS)
  const weekDays = Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY_MS))
  const schedulable = scoped.filter(p => p.scheduled_at && p.status !== 'draft' && p.status !== 'archived')
  const countOn = (d) => schedulable.filter(p => dayKey(new Date(p.scheduled_at)) === dayKey(d))
  const nextUp = schedulable.filter(p => p.status !== 'published' && new Date(p.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0, 5)

  // Waiting on clients, longest wait first
  const waiting = clients.filter(c => inScope(c.id)).map(c => {
    const pend = posts.filter(p => p.client_id === c.id && p.status === 'pending')
    if (!pend.length) return null
    const since = Math.min(...pend.map(p => {
      const ch = statusChanges.filter(s => s.post_id === p.id && s.status === 'pending').map(s => new Date(s.created_at).getTime())
      return ch.length ? Math.max(...ch) : new Date(p.updated_at || p.created_at || now).getTime()
    }))
    const days = Math.max(0, Math.floor((Date.now() - since) / DAY_MS))
    const nudgedToday = c.approval_nudged_at && sameDay(c.approval_nudged_at)
    return { c, n: pend.length, days, nudgedToday }
  }).filter(Boolean).sort((a, b) => b.days - a.days)

  const nudge = async (c) => {
    const { error } = await supabase.from('clients').update({ approval_nudged_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { alert('Could not send nudge: ' + error.message); return }
    onRefresh && onRefresh()
  }

  // Coverage: when is each client's next post going out?
  const coverage = clients.filter(c => inScope(c.id)).map(c => {
    const up = posts.filter(p => p.client_id === c.id && p.scheduled_at && ['pending', 'approved', 'scheduled', 'revision'].includes(p.status) && new Date(p.scheduled_at) >= today)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    const nextPost = up[0]
    const gap = nextPost ? Math.round((startOfDay(new Date(nextPost.scheduled_at)) - today) / DAY_MS) : null
    const rev = posts.filter(p => p.client_id === c.id && p.status === 'revision').length
    let level = 'good', text = 'Next ' + (nextPost ? fmtShort(nextPost.scheduled_at) : '')
    const hasDrafts = posts.some(p => p.client_id === c.id && p.status === 'draft')
    if (!nextPost) { level = hasDrafts ? 'warn' : 'bad'; text = hasDrafts ? 'Only drafts' : 'Nothing scheduled' }
    else if (rev > 0) { level = 'bad'; text = rev + ' revision' + (rev !== 1 ? 's' : '') }
    else if (gap > 5) { level = 'warn'; text = 'Next ' + fmtShort(nextPost.scheduled_at) + ' (' + gap + 'd)' }
    return { c, level, text, nextPost }
  }).sort((a, b) => ['bad', 'warn', 'good'].indexOf(a.level) - ['bad', 'warn', 'good'].indexOf(b.level) || a.c.name.localeCompare(b.c.name))
  const dotColor = { good: '#2A7D4F', warn: '#C4893A', bad: '#C0392B' }
  const textColor = { good: PALETTE.muted, warn: '#8A5A00', bad: '#C0392B' }
  const [showAllCoverage, setShowAllCoverage] = useState(false)
  const wrapRef = useRef(null)
  const [wrapW, setWrapW] = useState(1000)
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(entries => { setWrapW(entries[0].contentRect.width) })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])
  const cols = isMobile ? 1 : wrapW >= 1180 ? 3 : wrapW >= 760 ? 2 : 1
  const coverageShown = showAllCoverage ? coverage : coverage.slice(0, 7)

  // Recent activity across everything in scope
  const postById = (id) => posts.find(p => p.id === id)
  const feed = []
  comments.forEach(c => {
    const p = postById(c.post_id)
    if (!p || !inScope(p.client_id)) return
    feed.push({ ts: new Date(c.created_at).getTime(), who: c.author_type === 'agency' ? (c.author || 'Brown Butter') : (c.author || clientOf(p.client_id)?.name || 'Client'), side: c.author_type === 'agency' ? 'team' : 'client', action: 'commented on', detail: p.caption || 'a post', client: clientOf(p.client_id)?.name, clientId: p.client_id, post: p, client_side: c.author_type !== 'agency' })
  })
  statusChanges.forEach(s => {
    if (!['approved', 'revision', 'published'].includes(s.status)) return
    const p = postById(s.post_id)
    if (!p || !inScope(p.client_id)) return
    const verb = s.status === 'approved' ? 'approved' : s.status === 'revision' ? 'asked for revisions on' : 'published'
    feed.push({ ts: new Date(s.created_at).getTime(), who: s.changed_by || clientOf(p.client_id)?.name || 'Someone', side: s.status === 'published' ? 'team' : undefined, action: verb, detail: p.caption || 'a post', client: clientOf(p.client_id)?.name, clientId: p.client_id, post: p, client_side: s.status !== 'published' })
  })
  requests.forEach(r => {
    if (!inScope(r.client_id)) return
    feed.push({ ts: new Date(r.created_at).getTime(), who: clientOf(r.client_id)?.name || 'A client', side: 'client', action: 'sent a request:', detail: r.title, client: clientOf(r.client_id)?.name, clientId: r.client_id, post: null, client_side: true })
  })
  feed.sort((a, b) => b.ts - a.ts)
  const feedShown = feed.slice(0, 8)

  // Recently published
  const published = scoped.filter(p => p.status === 'published').sort((a, b) => new Date(b.scheduled_at || 0) - new Date(a.scheduled_at || 0)).slice(0, 4)

  const eyebrow = { fontFamily: F.body, fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, textTransform: 'uppercase' }
  const boxStyle = { background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, overflow: 'hidden' }
  const rowBase = { display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderTop: '0.5px solid ' + PALETTE.borderLight }
  const hoverOn = e => { e.currentTarget.style.background = PALETTE.creamMid }
  const hoverOff = e => { e.currentTarget.style.background = 'transparent' }
  const Card = ({ title, icon, color = PALETTE.espresso, info, right, accent, children }) => (
    <div style={{ ...boxStyle, marginBottom: 14, breakInside: 'avoid', ...(accent ? { borderColor: PALETTE.caramel } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: PALETTE.creamMid, borderBottom: '0.5px solid ' + PALETTE.borderLight }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          {icon && (
            <span style={{ width: 24, height: 24, borderRadius: 7, background: color + '1F', color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={CARD_ICONS[icon]} /></svg>
            </span>
          )}
          <span style={{ fontFamily: F.body, fontSize: 13, fontWeight: 600, color: PALETTE.espresso, whiteSpace: 'nowrap' }}>{title}</span>
          {info && <InfoTip text={info} />}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
  const Empty = ({ children }) => (
    <div style={{ padding: '16px 16px 18px', fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', borderTop: '0.5px solid ' + PALETTE.borderLight }}>{children}</div>
  )
  const linkBtn = (label, onClick) => (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: F.body, fontSize: 11, color: PALETTE.muted, padding: 0 }}>{label}</button>
  )
  const smallBtn = (label, onClick, dark) => (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} style={{ flexShrink: 0, fontFamily: F.body, fontSize: 11, padding: '5px 11px', borderRadius: 6, cursor: 'pointer', border: '0.5px solid ' + PALETTE.espresso, background: dark ? PALETTE.espresso : 'transparent', color: dark ? '#F5F0E8' : PALETTE.espresso, whiteSpace: 'nowrap' }}>{label}</button>
  )
  const thumb = (p, size = 34) => (
    <div style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: PALETTE.creamDark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {p?.image_url && !isVideo(p.image_url)
        ? <img src={imgSrc(p.image_url, p.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontFamily: F.display, fontSize: 10, color: PALETTE.caramel }}>BB</span>}
    </div>
  )
  const tag = (text, bg, color) => (
    <span style={{ fontFamily: F.body, fontSize: 10, padding: '3px 8px', borderRadius: 4, background: bg, color, whiteSpace: 'nowrap', flexShrink: 0 }}>{text}</span>
  )

  return (
    <div ref={wrapRef} style={{ padding: isMobile ? '20px 16px 40px' : '26px 28px 48px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: F.display, fontSize: isMobile ? 22 : 26, color: PALETTE.espresso, lineHeight: 1.15 }}>{greet}, {firstName}</div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.muted, marginTop: 8, fontWeight: 300 }}>{dateLong} · {summary}.</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {chips.map(t => (
          <button key={t.label} onClick={t.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, border: '0.5px solid ' + PALETTE.borderLight, background: '#fff', cursor: 'pointer', fontFamily: F.body, fontSize: 12, color: t.n === 0 ? PALETTE.mutedLight : (t.hot ? '#C0392B' : PALETTE.espresso) }}>
            <span style={{ fontWeight: 500 }}>{t.n}</span>{t.label}
          </button>
        ))}
      </div>

      <div style={{ columnCount: cols, columnGap: 14 }}>
        {/* Cards flow top to bottom, then into the next column, so the page fills the screen width */}
        <>

          {reminderRows.length > 0 && (
            <Card title="Reminders" icon="bell" color="#C4893A" info="Recurring tasks for the team, like updating reports every Tuesday. Tick one off when it is done and it returns on its next date. Some reminders only show for certain people." accent right={<span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>Repeats</span>}>
              {reminderRows.map(({ r, status, key, daysLate, daysToNext }) => {
                const done = status === 'done'
                const tagEl = status === 'overdue' ? tag(daysLate === 1 ? 'Overdue, 1 day' : 'Overdue, ' + daysLate + ' days', '#F6D9D5', '#7A2018')
                  : status === 'today' ? tag('Today', '#F3E3C6', '#6B4A12')
                  : status === 'done' ? tag('Done', '#DDEBDD', '#2F5A34')
                  : tag(daysToNext === 1 ? 'Tomorrow' : 'In ' + daysToNext + ' days', '#E8E1D3', '#5C4A30')
                const canTick = status !== 'soon'
                return (
                  <div key={r.id} style={{ ...rowBase, opacity: status === 'soon' ? 0.75 : 1 }}>
                    <button onClick={() => canTick && onToggleReminder(r, key, done)} aria-label={done ? 'Mark as not done' : 'Mark as done'} style={{ width: 18, height: 18, borderRadius: 5, border: '1px solid ' + (done ? '#2A7D4F' : PALETTE.muted), background: done ? '#2A7D4F' : 'transparent', cursor: canTick ? 'pointer' : 'default', flexShrink: 0, padding: 0, color: '#fff', fontSize: 11, lineHeight: '16px' }}>{done ? '✓' : ''}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, fontWeight: 500, textDecoration: done ? 'line-through' : 'none' }}>{r.title}</div>
                      <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginTop: 2 }}>{reminderSchedule(r)} · {Array.isArray(r.audience) && r.audience.length ? 'Limited access' : 'Everyone'}</div>
                    </div>
                    {tagEl}
                    {r.link_view && !done && smallBtn(r.link_label || 'Open', () => onOpenReminderLink(r.link_view))}
                  </div>
                )
              })}
            </Card>
          )}

          <Card title="On your plate" icon="list" color="#2C1F0E" info="Posts assigned to you that are not published yet. Revisions come first, then anything going out today, then drafts and everything else by date." right={plate.length > 0 && linkBtn('Show all ' + plate.length, () => onGo('queue', 'active', { mine: true }))}>
            {plateShown.length === 0 ? (
              <Empty>Nothing assigned to you right now. Posts with your name as designer show up here.</Empty>
            ) : plateShown.map(p => {
              const cl = clientOf(p.client_id)
              return (
                <div key={p.id} onClick={() => onSelectPost(p)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                  {thumb(p)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Untitled post'}</div>
                    <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{cl?.name}{p.scheduled_at ? ' · ' + fmt(p.scheduled_at) : ' · Not scheduled'}</div>
                  </div>
                  <Badge status={p.status} />
                </div>
              )
            })}
          </Card>

          <Card title="This week" icon="calendar" color="#3B72B8" info="Everything scheduled Monday to Sunday, one dot per post. Click a day to open the calendar. Next up lists the posts going out soonest." right={linkBtn('Open calendar', () => onGo('calendar'))}>
            <div style={{ display: 'flex', gap: 4, padding: '4px 12px 12px' }}>
              {weekDays.map(d => {
                const items = countOn(d)
                const isToday = d.getTime() === today.getTime()
                return (
                  <button key={d.getTime()} onClick={() => onGo('calendar')} style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '8px 0 6px', borderRadius: 8, border: 'none', cursor: 'pointer', background: isToday ? PALETTE.espresso : 'transparent', color: isToday ? '#F5F0E8' : PALETTE.espresso }}>
                    <div style={{ fontFamily: F.body, fontSize: 10, color: isToday ? '#CDBFA6' : PALETTE.muted }}>{d.toLocaleDateString('en-PH', { weekday: 'short' })}</div>
                    <div style={{ fontFamily: F.body, fontSize: 14, fontWeight: 500, margin: '2px 0 4px' }}>{d.getDate()}</div>
                    <div style={{ height: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2 }}>
                      {items.slice(0, 3).map((p, i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: PALETTE.caramel }} />)}
                      {items.length > 3 && <span style={{ fontFamily: F.body, fontSize: 9 }}>+{items.length - 3}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
            <div style={{ ...eyebrow, padding: '10px 16px 6px', borderTop: '0.5px solid ' + PALETTE.borderLight }}>Next up</div>
            {nextUp.length === 0 ? (
              <Empty>Nothing scheduled ahead. Plan something in the calendar.</Empty>
            ) : nextUp.map(p => (
              <div key={p.id} onClick={() => onSelectPost(p)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                {thumb(p, 30)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Untitled post'}</div>
                  <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{clientOf(p.client_id)?.name} · {fmt(p.scheduled_at)}</div>
                </div>
                <Badge status={p.status} />
              </div>
            ))}
          </Card>

          <Card title="Recent activity" icon="pulse" color="#7A5C8A" info="The latest comments, approvals, revision requests, and client requests. Team members show as avatars and clients as their logos.">
            {feedShown.length === 0 ? (
              <Empty>Comments, approvals, and requests from clients show up here.</Empty>
            ) : feedShown.map((a, i) => (
              <div key={i} onClick={() => a.post ? onSelectPost(a.post) : onGo('requests')} style={{ ...rowBase, cursor: 'pointer', alignItems: 'flex-start' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                <Avatar size={28} actor={resolveActor({ who: a.who, side: a.side, members: teamMembers, client: clientOf(a.clientId), currentUserName, currentUserAvatarUrl })} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso }}><span style={{ fontWeight: 500 }}>{a.who}</span> {a.action}</div>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 300 }}>{a.detail}{a.client ? ' · ' + a.client : ''}</div>
                </div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, flexShrink: 0 }}>{agoShort(a.ts)}</div>
              </div>
            ))}
          </Card>


          <Card title="Waiting on clients" icon="clock" color="#C4893A" info="Clients with posts waiting for their approval, longest wait first. Nudge records that you reminded them and shows a banner in their portal.">
            {waiting.length === 0 ? (
              <Empty>No approvals pending. Nothing to chase.</Empty>
            ) : waiting.map(w => (
              <div key={w.c.id} onClick={() => onPickClient(w.c.id)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, fontWeight: 500 }}>{w.c.name}</div>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: w.days >= 3 ? '#8A5A00' : PALETTE.mutedLight, marginTop: 2 }}>{w.n} post{w.n !== 1 ? 's' : ''} · {w.days === 0 ? 'since today' : w.days + ' day' + (w.days !== 1 ? 's' : '')}</div>
                  <div style={{ fontFamily: F.body, fontSize: 10, color: seenInfo(w.c.portal_last_seen_at).color, marginTop: 1 }}>{seenInfo(w.c.portal_last_seen_at).text}</div>
                </div>
                {w.nudgedToday
                  ? <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>Nudged today</span>
                  : smallBtn('Nudge', () => nudge(w.c))}
              </div>
            ))}
          </Card>

          <Card title="Open requests" icon="inbox" color="#B5532F" info="Requests clients sent from their portal that are still new or in progress. Client replied means the client wrote last and is waiting on you." right={openReqList.length > 0 && linkBtn('View all', () => onGo('requests'))}>
            {openReqList.length === 0 ? (
              <Empty>No open requests.</Empty>
            ) : openReqList.slice(0, 5).map(r => {
              const replies = requestReplies.filter(x => x.request_id === r.id)
              const lastClient = replies.length && replies[replies.length - 1].author_type === 'client'
              return (
                <div key={r.id} onClick={() => onGo('requests')} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                    <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{clientOf(r.client_id)?.name} · {agoShort(new Date(r.created_at).getTime())}</div>
                  </div>
                  {lastClient ? tag('Client replied', '#F3E3C6', '#6B4A12') : r.status === 'new' ? tag('New', '#E8E1D3', '#5C4A30') : null}
                </div>
              )
            })}
          </Card>

          <Card title="Client coverage" icon="shield" color="#2A7D4F" info="When the next post goes out for each client. Red means nothing is scheduled or revisions are open. Amber means the next post is more than 5 days away, or only drafts exist. Green means they are covered." right={coverage.length > 7 && linkBtn(showAllCoverage ? 'Show less' : 'Show all ' + coverage.length, () => setShowAllCoverage(o => !o))}>
            {coverage.length === 0 ? (
              <Empty>No clients yet.</Empty>
            ) : coverageShown.map(h => (
              <div key={h.c.id} onClick={() => onPickClient(h.c.id)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor[h.level], flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.c.name}</div>
                <div style={{ fontFamily: F.body, fontSize: 11, color: textColor[h.level], flexShrink: 0 }}>{h.text}</div>
              </div>
            ))}
          </Card>

          <Card title="Client portal visits" icon="eye" color="#3B72B8" info="When each client last opened their portal. Green is within a day, grey within a week, amber after that. Team previews using ?preview in the link are not counted.">
            {clients.length === 0 ? (
              <Empty>No clients yet.</Empty>
            ) : [...clients].filter(c => inScope(c.id)).sort((a, b) => new Date(b.portal_last_seen_at || 0) - new Date(a.portal_last_seen_at || 0)).map(c => {
              const si = seenInfo(c.portal_last_seen_at)
              return (
                <div key={c.id} onClick={() => onPickClient(c.id)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                  <Avatar size={24} actor={{ kind: 'client', name: c.name, src: c.logo_url, color: c.brand_color || PALETTE.caramel }} />
                  <div style={{ flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ fontFamily: F.body, fontSize: 11, color: si.color, flexShrink: 0 }}>{c.portal_last_seen_at ? agoShort(new Date(c.portal_last_seen_at).getTime()) : 'Never'}</div>
                </div>
              )
            })}
          </Card>

          <Card title="Recently published" icon="check" color="#2A7D4F" info="The latest posts marked as published, newest first.">
            {published.length === 0 ? (
              <Empty>Published posts show up here.</Empty>
            ) : published.map(p => (
              <div key={p.id} onClick={() => onSelectPost(p)} style={{ ...rowBase, cursor: 'pointer' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                {thumb(p, 30)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption || 'Untitled post'}</div>
                  <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{clientOf(p.client_id)?.name} · {fmtShort(p.scheduled_at)}</div>
                </div>
              </div>
            ))}
          </Card>
        </>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [session, setSession] = useState(undefined) // undefined = still checking, null = logged out
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email || 'Brown Butter'
  const currentUserEmail = session?.user?.email || ''
  const currentUserFirstName = (session?.user?.user_metadata?.full_name || session?.user?.email || 'there').split(/[\s@]/)[0]
  const currentUserAvatarUrl = session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || null
  const currentUserInitials = currentUserName.slice(0, 2).toUpperCase()

  const [clients, setClients] = useState([])
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [versions, setVersions] = useState([])
  const [requests, setRequests] = useState([])
  const [statusChanges, setStatusChanges] = useState([])
  const [designOptions, setDesignOptions] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [selectedClient, setSelectedClient] = useState('all')
  const [filter, setFilter] = useState('pending')
  const [view, setView] = useState('today')
  const [selectedPost, setSelectedPost] = useState(null)
  const [composing, setComposing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarFileRef = useRef()
  const [seenIds, setSeenIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('bb_seen_notifs') || '[]')) } catch { return new Set() }
  })
  const [pwEditClientId, setPwEditClientId] = useState(null)
  const [pwDraft, setPwDraft] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [hubClientId, setHubClientId] = useState(null)
  const [hubInitialTab, setHubInitialTab] = useState('notes')
  const [showClientMenu, setShowClientMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [requestReplies, setRequestReplies] = useState([])
  const [reminders, setReminders] = useState([])
  // Keep the logged-in person's avatar on their team_members row so teammates see it in feeds
  const avatarSynced = useRef('')
  useEffect(() => {
    if (!currentUserAvatarUrl || teamMembers.length === 0) return
    const me = teamMembers.find(m => (m.email && currentUserEmail && m.email.toLowerCase() === currentUserEmail.toLowerCase()) || namesMatch(m.name, currentUserName)) || findMember(teamMembers, currentUserName)
    if (!me || me.avatar_url === currentUserAvatarUrl || avatarSynced.current === me.id + currentUserAvatarUrl) return
    avatarSynced.current = me.id + currentUserAvatarUrl
    supabase.from('team_members').update({ avatar_url: currentUserAvatarUrl }).eq('id', me.id).then(() => {})
  }, [teamMembers, currentUserAvatarUrl, currentUserEmail, currentUserName])
  const [reminderCompletions, setReminderCompletions] = useState([])
  const [mineOnly, setMineOnly] = useState(() => {
    try { return localStorage.getItem('bb_mine_only') === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem('bb_mine_only', mineOnly ? '1' : '0') } catch {}
  }, [mineOnly])
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowSearch(o => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── SPEED FIX 1: fetchAll only called on mount; realtime channels do targeted single-table refreshes ──
  const fetchAll = async () => {
    const [c, p, cm, v, rq, sc, dop, tm, rr, rem, remc] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('posts').select('*').neq('status', 'archived').order('scheduled_at').limit(150),
      supabase.from('comments').select('*').order('created_at'),
      supabase.from('versions').select('*').order('created_at'),
      supabase.from('requests').select('*').order('created_at', { ascending: false }),
      supabase.from('status_changes').select('*').order('created_at'),
      supabase.from('design_options').select('*').order('created_at'),
      supabase.from('team_members').select('*').order('name'),
      supabase.from('request_replies').select('*').order('created_at'),
      supabase.from('recurring_reminders').select('*').order('created_at'),
      supabase.from('reminder_completions').select('*')
    ])
    if (c.data) setClients(c.data)
    if (p.data) setPosts(p.data)
    if (cm.data) setComments(cm.data)
    if (v.data) setVersions(v.data)
    if (rq.data) setRequests(rq.data)
    if (sc.data) setStatusChanges(sc.data)
    if (dop.data) setDesignOptions(dop.data)
    if (tm.data) setTeamMembers(tm.data)
    if (rr.data) setRequestReplies(rr.data)
    if (rem.data) setReminders(rem.data)
    if (remc.data) setReminderCompletions(remc.data)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()

    // ── SPEED FIX 2: targeted per-table refreshes instead of full fetchAll on every event ──
    const s1 = supabase.channel('dash-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => {
        supabase.from('posts').select('*').neq('status', 'archived').order('scheduled_at').limit(150)
          .then(({ data }) => { if (data) setPosts(data) })
      }).subscribe()

    const s2 = supabase.channel('dash-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
        supabase.from('comments').select('*').order('created_at')
          .then(({ data }) => { if (data) setComments(data) })
      }).subscribe()

    const s3 = supabase.channel('dash-versions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'versions' }, () => {
        supabase.from('versions').select('*').order('created_at')
          .then(({ data }) => { if (data) setVersions(data) })
      }).subscribe()

    const s4 = supabase.channel('dash-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, () => {
        supabase.from('requests').select('*').order('created_at', { ascending: false })
          .then(({ data }) => { if (data) setRequests(data) })
      }).subscribe()

    const s5 = supabase.channel('dash-status-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'status_changes' }, () => {
        supabase.from('status_changes').select('*').order('created_at')
          .then(({ data }) => { if (data) setStatusChanges(data) })
      }).subscribe()

    const s6 = supabase.channel('dash-design-options')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_options' }, () => {
        supabase.from('design_options').select('*').order('created_at')
          .then(({ data }) => { if (data) setDesignOptions(data) })
      }).subscribe()

    const s7 = supabase.channel('dash-team-members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, () => {
        supabase.from('team_members').select('*').order('name')
          .then(({ data }) => { if (data) setTeamMembers(data) })
      }).subscribe()

    const s8 = supabase.channel('dash-request-replies')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'request_replies' }, () => {
        supabase.from('request_replies').select('*').order('created_at')
          .then(({ data }) => { if (data) setRequestReplies(data) })
      }).subscribe()

    const s9 = supabase.channel('dash-reminders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_reminders' }, () => {
        supabase.from('recurring_reminders').select('*').order('created_at')
          .then(({ data }) => { if (data) setReminders(data) })
      }).subscribe()

    const s10 = supabase.channel('dash-reminder-completions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminder_completions' }, () => {
        supabase.from('reminder_completions').select('*')
          .then(({ data }) => { if (data) setReminderCompletions(data) })
      }).subscribe()

    const s11 = supabase.channel('dash-clients')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clients' }, () => {
        supabase.from('clients').select('*').order('name')
          .then(({ data }) => { if (data) setClients(data) })
      }).subscribe()

    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe(); s4.unsubscribe(); s5.unsubscribe(); s6.unsubscribe(); s7.unsubscribe(); s8.unsubscribe(); s9.unsubscribe(); s10.unsubscribe(); s11.unsubscribe() }
  }, [])

  // ── Drag and drop rescheduling (calendar + grid) ──
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const fmtWhen = (iso) => new Date(iso).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

  const savePostTimes = async (changes) => {
    // changes: [{ post, iso }]. Optimistic update, rolled back if the save fails.
    const prevPosts = posts
    setPosts(ps => ps.map(p => { const c = changes.find(x => x.post.id === p.id); return c ? { ...p, scheduled_at: c.iso } : p }))
    setSelectedPost(sp => { const c = sp && changes.find(x => x.post.id === sp.id); return c ? { ...sp, scheduled_at: c.iso } : sp })
    const results = await Promise.all(changes.map(c => supabase.from('posts').update({ scheduled_at: c.iso }).eq('id', c.post.id)))
    const failed = results.find(r => r.error)
    if (failed) {
      setPosts(prevPosts)
      setSelectedPost(sp => { const c = sp && changes.find(x => x.post.id === sp.id); return c ? { ...sp, scheduled_at: c.post.scheduled_at } : sp })
      alert('Could not reschedule: ' + failed.error.message)
      return
    }
    await supabase.from('versions').insert(changes.map(c => ({
      post_id: c.post.id,
      version_number: versions.filter(v => v.post_id === c.post.id).length + 1,
      note: 'rescheduled to ' + fmtWhen(c.iso),
      author: currentUserName,
    })))
  }

  // Calendar: same time, different day
  const movePostToDay = (post, day) => {
    if (!post.scheduled_at || post.status === 'published') return
    const old = new Date(post.scheduled_at)
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes(), old.getSeconds())
    if (next.getTime() === old.getTime()) return
    savePostTimes([{ post, iso: next.toISOString() }])
  }

  // Grid: dropping one tile on another swaps their dates, each keeping its own time
  // (same-day posts swap times instead, so the order still changes)
  const swapPostDates = (a, b) => {
    if (!a || !b || a.id === b.id || a.client_id !== b.client_id || a.status === 'published' || b.status === 'published') return
    const da = new Date(a.scheduled_at), db = new Date(b.scheduled_at)
    const sameDate = da.toDateString() === db.toDateString()
    const withDate = (time, date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes(), time.getSeconds()).toISOString()
    savePostTimes(sameDate
      ? [{ post: a, iso: db.toISOString() }, { post: b, iso: da.toISOString() }]
      : [{ post: a, iso: withDate(da, db) }, { post: b, iso: withDate(db, da) }])
  }

  const gridDnD = (post) => {
    const movable = post.status !== 'published'
    return {
      draggable: movable,
      onDragStart: (e) => { if (!movable) { e.preventDefault(); return } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', post.id); setDragId(post.id) },
      onDragEnd: () => { setDragId(null); setDragOverId(null) },
      onDragOver: (e) => {
        if (!dragId || dragId === post.id || !movable) return
        const src = posts.find(p => p.id === dragId)
        if (src && src.client_id === post.client_id) { e.preventDefault(); if (dragOverId !== post.id) setDragOverId(post.id) }
      },
      onDragLeave: () => { if (dragOverId === post.id) setDragOverId(null) },
      onDrop: (e) => {
        e.preventDefault()
        const src = posts.find(p => p.id === dragId)
        setDragId(null); setDragOverId(null)
        swapPostDates(src, post)
      },
    }
  }

  const reminderDone = useMemo(() => new Set(reminderCompletions.map(c => c.reminder_id + '|' + c.period_key)), [reminderCompletions])
  const toggleReminder = async (r, key, isDone) => {
    // Optimistic update so the tick feels instant; realtime confirms it
    if (isDone) {
      setReminderCompletions(prev => prev.filter(c => !(c.reminder_id === r.id && c.period_key === key)))
      const { error } = await supabase.from('reminder_completions').delete().eq('reminder_id', r.id).eq('period_key', key)
      if (error) { alert('Could not update reminder: ' + error.message); fetchAll() }
    } else {
      setReminderCompletions(prev => [...prev, { reminder_id: r.id, period_key: key, done_by: currentUserEmail }])
      const { error } = await supabase.from('reminder_completions').insert({ reminder_id: r.id, period_key: key, done_by: currentUserEmail })
      if (error) { alert('Could not update reminder: ' + error.message); fetchAll() }
    }
  }
  const openReminderLink = (target) => {
    if (target === 'billing') {
      const cid = selectedClient !== 'all' ? selectedClient : clients[0]?.id
      if (!cid) return
      setSelectedClient(cid); setHubInitialTab('billing'); setHubClientId(cid); setView('hub')
    } else {
      setView(target)
    }
  }

  // ── SPEED FIX 3: notifications built with useMemo instead of useEffect + setState ──
  const notifications = useMemo(() => {
    const notifs = []
    posts.forEach(p => {
      const client = clients.find(c => c.id === p.client_id)
      const clientName = client?.name || 'Unknown client'
      const caption = p.caption?.slice(0, 40) + (p.caption?.length > 40 ? '…' : '')
      if (p.status === 'approved') notifs.push({ id: 'post-approved-' + p.id, message: '"' + caption + '" was approved', client: clientName, created_at: p.updated_at || p.created_at, read: seenIds.has('post-approved-' + p.id), postId: p.id })
      if (p.status === 'revision') notifs.push({ id: 'post-revision-' + p.id, message: '"' + caption + '" — revisions requested', client: clientName, created_at: p.updated_at || p.created_at, read: seenIds.has('post-revision-' + p.id), postId: p.id })
      if (namesMatch(p.designer, currentUserName)) notifs.push({ id: 'post-assigned-' + p.id, message: 'A post from ' + clientName + ' was assigned to you', client: clientName, created_at: p.updated_at || p.created_at, read: seenIds.has('post-assigned-' + p.id), postId: p.id })
    })
    comments.filter(c => c.author_type === 'client').forEach(c => {
      const post = posts.find(p => p.id === c.post_id)
      const client = clients.find(cl => cl.id === post?.client_id)
      notifs.push({ id: 'comment-' + c.id, message: c.author + ' left a comment: "' + (c.text?.slice(0, 40) || '') + '…"', client: client?.name || 'Client', created_at: c.created_at, read: seenIds.has('comment-' + c.id), postId: c.post_id })
    })
    requests.forEach(r => {
      const client = clients.find(c => c.id === r.client_id)
      const clientName = client?.name || 'Client'
      if (r.status === 'new') {
        notifs.push({ id: 'request-new-' + r.id, message: clientName + ' submitted a request: "' + r.title + '"', client: clientName, created_at: r.created_at, read: seenIds.has('request-new-' + r.id), type: 'request' })
      }
    })
    notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return notifs
  }, [posts, comments, clients, requests, seenIds, currentUserName])

  const markOneRead = (id) => {
    const newSeen = new Set([...seenIds, id])
    setSeenIds(newSeen)
    try { localStorage.setItem('bb_seen_notifs', JSON.stringify([...newSeen])) } catch {}
  }

  const handleNotificationClick = (n) => {
    markOneRead(n.id)
    setShowNotifications(false)
    if (n.type === 'request') {
      setView('requests')
    } else if (n.postId) {
      const post = posts.find(p => p.id === n.postId)
      if (post) setSelectedPost(post)
    }
  }

  const markAllRead = () => {
    const allIds = notifications.map(n => n.id)
    const newSeen = new Set([...seenIds, ...allIds])
    setSeenIds(newSeen)
    try { localStorage.setItem('bb_seen_notifs', JSON.stringify([...newSeen])) } catch {}
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    const { url, error } = await uploadAsset(file)
    if (url) {
      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: url } })
      if (updateError) alert('Could not update your avatar: ' + updateError.message)
    }
    if (error) alert('Could not upload avatar: ' + error)
    setUploadingAvatar(false)
    setShowUserMenu(false)
    e.target.value = ''
  }

  const startEditPassword = (client) => {
    setPwEditClientId(client.id)
    setPwDraft(client.portal_password || '')
  }

  const savePortalPassword = async () => {
    if (!pwEditClientId) return
    setPwSaving(true)
    await supabase.from('clients').update({ portal_password: pwDraft.trim() || null }).eq('id', pwEditClientId)
    setClients(prev => prev.map(c => c.id === pwEditClientId ? { ...c, portal_password: pwDraft.trim() || null } : c))
    setPwSaving(false)
    setPwEditClientId(null)
    setPwDraft('')
  }

  const unreadCount = notifications.filter(n => !n.read).length

  // Open request count per client, for the sidebar badge
  const openRequestCountByClient = useMemo(() => {
    const map = {}
    requests.forEach(r => {
      if (r.status === 'new' || r.status === 'in_progress') {
        map[r.client_id] = (map[r.client_id] || 0) + 1
      }
    })
    return map
  }, [requests])

  // ── SPEED FIX 4: archived posts fetched separately only when filter === 'archived' ──
  const [archivedPosts, setArchivedPosts] = useState([])
  const [archivedLoaded, setArchivedLoaded] = useState(false)
  useEffect(() => {
    if (filter === 'archived' && !archivedLoaded) {
      supabase.from('posts').select('*').eq('status', 'archived').order('scheduled_at')
        .then(({ data }) => { if (data) { setArchivedPosts(data); setArchivedLoaded(true) } })
    }
  }, [filter, archivedLoaded])

  const activePosts = posts
  const base = filter === 'archived' ? archivedPosts : activePosts
  const scopeOk = (p) => (selectedClient === 'all' || p.client_id === selectedClient) && (!mineOnly || namesMatch(p.designer, currentUserName))
  const clientFiltered = base.filter(scopeOk)
  const filteredPosts = filter === 'archived' || filter === 'active' ? clientFiltered : clientFiltered.filter(p => p.status === filter)
  const myActiveCount = activePosts.filter(p => (selectedClient === 'all' || p.client_id === selectedClient) && namesMatch(p.designer, currentUserName)).length

  const counts = {
    active: activePosts.filter(scopeOk).length,
    draft: activePosts.filter(p => p.status === 'draft' && scopeOk(p)).length,
    pending: activePosts.filter(p => p.status === 'pending' && scopeOk(p)).length,
    approved: activePosts.filter(p => p.status === 'approved' && scopeOk(p)).length,
    scheduled: activePosts.filter(p => p.status === 'scheduled' && scopeOk(p)).length,
    revision: activePosts.filter(p => p.status === 'revision' && scopeOk(p)).length,
    published: activePosts.filter(p => p.status === 'published' && scopeOk(p)).length,
    archived: archivedPosts.filter(scopeOk).length,
  }

  const pageTitle = filter === 'active' ? "Today's pass" : filter === 'draft' ? 'Drafts (hidden from clients)' : filter === 'archived' ? 'Archived' : filter === 'pending' ? 'Awaiting Approval' : filter === 'revision' ? 'Revisions Requested' : filter === 'approved' ? 'Approved' : filter === 'scheduled' ? 'Scheduled' : 'Published'

  // "What you need to see" summary — scoped to posts assigned to the
  // logged-in user specifically (via the designer field), so it reads as a
  // personal to-do digest rather than a team-wide status repeat. Requests
  // aren't assigned to individual team members, so that count stays team-wide.
  const myPosts = activePosts.filter(p => namesMatch(p.designer, currentUserName))
  const myPendingCount = myPosts.filter(p => p.status === 'pending' && (selectedClient === 'all' || p.client_id === selectedClient)).length
  const myRevisionCount = myPosts.filter(p => p.status === 'revision' && (selectedClient === 'all' || p.client_id === selectedClient)).length
  const todayPostsCount = useMemo(() => {
    const now = new Date()
    return myPosts.filter(p => {
      if (selectedClient !== 'all' && p.client_id !== selectedClient) return false
      const d = new Date(p.scheduled_at)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    }).length
  }, [myPosts, selectedClient])
  const openRequestsCount = requests.filter(r => (r.status === 'new' || r.status === 'in_progress') && (selectedClient === 'all' || r.client_id === selectedClient)).length

  if (session === undefined) {
    return (
      <div className="bb-app-shell" style={{ background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: F.display, fontSize: 18, color: PALETTE.mutedLight }}>Loading…</span>
      </div>
    )
  }

  if (!session) {
    return <LoginScreen />
  }

  const todayShort = new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })

  const pickClient = (id) => {
    setSelectedClient(id)
    setView(view === 'hub' ? 'today' : view)
    setShowClientMenu(false)
    if (isMobile) setSidebarOpen(false)
  }

  const clientSwitcher = (light) => {
    const cur = selectedClient === 'all' ? null : clients.find(c => c.id === selectedClient)
    return (
      <div style={{ position: 'relative', width: light ? '100%' : 'auto' }}>
        <button onClick={e => { e.stopPropagation(); setShowClientMenu(o => !o) }} style={{ width: light ? '100%' : 'auto', minWidth: light ? 0 : 170, maxWidth: light ? 'none' : 240, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, border: '0.5px solid ' + (light ? PALETTE.border : '#4a3a28'), background: light ? '#fff' : 'transparent', color: light ? PALETTE.espresso : PALETTE.cream, fontFamily: F.body, fontSize: 12, cursor: 'pointer' }}
          onMouseEnter={e => { if (!light) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={e => { if (!light) e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cur?.brand_color || PALETTE.caramel, flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur ? cur.name : 'All clients'}</span>
          <span style={{ fontSize: 10, color: light ? PALETTE.mutedLight : '#7a5a3a' }}>▾</span>
        </button>
        {showClientMenu && (
          <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 40, left: 0, width: light ? '100%' : 280, maxHeight: '70vh', overflowY: 'auto', background: '#fff', borderRadius: 10, border: '0.5px solid ' + PALETTE.border, boxShadow: '0 8px 32px rgba(44,31,14,0.16)', zIndex: 300, padding: 6 }}>
            {[{ id: 'all', name: 'All clients', brand_color: PALETTE.caramel }, ...clients].map(c => {
              const isAll = c.id === 'all'
              const pend = isAll ? 0 : posts.filter(p => p.client_id === c.id && p.status === 'pending').length
              const reqN = isAll ? 0 : (openRequestCountByClient[c.id] || 0)
              return (
                <div key={c.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button onClick={() => pickClient(c.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '8px 9px', borderRadius: 6, border: 'none', background: selectedClient === c.id ? PALETTE.creamDark : 'transparent', color: PALETTE.espresso, fontWeight: selectedClient === c.id ? 500 : 400, fontSize: 12, fontFamily: F.body, display: 'flex', alignItems: 'center', gap: 8 }}
                      onMouseEnter={e => { if (selectedClient !== c.id) e.currentTarget.style.background = PALETTE.creamMid }}
                      onMouseLeave={e => { if (selectedClient !== c.id) e.currentTarget.style.background = 'transparent' }}
                    >
                      {isAll
                        ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.caramel, flexShrink: 0 }} />
                        : (
                          <span style={{ width: 20, height: 20, borderRadius: '50%', background: c.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                            {c.logo_url ? <img src={c.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (c.name || 'BB').slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                      {pend > 0 && <span style={{ fontSize: 10, color: '#8A5A00', flexShrink: 0 }}>{pend} pending</span>}
                      {reqN > 0 && <span style={{ background: PALETTE.caramel, color: '#fff', borderRadius: 8, minWidth: 15, height: 15, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>{reqN}</span>}
                    </button>
                    {!isAll && (
                      <button onClick={() => pwEditClientId === c.id ? setPwEditClientId(null) : startEditPassword(c)} title={c.portal_password ? 'Portal password set' : 'Set portal password'} style={{ flexShrink: 0, background: 'none', border: 'none', padding: '4px 6px', borderRadius: 4, fontSize: 11, color: c.portal_password ? PALETTE.caramel : PALETTE.mutedLight, opacity: pwEditClientId === c.id ? 1 : 0.6 }}
                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                        onMouseLeave={e => e.currentTarget.style.opacity = pwEditClientId === c.id ? 1 : 0.6}
                      >{c.portal_password ? '🔒' : '🔓'}</button>
                    )}
                  </div>
                  {pwEditClientId === c.id && (
                    <div style={{ margin: '2px 0 8px', padding: '8px', background: PALETTE.creamDark, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        type="text"
                        value={pwDraft}
                        onChange={e => setPwDraft(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && savePortalPassword()}
                        placeholder="Portal password (blank = no lock)"
                        autoFocus
                        style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontSize: 11, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={() => setPwEditClientId(null)} style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontFamily: F.body, fontSize: 10, color: PALETTE.muted }}>Cancel</button>
                        <button onClick={savePortalPassword} disabled={pwSaving} style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', background: PALETTE.espresso, fontFamily: F.body, fontSize: 10, color: PALETTE.cream, opacity: pwSaving ? 0.6 : 1 }}>{pwSaving ? 'Saving…' : 'Save'}</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const reqBadgeCount = requests.filter(r => (r.status === 'new' || r.status === 'in_progress') && (selectedClient === 'all' || r.client_id === selectedClient)).length
  const railItems = [
    ['today', 'Today'],
    ['queue', 'Content'],
    ['calendar', 'Calendar'],
    ['grid', 'Grid preview'],
    ['requests', 'Requests'],
    ['reports', 'Marketing reports'],
  ]
  const filterChips = [['active', 'Everything', counts.active], ['draft', 'Drafts', counts.draft], ['pending', 'Awaiting approval', counts.pending], ['revision', 'Revisions', counts.revision], ['approved', 'Approved', counts.approved], ['scheduled', 'Scheduled', counts.scheduled], ['published', 'Published', counts.published], ['archived', 'Archived', counts.archived]]

  return (
    <div className="bb-app-shell" style={{ background: PALETTE.cream, fontFamily: F.body, display: 'flex', flexDirection: 'column' }} onClick={() => { showNotifications && setShowNotifications(false); showUserMenu && setShowUserMenu(false); showClientMenu && setShowClientMenu(false) }}>
      <div style={{ background: PALETTE.espresso, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', color: PALETTE.cream, fontSize: 20, padding: '4px 6px', lineHeight: 1 }}>☰</button>
          )}
          <span style={{ fontFamily: F.display, color: PALETTE.cream, fontSize: 17 }}>Brown Butter</span>
          {!isMobile && <span style={{ color: PALETTE.espressoLight, fontSize: 12 }}>|</span>}
          {!isMobile && clientSwitcher(false)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isMobile && <span style={{ fontFamily: F.body, fontSize: 11, color: '#c9b89a', marginRight: 4, whiteSpace: 'nowrap' }}>{todayShort}</span>}
          <button onClick={e => { e.stopPropagation(); setShowSearch(true) }} title="Search (Ctrl or Cmd + K)" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: '0.5px solid #4a3a28', borderRadius: 6, padding: isMobile ? '6px 9px' : '6px 10px', color: '#c9b89a', fontFamily: F.body, fontSize: 11, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            <span style={{ fontSize: 13, lineHeight: 1 }}>🔍</span>
            {!isMobile && <><span>Search</span><span style={{ fontSize: 10, color: '#7a5a3a', border: '0.5px solid #4a3a28', borderRadius: 4, padding: '1px 5px' }}>⌘K</span></>}
          </button>
          <button onClick={e => { e.stopPropagation(); setShowNotifications(!showNotifications) }} style={{ position: 'relative', background: 'none', border: 'none', color: unreadCount > 0 ? PALETTE.cream : '#7a5a3a', fontSize: 18, lineHeight: 1, padding: '10px', margin: '-6px', borderRadius: 8, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
          >
            🔔
            {unreadCount > 0 && <span style={{ position: 'absolute', top: 6, right: 6, background: '#C0392B', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.body, fontWeight: 700, border: '1.5px solid ' + PALETTE.espresso }}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          <button onClick={() => setComposing(true)} style={{ padding: isMobile ? '6px 10px' : '6px 16px', borderRadius: 6, border: 'none', background: PALETTE.caramel, color: PALETTE.cream, fontFamily: F.body, fontSize: 11, fontWeight: 500, letterSpacing: '0.03em', transition: 'background 0.15s', whiteSpace: 'nowrap' }}
            onMouseEnter={e => e.currentTarget.style.background = '#5F493B'}
            onMouseLeave={e => e.currentTarget.style.background = PALETTE.caramel}
          >+ New Post</button>
          {!isMobile && (
            <div style={{ position: 'relative' }}>
              <button onClick={e => { e.stopPropagation(); setShowUserMenu(o => !o) }} title={'Signed in as ' + currentUserName} style={{ background: 'none', border: '0.5px solid #4a3a28', borderRadius: 6, padding: '6px 10px 6px 6px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: PALETTE.cream, fontFamily: F.body, flexShrink: 0, overflow: 'hidden' }}>
                  {currentUserAvatarUrl ? <img src={currentUserAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : currentUserInitials}
                </div>
                <span style={{ fontFamily: F.body, fontSize: 11, color: '#c9b89a', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUserName}</span>
                <span style={{ fontFamily: F.body, fontSize: 10, color: '#7a5a3a' }}>▾</span>
              </button>
              {showUserMenu && (
                <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 42, right: 0, width: 190, background: '#fff', borderRadius: 10, border: '0.5px solid ' + PALETTE.border, boxShadow: '0 8px 32px rgba(44,31,14,0.16)', zIndex: 300, overflow: 'hidden' }}>
                  <button onClick={() => avatarFileRef.current.click()} disabled={uploadingAvatar} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, borderBottom: '0.5px solid ' + PALETTE.borderLight }}
                    onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >{uploadingAvatar ? 'Uploading…' : 'Change avatar'}</button>
                  <button onClick={() => supabase.auth.signOut()} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', fontFamily: F.body, fontSize: 12, color: '#C0392B' }}
                    onMouseEnter={e => e.currentTarget.style.background = PALETTE.creamMid}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >Log out</button>
                </div>
              )}
              <input ref={avatarFileRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            </div>
          )}
        </div>
        {showNotifications && <NotificationsPanel notifications={notifications} onClose={() => setShowNotifications(false)} onMarkAllRead={markAllRead} onSelect={handleNotificationClick} />}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, top: 52, background: 'rgba(0,0,0,0.35)', zIndex: 150 }} />
        )}
        <div style={isMobile ? {
                position: 'fixed', top: 52, left: 0, bottom: 0, width: '78vw', maxWidth: 280,
                background: PALETTE.cream, borderRight: '0.5px solid ' + PALETTE.border,
                display: 'flex', flexDirection: 'column', overflowY: 'auto', WebkitOverflowScrolling: 'touch', zIndex: 200,
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.2s ease',
                boxShadow: sidebarOpen ? '4px 0 20px rgba(0,0,0,0.25)' : 'none'
    } : {
                width: 200, background: PALETTE.cream, borderRight: '0.5px solid ' + PALETTE.border,
                flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column'
    }}>
          {isMobile && (
            <div style={{ padding: '14px 12px 0' }}>
              <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>Client</div>
              {clientSwitcher(true)}
            </div>
          )}
          <div style={{ padding: '16px 12px 8px' }}>
            {railItems.map(([k, l]) => (
              <button key={k} onClick={() => { setView(k); if (isMobile) setSidebarOpen(false) }} style={{ width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 6, border: 'none', background: view === k ? PALETTE.creamDark : 'transparent', color: view === k ? PALETTE.espresso : PALETTE.muted, fontWeight: view === k ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 2, transition: 'all 0.12s', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={e => { if (view !== k) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={e => { if (view !== k) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><NavIcon name={k} />{l}</span>
                {k === 'requests' && reqBadgeCount > 0 && (
                  <span style={{ fontSize: 10, color: view === k ? PALETTE.caramel : PALETTE.mutedLight, fontWeight: 500 }}>{reqBadgeCount}</span>
                )}
              </button>
            ))}
            {selectedClient !== 'all' && (
              <>
                <div style={{ height: '0.5px', background: PALETTE.border, margin: '12px 2px 12px' }} />
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 10px 8px' }}>Client hub</div>
                {[['notes', 'Meeting notes'], ['links', 'Important links'], ...(canAccessBilling(currentUserEmail) ? [['billing', 'Billing']] : [])].map(([k, l]) => {
                  const active = view === 'hub' && hubInitialTab === k
                  return (
                    <button key={k} onClick={() => { setHubInitialTab(k); setHubClientId(selectedClient); setView('hub'); if (isMobile) setSidebarOpen(false) }} style={{ width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 6, border: 'none', background: active ? PALETTE.creamDark : 'transparent', color: active ? PALETTE.espresso : PALETTE.muted, fontWeight: active ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 2, transition: 'all 0.12s', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                    ><span style={{ display: 'flex', alignItems: 'center', gap: 9 }}><NavIcon name={k} />{l}</span></button>
                  )
                })}
              </>
            )}
          </div>

          <div style={{ padding: '6px 12px 8px' }}>
            <div style={{ height: '0.5px', background: PALETTE.border, margin: '4px 2px 12px' }} />
            <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 10px 8px' }}>Clients</div>
            {clients.map(c => {
              const active = selectedClient === c.id
              const pend = posts.filter(p => p.client_id === c.id && p.status === 'pending').length
              const rev = posts.filter(p => p.client_id === c.id && p.status === 'revision').length
              return (
                <button key={c.id} onClick={() => { setSelectedClient(active ? 'all' : c.id); setView('today'); if (isMobile) setSidebarOpen(false) }} title={active ? 'Show all clients' : 'Open ' + c.name} style={{ width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6, border: 'none', background: active ? PALETTE.creamDark : 'transparent', color: active ? PALETTE.espresso : PALETTE.muted, fontWeight: active ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 1, display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <Avatar size={20} actor={{ name: c.name, src: c.logo_url, color: c.brand_color || PALETTE.caramel }} />
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  {rev > 0 ? <span style={{ fontSize: 10, color: '#C0392B', fontWeight: 500 }}>{rev}</span>
                    : pend > 0 ? <span style={{ fontSize: 10, color: '#8A5A00', fontWeight: 500 }}>{pend}</span> : null}
                </button>
              )
            })}
          </div>

          {(() => {
            const up = posts.filter(p => p.scheduled_at && ['approved', 'scheduled'].includes(p.status) && new Date(p.scheduled_at) >= new Date())
              .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0]
            if (!up) return null
            const cl = clients.find(c => c.id === up.client_id)
            return (
              <div style={{ marginTop: 'auto', padding: '12px' }}>
                <div onClick={() => { setSelectedPost(up); if (isMobile) setSidebarOpen(false) }} style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                  <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Posting next</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar size={22} actor={{ name: cl?.name, src: cl?.logo_url, color: cl?.brand_color || PALETTE.caramel }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.espresso, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cl?.name}</div>
                      <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.muted }}>{fmt(up.scheduled_at)}</div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', minWidth: 0, WebkitOverflowScrolling: 'touch' }}>
          {view !== 'today' && view !== 'overview' && view !== 'hub' && view !== 'reports' && (
          <div style={{ padding: '20px 26px 14px', borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid }}>
            {view === 'requests' ? (
              <>
                <div style={{ fontFamily: F.display, fontSize: 26, color: PALETTE.espresso, lineHeight: 1 }}>Requests</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>
                  {requests.filter(r => selectedClient === 'all' || r.client_id === selectedClient).length} request{requests.filter(r => selectedClient === 'all' || r.client_id === selectedClient).length !== 1 ? 's' : ''} · {selectedClient === 'all' ? 'All clients' : clients.find(c => c.id === selectedClient)?.name}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: F.display, fontSize: 26, color: PALETTE.espresso, lineHeight: 1 }}>{pageTitle}</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>
                  {counts[filter] || 0} post{(counts[filter] || 0) !== 1 ? 's' : ''} · {selectedClient === 'all' ? 'All clients' : clients.find(c => c.id === selectedClient)?.name}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                  <button onClick={() => setMineOnly(m => !m)} title="Show only posts assigned to you" style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid ' + (mineOnly ? PALETTE.caramel : PALETTE.border), background: mineOnly ? PALETTE.caramel : '#fff', color: mineOnly ? '#fff' : PALETTE.muted, fontFamily: F.body, fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    Mine<span style={{ fontSize: 10, opacity: 0.8 }}>{myActiveCount}</span>
                  </button>
                  <span style={{ width: 1, height: 18, background: PALETTE.border, margin: '0 4px' }} />
                  {filterChips.map(([k, l, n]) => (
                    <button key={k} onClick={() => setFilter(k)} style={{ padding: '6px 12px', borderRadius: 20, border: '0.5px solid ' + (filter === k ? PALETTE.espresso : PALETTE.border), background: filter === k ? PALETTE.espresso : '#fff', color: filter === k ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 11, fontWeight: filter === k ? 500 : 400, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      {l}{n > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>{n}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          )}

          {!loading && view === 'queue' && (
            <TodayQueue posts={selectedClient === 'all' ? posts : posts.filter(p => p.client_id === selectedClient)} clients={clients} onSelect={setSelectedPost} currentUserName={currentUserName} />
          )}

          {loading
            ? <div style={{ padding: 48, textAlign: 'center', fontFamily: F.body, fontSize: 13, color: PALETTE.mutedLight }}>Loading...</div>
            : view === 'today'
              ? (selectedClient !== 'all' && clients.find(c => c.id === selectedClient)
                ? <ClientOverview
                    client={clients.find(c => c.id === selectedClient)}
                    posts={posts}
                    comments={comments}
                    requests={requests}
                    statusChanges={statusChanges}
                    onSelectPost={setSelectedPost}
                    onOpenHub={(tab) => { setHubInitialTab(tab || 'notes'); setHubClientId(selectedClient); setView('hub') }}
                    onGoToRequests={() => setView('requests')}
                    onGoToReports={() => setView('reports')}
                    onGoToFilter={(k) => { setFilter(k); setView('queue') }}
                    onClientUpdated={fetchAll}
                    isMobile={isMobile}
                    currentUserEmail={currentUserEmail}
                  />
                : <TodayHome
                  teamMembers={teamMembers}
                  currentUserAvatarUrl={currentUserAvatarUrl}
                  firstName={currentUserFirstName}
                  posts={posts}
                  clients={clients}
                  requests={requests}
                  comments={comments}
                  statusChanges={statusChanges}
                  requestReplies={requestReplies}
                  reminders={reminders}
                  reminderDone={reminderDone}
                  selectedClient={selectedClient}
                  currentUserName={currentUserName}
                  currentUserEmail={currentUserEmail}
                  isMobile={isMobile}
                  onGo={(v, f, o) => { if (f) setFilter(f); if (o && o.mine !== undefined) setMineOnly(o.mine); setView(v) }}
                  onSelectPost={setSelectedPost}
                  onPickClient={(id) => { setSelectedClient(id); setView('today') }}
                  onToggleReminder={toggleReminder}
                  onOpenReminderLink={openReminderLink}
                  onRefresh={fetchAll}
                />)
              : view === 'requests'
              ? <RequestsView requests={requests} clients={clients} selectedClient={selectedClient} onRefresh={fetchAll} replies={requestReplies} currentUserName={currentUserName} />
              : view === 'reports'
              ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 26px 0', flexWrap: 'wrap' }}>
                      <label style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase' }}>Client</label>
                      <select value={selectedClient === 'all' ? '' : selectedClient} onChange={e => setSelectedClient(e.target.value || 'all')} style={{ padding: '7px 12px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: '#fff', fontSize: 12, color: PALETTE.espresso, fontFamily: F.body }}>
                        <option value="">Select a client…</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {selectedClient === 'all' ? (
                      <div style={{ padding: '40px 26px 60px', textAlign: 'center' }}>
                        <div style={{ fontFamily: F.display, fontSize: 18, color: PALETTE.mutedLight }}>Pick a client above to see their marketing reports</div>
                      </div>
                    ) : (
                      <MarketingReportsView client={clients.find(c => c.id === selectedClient)} />
                    )}
                  </>
                )
              : view === 'hub'
              ? (clients.find(c => c.id === hubClientId)
                  ? <ClientHubView
                      key={hubClientId + ':' + hubInitialTab}
                      client={clients.find(c => c.id === hubClientId)}
                      initialTab={hubInitialTab}
                      onClientUpdated={fetchAll}
                      onClose={() => { setHubClientId(null); setView('today') }}
                      currentUserEmail={currentUserEmail}
                    />
                  : <div style={{ padding: 60, textAlign: 'center' }}>
                      <div style={{ fontFamily: F.display, fontSize: 18, color: PALETTE.mutedLight }}>No client selected</div>
                    </div>
                )
              : view === 'calendar'
              ? <CalendarView posts={filteredPosts} onSelect={setSelectedPost} onMove={movePostToDay} />
              : filteredPosts.length === 0
                ? <div style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontFamily: F.display, color: PALETTE.mutedLight, fontSize: 18, marginBottom: 18 }}>No posts here yet</div>
                    <button onClick={() => setComposing(true)} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontFamily: F.body, fontSize: 12, fontWeight: 500 }}>Create First Post</button>
                  </div>
                : view === 'grid'
                  ? (() => {
                      const statusIcon = (status) => {
                        if (status === 'approved') return { symbol: '✓', bg: 'rgba(42,125,79,0.88)', color: '#fff' }
                        if (status === 'scheduled') return { symbol: '◷', bg: 'rgba(59,114,184,0.88)', color: '#fff' }
                        if (status === 'published') return { symbol: '✦', bg: 'rgba(196,137,58,0.88)', color: '#fff' }
                        if (status === 'revision') return { symbol: '↩', bg: 'rgba(192,57,43,0.88)', color: '#fff' }
                        if (status === 'pending') return { symbol: '…', bg: 'rgba(44,31,14,0.55)', color: '#fff' }
                        if (status === 'draft') return { symbol: '✎', bg: 'rgba(154,143,126,0.9)', color: '#fff' }
                        return { symbol: '?', bg: 'rgba(0,0,0,0.4)', color: '#fff' }
                      }
                      // Newest scheduled date first — mirrors how IG shows most recent at top-left
                      const sortedPosts = [...filteredPosts].sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
                      return (
                        <div style={{ padding: '16px 8px' }}>
                          <div style={{ marginBottom: 16 }}>
                            <DragHint><b style={{ fontWeight: 500 }}>Drag a post onto another to swap their dates.</b> Each keeps its own time, so the grid order changes with the schedule. Works within one client, and published posts stay put.</DragHint>
                          </div>
                          {/* Client group headers when viewing all clients */}
                          {selectedClient === 'all'
                            ? clients.map(cl => {
                                const clientPosts = sortedPosts.filter(p => p.client_id === cl.id)
                                if (clientPosts.length === 0) return null
                                return (
                                  <div key={cl.id} style={{ marginBottom: 28 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: cl.brand_color || PALETTE.caramel }} />
                                      <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 500, color: PALETTE.espresso, letterSpacing: '0.04em' }}>{cl.name}</span>
                                      <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{clientPosts.length} post{clientPosts.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                                      {clientPosts.map(post => {
                                        const si = statusIcon(post.status)
                                        const isSelected = selectedPost?.id === post.id
                                        const hasVid = isVideo(post.image_url)
                                        return (
                                          <div key={post.id} {...gridDnD(post)} onClick={() => setSelectedPost(post)} title={post.status === 'published' ? undefined : 'Drag onto another post to swap their dates'} style={{ position: 'relative', aspectRatio: '1', background: PALETTE.creamDark, cursor: post.status === 'published' ? 'pointer' : 'grab', overflow: 'hidden', opacity: dragId === post.id ? 0.4 : 1, outline: dragOverId === post.id ? '2.5px dashed ' + PALETTE.caramel : isSelected ? '2.5px solid ' + PALETTE.caramel : 'none', outlineOffset: '-2px' }}
                                            onMouseEnter={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '1')}
                                            onMouseLeave={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '0')}
                                          >
                                            {/* Image — contain so nothing is cropped */}
                                            {post.image_url && !hasVid && (
                                              <img src={imgSrc(post.image_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                            )}
                                            {post.image_url && hasVid && (
                                              post.cover_url
                                                ? <img src={imgSrc(post.cover_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                                : <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><path d="M8 5v14l11-7z"/></svg>
                                                  </div>
                                            )}
                                            {!post.image_url && (
                                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ fontFamily: F.display, color: PALETTE.caramel, fontSize: 14 }}>BB</span>
                                              </div>
                                            )}
                                            {/* Status badge — top right */}
                                            {post.status !== 'published' && <div aria-hidden="true" style={{ position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: PALETTE.muted, letterSpacing: '-1px', zIndex: 2 }}>⋮⋮</div>}
<div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: si.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: si.color, fontWeight: 700, backdropFilter: 'blur(4px)', zIndex: 2 }}>{si.symbol}</div>
                                            {/* Date — bottom left */}
                                            <div style={{ position: 'absolute', bottom: 5, left: 6, fontFamily: F.body, fontSize: 8, color: 'rgba(255,255,255,0.9)', fontWeight: 500, textShadow: '0 1px 3px rgba(0,0,0,0.6)', zIndex: 2 }}>{fmtShort(post.scheduled_at)}</div>
                                            {/* Hover overlay */}
                                            <div className="ig-hover" style={{ position: 'absolute', inset: 0, background: 'rgba(44,31,14,0.35)', opacity: 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                                              <span style={{ fontFamily: F.body, fontSize: 10, color: '#fff', fontWeight: 500, letterSpacing: '0.05em' }}>View</span>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })
                            : (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
                                {sortedPosts.map(post => {
                                  const si = statusIcon(post.status)
                                  const isSelected = selectedPost?.id === post.id
                                  const hasVid = isVideo(post.image_url)
                                  return (
                                    <div key={post.id} {...gridDnD(post)} onClick={() => setSelectedPost(post)} title={post.status === 'published' ? undefined : 'Drag onto another post to swap their dates'} style={{ position: 'relative', aspectRatio: '1', background: PALETTE.creamDark, cursor: post.status === 'published' ? 'pointer' : 'grab', overflow: 'hidden', opacity: dragId === post.id ? 0.4 : 1, outline: dragOverId === post.id ? '2.5px dashed ' + PALETTE.caramel : isSelected ? '2.5px solid ' + PALETTE.caramel : 'none', outlineOffset: '-2px' }}
                                      onMouseEnter={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '1')}
                                      onMouseLeave={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '0')}
                                    >
                                      {post.image_url && !hasVid && (
                                        <img src={imgSrc(post.image_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                      )}
                                      {post.image_url && hasVid && (
                                        post.cover_url
                                          ? <img src={imgSrc(post.cover_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                          : <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                              <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><path d="M8 5v14l11-7z"/></svg>
                                            </div>
                                      )}
                                      {!post.image_url && (
                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <span style={{ fontFamily: F.display, color: PALETTE.caramel, fontSize: 14 }}>BB</span>
                                        </div>
                                      )}
                                      {post.status !== 'published' && <div aria-hidden="true" style={{ position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: PALETTE.muted, letterSpacing: '-1px', zIndex: 2 }}>⋮⋮</div>}
<div style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%', background: si.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: si.color, fontWeight: 700, backdropFilter: 'blur(4px)', zIndex: 2 }}>{si.symbol}</div>
                                      <div style={{ position: 'absolute', bottom: 5, left: 6, fontFamily: F.body, fontSize: 8, color: 'rgba(255,255,255,0.9)', fontWeight: 500, textShadow: '0 1px 3px rgba(0,0,0,0.6)', zIndex: 2 }}>{fmtShort(post.scheduled_at)}</div>
                                      <div className="ig-hover" style={{ position: 'absolute', inset: 0, background: 'rgba(44,31,14,0.35)', opacity: 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                                        <span style={{ fontFamily: F.body, fontSize: 10, color: '#fff', fontWeight: 500, letterSpacing: '0.05em' }}>View</span>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          }
                          {/* Legend */}
                          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
                            {[['✓','rgba(42,125,79,0.88)','Approved'],['◷','rgba(59,114,184,0.88)','Scheduled'],['✦','rgba(196,137,58,0.88)','Published'],['↩','rgba(192,57,43,0.88)','Revisions'],['…','rgba(44,31,14,0.55)','Pending'],['✎','rgba(154,143,126,0.9)','Draft']].map(([sym, bg, label]) => (
                              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <div style={{ width: 16, height: 16, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff', fontWeight: 700 }}>{sym}</div>
                                <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.muted }}>{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()
                  : filteredPosts.map(post => {
                      const postComments = comments.filter(c => c.post_id === post.id)
                      const isSelected = selectedPost?.id === post.id
                      const client = clients.find(c => c.id === post.client_id)
                      const formatLabel = post.format ? post.format.charAt(0).toUpperCase() + post.format.slice(1) : 'Post'
                      const hasUnread = postComments.some(c => c.author_type === 'client' && !seenIds.has('comment-' + c.id))
                      return (
                        <div key={post.id} onClick={() => setSelectedPost(post)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 22px', borderBottom: '0.5px solid ' + PALETTE.borderLight, cursor: 'pointer', background: isSelected ? '#FDF8F0' : '#fff', borderLeft: isSelected ? '2px solid ' + PALETTE.caramel : '2px solid transparent', transition: 'background 0.1s' }}
                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = PALETTE.creamMid }}
                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff' }}
                        >
                          <div style={{ width: 50, height: 50, borderRadius: 5, overflow: 'hidden', flexShrink: 0, background: PALETTE.creamDark, position: 'relative' }}>
                            {post.image_url && !isVideo(post.image_url) && <img src={imgSrc(post.image_url, post.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            {post.image_url && isVideo(post.image_url) && (
                              post.cover_url
                                ? <img src={imgSrc(post.cover_url, post.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill={PALETTE.caramel}><path d="M8 5v14l11-7z"/></svg></div>
                            )}
                            {!post.image_url && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, color: PALETTE.caramel, fontSize: 13 }}>BB</div>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                              <Badge status={post.status} />
                              <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{formatLabel}</span>
                              {client && selectedClient === 'all' && <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>· {client.name}</span>}
                              {post.campaign && <span style={{ fontFamily: F.body, fontSize: 9, background: PALETTE.creamDark, color: PALETTE.espresso, padding: '2px 7px', borderRadius: 10, fontWeight: 500 }}>{post.campaign}</span>}
                              {post.designer && (
                                <span style={{ fontFamily: F.body, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 10, fontWeight: 500, background: namesMatch(post.designer, currentUserName) ? PALETTE.caramelLight : PALETTE.creamDark, color: namesMatch(post.designer, currentUserName) ? PALETTE.caramel : PALETTE.muted }}>
                                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: namesMatch(post.designer, currentUserName) ? PALETTE.caramel : PALETTE.mutedLight, color: '#fff', fontSize: 6, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{post.designer.slice(0, 1).toUpperCase()}</span>
                                  {post.designer}
                                </span>
                              )}
                              {hasUnread && <span style={{ fontFamily: F.body, fontSize: 9, background: PALETTE.caramelLight, color: PALETTE.caramel, padding: '1px 6px', borderRadius: 3, fontWeight: 500 }}>New comment</span>}
                            </div>
                            <p style={{ margin: 0, fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 300 }}>{post.caption}</p>
                            <div style={{ marginTop: 5, display: 'flex', gap: 12, alignItems: 'center' }}>
                              <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{fmt(post.scheduled_at)}</span>
                              {postComments.length > 0 && <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, fontWeight: 500 }}>{postComments.length} comment{postComments.length !== 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })
          }
        </div>

        {selectedPost && (
          <RightPanel
            post={posts.find(p => p.id === selectedPost.id) || selectedPost}
            comments={comments.filter(c => c.post_id === selectedPost.id)}
            versions={versions.filter(v => v.post_id === selectedPost.id)}
            statusChanges={statusChanges.filter(s => s.post_id === selectedPost.id)}
            designOptions={designOptions.filter(d => d.post_id === selectedPost.id)}
            clients={clients}
            teamMembers={teamMembers}
            onRefresh={fetchAll}
            onClose={() => setSelectedPost(null)}
            isMobile={isMobile}
            currentUserName={currentUserName}
            onUpdatePostLocal={(id, patch) => setPosts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))}
          />
        )}
      </div>

      {showSearch && (
        <SearchModal
          clients={clients}
          posts={posts}
          requests={requests}
          isMobile={isMobile}
          onClose={() => setShowSearch(false)}
          onPickClient={(id) => { setSelectedClient(id); setView('today') }}
          onPickPost={(post) => setSelectedPost(post)}
          onPickRequest={(r) => { setSelectedClient(r.client_id); setView('requests') }}
          onPickNote={(n) => { setSelectedClient(n.client_id); setHubInitialTab('notes'); setHubClientId(n.client_id); setView('hub') }}
          onPickLink={(l) => { window.open(fixUrl(l.url), '_blank', 'noopener') }}
        />
      )}

      {composing && <ComposeModal clients={clients} teamMembers={teamMembers} onClose={() => setComposing(false)} onSaved={fetchAll} currentUserName={currentUserName} />}
    </div>
  )
}
