import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from './supabase'

const style = document.createElement('style')
style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #F5F0E8; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D4C9B0; border-radius: 4px; }
  textarea:focus, input:focus, select:focus { outline: none; }
  button { cursor: pointer; }
`
document.head.appendChild(style)

const F = {
  display: "'DM Serif Display', Georgia, serif",
  body: "'DM Sans', system-ui, sans-serif"
}

const PALETTE = {
  cream: '#F5F0E8', creamDark: '#EDE5D4', creamMid: '#FAF6EE',
  border: '#D4C9B0', borderLight: '#E8E0D0',
  espresso: '#2C1F0E', espressoLight: '#5C4A30',
  caramel: '#C4893A', caramelLight: '#F0E8D5',
  muted: '#8A7560', mutedLight: '#B8A898',
}

const MAX_FILE_SIZE = 50 * 1024 * 1024

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

const uploadAsset = async (file) => {
  if (file.size > MAX_FILE_SIZE) return { error: 'File is too large. Maximum size is 50MB.' }
  const ext = file.name.split('.').pop()
  const filename = Date.now() + '.' + ext
  const { error } = await supabase.storage.from('post-assets').upload(filename, file, { upsert: true })
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

const downloadAsset = async (url, clientName) => {
  if (!url) return
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    const ext = url.split('?')[0].split('.').pop().toLowerCase() || 'jpg'
    const slug = (clientName || 'post').toLowerCase().replace(/\s+/g, '-')
    const date = new Date().toISOString().slice(0, 10)
    const filename = slug + '-' + date + '.' + ext
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  } catch (e) {
    window.open(url, '_blank')
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

const STATUS = {
  pending:   { label: 'AWAITING APPROVAL',   color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A', border: '#E8C87A' },
  approved:  { label: 'APPROVED',            color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F', border: '#7ECBA1' },
  revision:  { label: 'REVISIONS REQUESTED', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B', border: '#F4A59F' },
  published: { label: 'PUBLISHED',           color: '#444',    bg: '#F2F2F2', dot: '#888',    border: '#CCC'    },
  archived:  { label: 'ARCHIVED',            color: '#777',    bg: '#F5F5F5', dot: '#AAA',    border: '#DDD'    },
}
const FORMATS = ['post', 'carousel', 'reel', 'story']
const BILLING_STATUS = {
  paid:    { label: 'PAID',    color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F' },
  pending: { label: 'PENDING', color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A' },
  overdue: { label: 'OVERDUE', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B' },
}
const fmtMoney = (n) => n == null || n === '' ? '—' : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateLong = (str) => str ? new Date(str + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const statusLine = (s) => ({ pending: 'Awaiting client approval', approved: 'Approved — ready to schedule', revision: 'Client requested revisions', published: 'Published', archived: 'Archived' }[s] || '')

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

function TodayQueue({ posts, clients, onSelect }) {
  const now = new Date()
  const todayPosts = posts.filter(p => {
    if (p.status === 'archived') return false
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
          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.espresso, fontSize: 14 }}>Up for publishing today</span>
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
                  <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill={PALETTE.caramel}><path d="M8 5v14l11-7z"/></svg>
                  </div>
                )}
                {!post.image_url && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 13 }}>BB</div>}
                {isDone && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(42,125,79,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#2A7D4F', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14 }}>✓</div>
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, fontWeight: 500, marginBottom: 2 }}>{fmtTime(post.scheduled_at)}</div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.muted, marginBottom: 4 }}>{client?.name || '—'}</div>
                <p style={{ margin: '0 0 6px', fontFamily: F.body, fontSize: 11, color: PALETTE.espresso, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 300 }}>{post.caption}</p>
                <Badge status={post.status} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IGGrid({ posts }) {
  const grid = [...posts].filter(p => p.status !== 'archived').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0, 9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2 }}>
      {grid.map((p, i) => (
        <div key={i} style={{ aspectRatio: '1', overflow: 'hidden', borderRadius: 2, position: 'relative', background: p ? (p.image_url ? 'transparent' : 'hsl(' + (28 + i * 8) + ',20%,' + (86 - i * 2) + '%)') : '#E8E0D0' }}>
          {p?.image_url && !isVideo(p.image_url) && <img src={imgSrc(p.image_url, p.status === 'published')} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {p?.image_url && isVideo(p.image_url) && <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>}
          {p && !p.image_url && <div style={{ padding: 3, fontSize: 6, color: PALETTE.muted, lineHeight: 1.3 }}>{p.caption?.slice(0, 30)}</div>}
          {p && <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: STATUS[p.status]?.dot || '#ccc', border: '1px solid rgba(255,255,255,0.8)' }} />}
        </div>
      ))}
    </div>
  )
}

function CalendarView({ posts, onSelect }) {
  const now = new Date()
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
        <span style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 18, color: PALETTE.espresso, flex: 1, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }} style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 6, padding: '6px 14px', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>Next</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: PALETTE.border }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ background: PALETTE.creamDark, padding: '7px 4px', textAlign: 'center', fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const dayPosts = day ? posts.filter(p => { const d = new Date(p.scheduled_at); return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day }) : []
          const isToday = day && now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
          return (
            <div key={i} style={{ background: '#fff', minHeight: 80, padding: 5, borderTop: isToday ? '2px solid ' + PALETTE.caramel : 'none' }}>
              {day && <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: isToday ? 500 : 400, color: isToday ? PALETTE.caramel : PALETTE.mutedLight, marginBottom: 3 }}>{day}</div>}
              {dayPosts.map(p => (
                <div key={p.id} onClick={() => onSelect(p)} style={{ background: STATUS[p.status]?.bg || PALETTE.cream, borderLeft: '2px solid ' + (STATUS[p.status]?.dot || '#ccc'), padding: '2px 4px', marginBottom: 2, borderRadius: 2, cursor: 'pointer', fontFamily: F.body, fontSize: 9, color: PALETTE.espresso, lineHeight: 1.4 }}>
                  {fmtTime(p.scheduled_at)} — {p.caption?.slice(0, 18)}...
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NotificationsPanel({ notifications, onClose, onMarkAllRead }) {
  const unread = notifications.filter(n => !n.read).length
  return (
    <div style={{ position: 'absolute', top: 48, right: 16, width: 300, background: '#fff', borderRadius: 10, border: '0.5px solid ' + PALETTE.border, boxShadow: '0 8px 32px rgba(44,31,14,0.16)', zIndex: 300, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 15, color: PALETTE.espresso }}>Notifications</span>
        {unread > 0 && <button onClick={onMarkAllRead} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, fontWeight: 500 }}>Mark all read</button>}
      </div>
      <div style={{ maxHeight: 340, overflowY: 'auto' }}>
        {notifications.length === 0
          ? <div style={{ padding: '24px 16px', textAlign: 'center', fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic' }}>All caught up.</div>
          : notifications.map((n, i) => (
            <div key={i} style={{ padding: '11px 16px', borderBottom: '0.5px solid ' + PALETTE.borderLight, background: n.read ? '#fff' : PALETTE.creamMid, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: n.read ? 'transparent' : PALETTE.caramel, flexShrink: 0, marginTop: 5, border: n.read ? '0.5px solid ' + PALETTE.border : 'none' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{n.message}</div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{n.client} · {fmtAgo(n.created_at)}</div>
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

function RightPanel({ post, comments, versions, clients, onRefresh, onClose, isMobile }) {
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [editing, setEditing] = useState(false)
  const [editCaption, setEditCaption] = useState(post.caption)
  const [editScheduled, setEditScheduled] = useState(post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '')
  const [editFormat, setEditFormat] = useState(post.format || 'post')
  const [editSlideCount, setEditSlideCount] = useState(post.slide_count || '')
  const [editDesigner, setEditDesigner] = useState(post.designer || '')
  const [editCampaign, setEditCampaign] = useState(post.campaign || '')
  const [editImages, setEditImages] = useState(Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []))
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef()

  const client = clients.find(c => c.id === post.client_id)
  const handle = client?.ig_handle || client?.name?.toLowerCase().replace(/\s+/g, '.') || 'handle'
  const isPublished = post.status === 'published'
  const displaySrc = imgSrc(post.image_url, isPublished)

  useEffect(() => {
    setEditCaption(post.caption)
    setEditScheduled(post.scheduled_at ? new Date(post.scheduled_at).toISOString().slice(0, 16) : '')
    setEditFormat(post.format || 'post')
    setEditSlideCount(post.slide_count || '')
    setEditDesigner(post.designer || '')
    setEditCampaign(post.campaign || '')
    setEditImages(Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : []))
    setEditing(false)
    setUploadError(null)
  }, [post.id])

  const handleFile = async (e) => {
    const files = e.target.files
    if (!files || !files.length) return
    setUploadError(null)
    setUploading(true)
    const { urls, error } = await uploadMultiple(files)
    if (urls.length) setEditImages(prev => [...prev, ...urls])
    if (error) setUploadError(error)
    setUploading(false)
  }

  const removeEditImage = (i) => setEditImages(prev => prev.filter((_, idx) => idx !== i))

  const saveEdit = async () => {
    if (!editCaption.trim() || !editDesigner.trim() || !editScheduled) return
    setSaving(true)
    await supabase.from('posts').update({
      caption: editCaption.trim(), scheduled_at: new Date(editScheduled).toISOString(),
      format: editFormat, slide_count: editFormat === 'carousel' ? (editImages.length || (editSlideCount ? parseInt(editSlideCount) : null)) : null,
      designer: editDesigner.trim(), campaign: editCampaign.trim() || null,
      image_url: editImages[0] || null,
      images: editFormat === 'carousel' && editImages.length > 1 ? editImages : null,
    }).eq('id', post.id)
    setSaving(false); setEditing(false); onRefresh()
  }

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({ post_id: post.id, author: 'Brown Butter', author_type: 'agency', text: newComment.trim() })
    setNewComment(''); setSaving(false); onRefresh()
  }

  const updateStatus = async (status) => {
    const { error } = await supabase.from('posts').update({ status }).eq('id', post.id)
    if (error) console.error('Status update error:', error)
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
    await downloadAsset(post.image_url, client?.name)
    setDownloading(false)
  }

  const handleKeyDown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendComment() }

  const formatLabel = post.format ? post.format.charAt(0).toUpperCase() + post.format.slice(1) + (post.slide_count ? ' · ' + post.slide_count + ' slides' : '') : 'Post'
  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body }
  const labelStyle = { fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6, display: 'block' }

  return (
    <div style={isMobile ? {
  position: 'fixed', inset: 0, width: '100%', background: '#fff', display: 'flex',
  flexDirection: 'column', zIndex: 300, overflow: 'hidden'
} : {
  width: 340, background: '#fff', borderLeft: '0.5px solid ' + PALETTE.border, display: 'flex',
  flexDirection: 'column', flexShrink: 0, overflow: 'hidden'
}}>
      <div style={{ padding: '14px 18px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <Badge status={post.status} />
          <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 13, color: PALETTE.espresso, marginTop: 7, lineHeight: 1.4 }}>{post.caption?.slice(0, 60)}{post.caption?.length > 60 ? '…' : ''}</div>
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
            <div style={{ fontFamily: F.body, fontSize: 9, color: PALETTE.mutedLight, marginTop: 4 }}>Image, GIF, or video (max 50MB each)</div>
          </div>
          {uploadError && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', marginTop: 6 }}>{uploadError}</div>}
          <input ref={fileRef} type="file" accept="image/*,video/*,.gif" multiple={editFormat === 'carousel'} onChange={handleFile} style={{ display: 'none' }} />
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
                      <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 11 }}>No asset</span>
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
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0 }}>
                      {(client?.name || 'BB').slice(0, 2).toUpperCase()}
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
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '1.5px solid ' + PALETTE.caramel }}>{(client?.name || 'BB').slice(0, 2).toUpperCase()}</div>
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
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: client?.brand_color || PALETTE.caramel, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '1.5px solid ' + PALETTE.caramel }}>{(client?.name || 'BB').slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 600, color: '#111' }}>{handle}</div>
                  {post.campaign && <div style={{ fontFamily: F.body, fontSize: 9, color: '#999' }}>{post.campaign}</div>}
                </div>
                <div style={{ fontSize: 14, color: '#888', letterSpacing: 2 }}>···</div>
              </div>
              {post.image_url
                ? isVideo(post.image_url)
                  ? <video src={post.image_url} controls style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block', background: '#000' }} />
                  : <img src={displaySrc} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '4/5', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', aspectRatio: '4/5', background: PALETTE.creamDark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 13 }}>No asset</span>
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
              {downloading ? 'Downloading…' : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download asset</>}
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
        {[
          ['details', 'Details'],
          ['comments', 'Comments' + (comments.length > 0 ? ' (' + comments.length + ')' : '')],
          ['history', 'History' + (versions.length > 0 ? ' (' + versions.length + ')' : '')]
        ].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ flex: 1, padding: '11px 0', border: 'none', background: 'transparent', fontFamily: F.body, fontSize: 10, fontWeight: activeTab === k ? 500 : 400, color: activeTab === k ? PALETTE.espresso : PALETTE.muted, borderBottom: activeTab === k ? '1.5px solid ' + PALETTE.caramel : '1.5px solid transparent', transition: 'all 0.15s', letterSpacing: '0.03em' }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Format</label>
                    <select value={editFormat} onChange={e => setEditFormat(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
                      {FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
                    </select>
                  </div>
                  {editFormat === 'carousel' && <div><label style={labelStyle}>Slides</label><input type="number" min="2" max="20" value={editSlideCount} onChange={e => setEditSlideCount(e.target.value)} placeholder="e.g. 4" style={inputStyle} /></div>}
                </div>
                <div><label style={{ ...labelStyle, color: !editDesigner.trim() ? '#C0392B' : PALETTE.mutedLight }}>Designer <span style={{ color: '#C0392B' }}>*</span></label><input value={editDesigner} onChange={e => setEditDesigner(e.target.value)} placeholder="Required" style={{ ...inputStyle, borderColor: !editDesigner.trim() ? '#F4A59F' : PALETTE.border }} /></div>
                <div><label style={labelStyle}>Campaign (optional)</label><input value={editCampaign} onChange={e => setEditCampaign(e.target.value)} placeholder="e.g. Summer Menu" style={inputStyle} /></div>
                <div>
                  <label style={labelStyle}>Caption</label>
                  <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
                  <div style={{ fontFamily: F.body, fontSize: 9, color: editCaption.length > 2200 ? '#C0392B' : PALETTE.mutedLight, textAlign: 'right', marginTop: 2 }}>{editCaption.length} / 2,200</div>
                </div>
                <div><label style={labelStyle}>Scheduled</label><input type="datetime-local" value={editScheduled} onChange={e => setEditScheduled(e.target.value)} style={inputStyle} /></div>
              </div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {[['Client', client?.name], ['Platform', 'Instagram'], ['Format', formatLabel], ['Designer', post.designer], post.campaign ? ['Campaign', post.campaign] : null, ['Scheduled', fmt(post.scheduled_at)]].filter(Boolean).map(([label, value]) => (
                  <div key={label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 10, alignItems: 'start' }}>
                    <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>{label}</span>
                    <span style={{ fontFamily: F.body, fontSize: 12, color: value ? PALETTE.espresso : PALETTE.mutedLight, fontStyle: value ? 'normal' : 'italic' }}>{value || 'Not set'}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />

            {post.status !== 'archived' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 10, textTransform: 'uppercase' }}>Update Status</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                  {['pending', 'approved', 'revision', 'published'].map(k => {
                    const s = STATUS[k]
                    const labels = { pending: 'Reset to pending', approved: 'Mark as approved', revision: 'Request revisions', published: 'Mark as published' }
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
                    <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 500, color: PALETTE.espresso }}>{c.author_type === 'agency' ? 'Brown Butter' : c.author + (client ? ' (' + client.name + ')' : '')}</span>
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
          // Build a unified activity timeline from versions + status-change comments + client comments
          const timeline = []

          // Caption edits from versions table
          versions.forEach(v => {
            timeline.push({
              ts: new Date(v.created_at).getTime(),
              date: v.created_at,
              icon: '✎',
              iconColor: PALETTE.muted,
              iconBg: PALETTE.creamDark,
              who: v.author || 'Brown Butter',
              action: 'updated the caption',
              detail: v.note || null,
              tag: 'v' + v.version_number,
              tagColor: '#9B2B20',
            })
          })

          // Status changes inferred from comments with author_type agency that look like status notes,
          // plus we build synthetic entries from the current post status
          const statusEvents = {
            approved:  { icon: '✓', iconColor: '#2A7D4F', iconBg: '#E8F8EE', action: 'approved this post' },
            revision:  { icon: '↩', iconColor: '#C0392B', iconBg: '#FEECEA', action: 'requested revisions' },
            published: { icon: '✦', iconColor: PALETTE.caramel, iconBg: PALETTE.caramelLight, action: 'marked as published' },
            pending:   { icon: '○', iconColor: PALETTE.muted, iconBg: PALETTE.creamDark, action: 'reset to pending' },
          }

          // Add current status as a timeline entry using updated_at
          if (post.status && post.updated_at && post.updated_at !== post.created_at) {
            const ev = statusEvents[post.status]
            if (ev) {
              const who = post.status === 'approved' ? (client?.name || 'Client') : 'Brown Butter'
              timeline.push({
                ts: new Date(post.updated_at).getTime(),
                date: post.updated_at,
                icon: ev.icon,
                iconColor: ev.iconColor,
                iconBg: ev.iconBg,
                who,
                action: ev.action,
                detail: null,
                tag: null,
              })
            }
          }

          // Post created entry
          timeline.push({
            ts: new Date(post.created_at).getTime(),
            date: post.created_at,
            icon: '+',
            iconColor: PALETTE.caramel,
            iconBg: PALETTE.caramelLight,
            who: 'Brown Butter',
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
              <div style={{ position: 'absolute', left: 10, top: 6, bottom: 6, width: 1, background: PALETTE.borderLight }} />
              {timeline.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 20, position: 'relative' }}>
                  {/* Icon dot */}
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: item.iconBg, border: '1.5px solid ' + PALETTE.borderLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: item.iconColor, fontWeight: 700, flexShrink: 0, zIndex: 1 }}>{item.icon}</div>
                  <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                    <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 500 }}>{item.who}</span>
                      {' '}{item.action}
                      {item.tag && <span style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 11, color: item.tagColor, marginLeft: 5 }}>{item.tag}</span>}
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

function ComposeModal({ clients, onClose, onSaved }) {
  const [clientId, setClientId] = useState(clients[0]?.id || '')
  const [caption, setCaption] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [format, setFormat] = useState('post')
  const [slideCount, setSlideCount] = useState('')
  const [designer, setDesigner] = useState('')
  const [campaign, setCampaign] = useState('')
  const [images, setImages] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  const handleFile = async (e) => {
    const files = e.target.files
    if (!files || !files.length) return
    setUploadError(null); setUploading(true)
    const { urls, error } = await uploadMultiple(files)
    if (urls.length) setImages(prev => [...prev, ...urls])
    if (error) setUploadError(error)
    setUploading(false)
  }

  const removeImage = (i) => setImages(prev => prev.filter((_, idx) => idx !== i))

  const canSave = caption.trim() && scheduledAt && clientId && designer.trim()

  const handleSave = async () => {
    if (!canSave) return; setSaving(true)
    await supabase.from('posts').insert({
      client_id: clientId, caption: caption.trim(), scheduled_at: new Date(scheduledAt).toISOString(),
      image_url: images[0] || null,
      images: format === 'carousel' && images.length > 1 ? images : null,
      platform: 'instagram', status: 'pending', format,
      slide_count: format === 'carousel' ? (images.length || (slideCount ? parseInt(slideCount) : null)) : null,
      designer: designer.trim(), campaign: campaign.trim() || null
    })
    setSaving(false); onSaved(); onClose()
  }

  const fieldLabel = (text, required) => <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>{text} {required && <span style={{ color: '#C0392B' }}>*</span>}</div>
  const inputStyle = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 13, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,31,14,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(44,31,14,0.2)' }}>
        <div style={{ padding: '16px 22px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PALETTE.espresso, borderRadius: '14px 14px 0 0' }}>
          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 17 }}>New Post</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: PALETTE.caramel, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>{fieldLabel('Client', true)}<select value={clientId} onChange={e => setClientId(e.target.value)} style={inputStyle}>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{fieldLabel('Format')}<select value={format} onChange={e => setFormat(e.target.value)} style={inputStyle}>{FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}</select></div>
            {format === 'carousel' && <div>{fieldLabel('Slides')}<input type="number" min="2" max="20" value={slideCount} onChange={e => setSlideCount(e.target.value)} placeholder="e.g. 4" style={inputStyle} /></div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{fieldLabel('Designer', true)}<input value={designer} onChange={e => setDesigner(e.target.value)} placeholder="e.g. Saoirse L." style={{ ...inputStyle, borderColor: !designer.trim() ? '#F4A59F' : PALETTE.border }} /></div>
            <div>{fieldLabel('Campaign (optional)')}<input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. Summer Menu" style={inputStyle} /></div>
          </div>
          <div>
            {fieldLabel(format === 'carousel' ? 'Assets (select multiple for carousel)' : 'Asset')}
            {uploading && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel, marginBottom: 6 }}>Uploading...</div>}
            {uploadError && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', marginBottom: 6 }}>{uploadError}</div>}
            <MultiAssetPreview urls={images} onRemove={removeImage} />
            <div onClick={() => fileRef.current.click()} style={{ border: '1.5px dashed ' + PALETTE.border, borderRadius: 8, padding: '22px 0', textAlign: 'center', cursor: 'pointer', background: PALETTE.creamMid }}>
              <div style={{ fontFamily: F.body, fontSize: 22, color: PALETTE.caramel, marginBottom: 4 }}>+</div>
              <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>{format === 'carousel' ? 'Click to upload photos (select multiple)' : 'Click to upload'}</div>
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 3 }}>Image, GIF, or video · max 50MB each</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*,.gif" multiple={format === 'carousel'} onChange={handleFile} style={{ display: 'none' }} />
          </div>
          <div>{fieldLabel('Caption', true)}<textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write your caption..." rows={4} style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }} /><div style={{ fontFamily: F.body, fontSize: 9, color: caption.length > 2200 ? '#C0392B' : PALETTE.mutedLight, textAlign: 'right', marginTop: 2 }}>{caption.length} / 2,200</div></div>
          <div>{fieldLabel('Schedule date and time', true)}<input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={inputStyle} /></div>
          <button onClick={handleSave} disabled={saving || !canSave} style={{ padding: '12px 0', borderRadius: 8, border: 'none', background: canSave ? PALETTE.espresso : PALETTE.creamDark, color: canSave ? PALETTE.cream : PALETTE.mutedLight, fontFamily: F.body, fontSize: 13, fontWeight: 500, cursor: canSave ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}>{saving ? 'Saving...' : 'Send to Client for Review'}</button>
          {!designer.trim() && <div style={{ fontFamily: F.body, fontSize: 11, color: '#C0392B', textAlign: 'center', marginTop: -8 }}>Designer name is required</div>}
        </div>
      </div>
    </div>
  )
}

function ClientHubModal({ client, onClose }) {
  const [tab, setTab] = useState('notes') // 'notes' | 'billing'
  const [notes, setNotes] = useState([])
  const [cycles, setCycles] = useState([])
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

  const fetchHub = async () => {
    setLoading(true)
    const [n, c] = await Promise.all([
      supabase.from('meeting_notes').select('*').eq('client_id', client.id).order('meeting_date', { ascending: false }),
      supabase.from('billing_cycles').select('*').eq('client_id', client.id).order('cycle_start', { ascending: false })
    ])
    if (n.data) setNotes(n.data)
    if (c.data) setCycles(c.data)
    setLoading(false)
  }

  useEffect(() => { fetchHub() }, [client.id])

  const startNewNote = () => { setEditingNoteId('new'); setNoteTitle(''); setNoteDate(new Date().toISOString().slice(0, 10)); setNoteBody('') }
  const startEditNote = (n) => { setEditingNoteId(n.id); setNoteTitle(n.title); setNoteDate(n.meeting_date); setNoteBody(n.body || '') }

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

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 12, color: PALETTE.espresso, fontFamily: F.body, boxSizing: 'border-box' }
  const labelStyle = { fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.1em', color: PALETTE.mutedLight, textTransform: 'uppercase', marginBottom: 6, display: 'block' }
  const sortedNotes = [...notes].sort((a, b) => new Date(b.meeting_date) - new Date(a.meeting_date))
  const sortedCycles = [...cycles].sort((a, b) => new Date(b.cycle_start) - new Date(a.cycle_start))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(44,31,14,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(44,31,14,0.2)' }}>
        <div style={{ padding: '16px 22px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PALETTE.espresso, flexShrink: 0 }}>
          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 17 }}>{client.name} — Client Hub</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: PALETTE.caramel, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
          {[['notes', 'Meeting Notes'], ['billing', 'Billing']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: '12px 0', border: 'none', background: 'transparent', fontFamily: F.body, fontSize: 12, fontWeight: tab === k ? 500 : 400, color: tab === k ? PALETTE.espresso : PALETTE.muted, borderBottom: tab === k ? '1.5px solid ' + PALETTE.caramel : '1.5px solid transparent' }}>{l}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading ? (
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, textAlign: 'center', padding: 30 }}>Loading…</div>
          ) : tab === 'notes' ? (
            <div>
              {editingNoteId ? (
                <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div><label style={labelStyle}>Title</label><input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="e.g. Q3 Strategy Check-in" style={inputStyle} /></div>
                  <div><label style={labelStyle}>Date</label><input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} style={inputStyle} /></div>
                  <div><label style={labelStyle}>Notes</label><textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={6} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} /></div>
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
                    <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 14, color: PALETTE.espresso }}>{n.title}</div>
                    <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, whiteSpace: 'nowrap' }}>{fmtDateLong(n.meeting_date)}</div>
                  </div>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espressoLight, lineHeight: 1.6, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={() => startEditNote(n)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Edit</button>
                    <button onClick={() => deleteNote(n.id)} style={{ background: 'none', border: 'none', fontFamily: F.body, fontSize: 11, color: '#C0392B' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
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
                  <div><label style={labelStyle}>Invoice link (optional)</label><input value={cycleInvoiceUrl} onChange={e => setCycleInvoiceUrl(e.target.value)} placeholder="https://..." style={inputStyle} /></div>
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [versions, setVersions] = useState([])
  const [selectedClient, setSelectedClient] = useState('all')
  const [filter, setFilter] = useState('pending')
  const [view, setView] = useState('queue')
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
  const [seenIds, setSeenIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('bb_seen_notifs') || '[]')) } catch { return new Set() }
  })
  const [pwEditClientId, setPwEditClientId] = useState(null)
  const [pwDraft, setPwDraft] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [hubClientId, setHubClientId] = useState(null)

  // ── SPEED FIX 1: fetchAll only called on mount; realtime channels do targeted single-table refreshes ──
  const fetchAll = async () => {
    const [c, p, cm, v] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('posts').select('*').neq('status', 'archived').order('scheduled_at').limit(150),
      supabase.from('comments').select('*').order('created_at'),
      supabase.from('versions').select('*').order('created_at')
    ])
    if (c.data) setClients(c.data)
    if (p.data) setPosts(p.data)
    if (cm.data) setComments(cm.data)
    if (v.data) setVersions(v.data)
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

    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe() }
  }, [])

  // ── SPEED FIX 3: notifications built with useMemo instead of useEffect + setState ──
  const notifications = useMemo(() => {
    const notifs = []
    posts.forEach(p => {
      const client = clients.find(c => c.id === p.client_id)
      const clientName = client?.name || 'Unknown client'
      const caption = p.caption?.slice(0, 40) + (p.caption?.length > 40 ? '…' : '')
      if (p.status === 'approved') notifs.push({ id: 'post-approved-' + p.id, message: '"' + caption + '" was approved', client: clientName, created_at: p.updated_at || p.created_at, read: seenIds.has('post-approved-' + p.id) })
      if (p.status === 'revision') notifs.push({ id: 'post-revision-' + p.id, message: '"' + caption + '" — revisions requested', client: clientName, created_at: p.updated_at || p.created_at, read: seenIds.has('post-revision-' + p.id) })
    })
    comments.filter(c => c.author_type === 'client').forEach(c => {
      const post = posts.find(p => p.id === c.post_id)
      const client = clients.find(cl => cl.id === post?.client_id)
      notifs.push({ id: 'comment-' + c.id, message: c.author + ' left a comment: "' + (c.text?.slice(0, 40) || '') + '…"', client: client?.name || 'Client', created_at: c.created_at, read: seenIds.has('comment-' + c.id) })
    })
    notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return notifs
  }, [posts, comments, clients, seenIds])

  const markAllRead = () => {
    const allIds = notifications.map(n => n.id)
    const newSeen = new Set([...seenIds, ...allIds])
    setSeenIds(newSeen)
    try { localStorage.setItem('bb_seen_notifs', JSON.stringify([...newSeen])) } catch {}
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
  const clientFiltered = base.filter(p => selectedClient === 'all' || p.client_id === selectedClient)
  const filteredPosts = filter === 'archived' || filter === 'active' ? clientFiltered : clientFiltered.filter(p => p.status === filter)

  const counts = {
    active: activePosts.filter(p => selectedClient === 'all' || p.client_id === selectedClient).length,
    pending: activePosts.filter(p => p.status === 'pending' && (selectedClient === 'all' || p.client_id === selectedClient)).length,
    approved: activePosts.filter(p => p.status === 'approved' && (selectedClient === 'all' || p.client_id === selectedClient)).length,
    revision: activePosts.filter(p => p.status === 'revision' && (selectedClient === 'all' || p.client_id === selectedClient)).length,
    published: activePosts.filter(p => p.status === 'published' && (selectedClient === 'all' || p.client_id === selectedClient)).length,
    archived: archivedPosts.filter(p => selectedClient === 'all' || p.client_id === selectedClient).length,
  }

  const pageTitle = filter === 'active' ? "Today's pass" : filter === 'archived' ? 'Archived' : filter === 'pending' ? 'Awaiting Approval' : filter === 'revision' ? 'Revisions Requested' : filter === 'approved' ? 'Approved' : 'Published'

  return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, fontFamily: F.body, display: 'flex', flexDirection: 'column' }} onClick={() => showNotifications && setShowNotifications(false)}>
      <div style={{ background: PALETTE.espresso, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', color: PALETTE.caramel, fontSize: 20, padding: '4px 6px', lineHeight: 1 }}>☰</button>
          )}
          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 17 }}>Brown Butter</span>
          {!isMobile && <span style={{ color: PALETTE.espressoLight, fontSize: 12 }}>|</span>}
          {!isMobile && <span style={{ fontFamily: F.body, fontSize: 9, color: '#7a5a3a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Content Calendar</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={e => { e.stopPropagation(); setShowNotifications(!showNotifications) }} style={{ position: 'relative', background: 'none', border: 'none', color: unreadCount > 0 ? PALETTE.caramel : '#7a5a3a', fontSize: 16, lineHeight: 1, padding: '4px 6px', borderRadius: 6 }}>
            🔔
            {unreadCount > 0 && <span style={{ position: 'absolute', top: 0, right: 0, background: '#C0392B', color: '#fff', borderRadius: '50%', width: 14, height: 14, fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F.body, fontWeight: 700, border: '1.5px solid ' + PALETTE.espresso }}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          <button onClick={() => setComposing(true)} style={{ padding: isMobile ? '6px 10px' : '6px 16px', borderRadius: 6, border: 'none', background: PALETTE.caramel, color: PALETTE.espresso, fontFamily: F.body, fontSize: 11, fontWeight: 500, letterSpacing: '0.03em', transition: 'background 0.15s', whiteSpace: 'nowrap' }}
            onMouseEnter={e => e.currentTarget.style.background = '#D4993A'}
            onMouseLeave={e => e.currentTarget.style.background = PALETTE.caramel}
          >+ New Post</button>
        </div>
        {showNotifications && <NotificationsPanel notifications={notifications} onClose={() => setShowNotifications(false)} onMarkAllRead={markAllRead} />}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {isMobile && sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, top: 52, background: 'rgba(0,0,0,0.35)', zIndex: 150 }} />
        )}
        <div style={isMobile ? {
          position: 'fixed', top: 52, left: 0, bottom: 0, width: '78vw', maxWidth: 280,
          background: PALETTE.cream, borderRight: '0.5px solid ' + PALETTE.border, display: 'flex',
          flexDirection: 'column', overflowY: 'auto', zIndex: 200,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.2s ease',
          boxShadow: sidebarOpen ? '4px 0 20px rgba(0,0,0,0.25)' : 'none'
        } : {
          width: 200, background: PALETTE.cream, borderRight: '0.5px solid ' + PALETTE.border, display: 'flex',
          flexDirection: 'column', flexShrink: 0, overflowY: 'auto'
        }}>
          <div style={{ padding: '18px 14px 8px' }}>
            <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Clients</div>
            {[{ id: 'all', name: 'All Clients', brand_color: PALETTE.caramel }, ...clients].map(c => (
              <div key={c.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button onClick={() => setSelectedClient(c.id)} style={{ flex: 1, textAlign: 'left', padding: '7px 9px', borderRadius: 5, border: 'none', background: selectedClient === c.id ? PALETTE.creamDark : 'transparent', color: selectedClient === c.id ? PALETTE.espresso : PALETTE.muted, fontWeight: selectedClient === c.id ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 1, display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.12s', minWidth: 0 }}
                    onMouseEnter={e => { if (selectedClient !== c.id) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                    onMouseLeave={e => { if (selectedClient !== c.id) e.currentTarget.style.background = 'transparent' }}
                  ><div style={{ width: 7, height: 7, borderRadius: '50%', background: c.brand_color || PALETTE.caramel, flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span></button>
                  {c.id !== 'all' && (
                    <button onClick={() => setHubClientId(c.id)} title="Manage meeting notes & billing" style={{ flexShrink: 0, background: 'none', border: 'none', padding: '4px 5px', borderRadius: 4, fontSize: 11, color: PALETTE.mutedLight, opacity: 0.6 }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                    >🗂</button>
                  )}
                  {c.id !== 'all' && (
                    <button onClick={() => pwEditClientId === c.id ? setPwEditClientId(null) : startEditPassword(c)} title={c.portal_password ? 'Portal password set' : 'Set portal password'} style={{ flexShrink: 0, background: 'none', border: 'none', padding: '4px 5px', borderRadius: 4, fontSize: 11, color: c.portal_password ? PALETTE.caramel : PALETTE.mutedLight, opacity: pwEditClientId === c.id ? 1 : 0.6 }}
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
            ))}
          </div>
          <div style={{ height: '0.5px', background: PALETTE.border, margin: '8px 14px' }} />
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>View</div>
            {[['queue', 'Queue'], ['grid', 'Grid Preview'], ['calendar', 'Calendar']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} style={{ width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 5, border: 'none', background: view === k ? PALETTE.creamDark : 'transparent', color: view === k ? PALETTE.espresso : PALETTE.muted, fontWeight: view === k ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 1, transition: 'all 0.12s' }}
                onMouseEnter={e => { if (view !== k) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={e => { if (view !== k) e.currentTarget.style.background = 'transparent' }}
              >{l}</button>
            ))}
          </div>
          <div style={{ height: '0.5px', background: PALETTE.border, margin: '8px 14px' }} />
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.caramel, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Filter</div>
            {[['active','Everything',counts.active,PALETTE.caramel],['pending','Awaiting approval',counts.pending,'#C4893A'],['revision','Revisions requested',counts.revision,'#C0392B'],['approved','Approved',counts.approved,'#2A7D4F'],['published','Published',counts.published,'#888'],['archived','Archived',counts.archived,'#bbb']].map(([k, l, n, dot]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 5, border: 'none', background: filter === k ? PALETTE.creamDark : 'transparent', color: filter === k ? PALETTE.espresso : PALETTE.muted, fontWeight: filter === k ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.12s' }}
                onMouseEnter={e => { if (filter !== k) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                onMouseLeave={e => { if (filter !== k) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>{k !== 'active' && <div style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />}{l}</div>
                {n > 0 && <span style={{ fontSize: 10, color: filter === k ? PALETTE.caramel : PALETTE.mutedLight, fontWeight: 500 }}>{n}</span>}
              </button>
            ))}
          </div>
          <div style={{ margin: '12px 14px 0', borderRadius: 6, overflow: 'hidden', border: '0.5px solid ' + PALETTE.border }}>
            <div style={{ padding: '7px 10px', background: PALETTE.creamDark, fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>IG Grid Preview</div>
            <IGGrid posts={selectedClient === 'all' ? posts : posts.filter(p => p.client_id === selectedClient)} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          <div style={{ padding: '20px 26px 14px', borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid }}>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 26, color: PALETTE.espresso, lineHeight: 1 }}>{pageTitle}</div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>
              {counts[filter] || 0} post{(counts[filter] || 0) !== 1 ? 's' : ''} · {selectedClient === 'all' ? 'All clients' : clients.find(c => c.id === selectedClient)?.name}
            </div>
          </div>

          {!loading && view === 'queue' && (
            <TodayQueue posts={posts} clients={clients} onSelect={setSelectedPost} />
          )}

          {loading
            ? <div style={{ padding: 48, textAlign: 'center', fontFamily: F.body, fontSize: 13, color: PALETTE.mutedLight }}>Loading...</div>
            : view === 'calendar'
              ? <CalendarView posts={filteredPosts} onSelect={setSelectedPost} />
              : filteredPosts.length === 0
                ? <div style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 18, marginBottom: 18 }}>No posts here yet</div>
                    <button onClick={() => setComposing(true)} style={{ padding: '9px 22px', borderRadius: 7, border: 'none', background: PALETTE.espresso, color: PALETTE.caramel, fontFamily: F.body, fontSize: 12, fontWeight: 500 }}>Create First Post</button>
                  </div>
                : view === 'grid'
                  ? (() => {
                      const statusIcon = (status) => {
                        if (status === 'approved') return { symbol: '✓', bg: 'rgba(42,125,79,0.88)', color: '#fff' }
                        if (status === 'published') return { symbol: '✦', bg: 'rgba(196,137,58,0.88)', color: '#fff' }
                        if (status === 'revision') return { symbol: '↩', bg: 'rgba(192,57,43,0.88)', color: '#fff' }
                        if (status === 'pending') return { symbol: '…', bg: 'rgba(44,31,14,0.55)', color: '#fff' }
                        return { symbol: '?', bg: 'rgba(0,0,0,0.4)', color: '#fff' }
                      }
                      // Newest scheduled date first — mirrors how IG shows most recent at top-left
                      const sortedPosts = [...filteredPosts].sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
                      return (
                        <div style={{ padding: '16px 8px' }}>
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
                                          <div key={post.id} onClick={() => setSelectedPost(post)} style={{ position: 'relative', aspectRatio: '1', background: PALETTE.creamDark, cursor: 'pointer', overflow: 'hidden', outline: isSelected ? '2.5px solid ' + PALETTE.caramel : 'none', outlineOffset: '-2px' }}
                                            onMouseEnter={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '1')}
                                            onMouseLeave={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '0')}
                                          >
                                            {/* Image — contain so nothing is cropped */}
                                            {post.image_url && !hasVid && (
                                              <img src={imgSrc(post.image_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                            )}
                                            {post.image_url && hasVid && (
                                              <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><path d="M8 5v14l11-7z"/></svg>
                                              </div>
                                            )}
                                            {!post.image_url && (
                                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 14 }}>BB</span>
                                              </div>
                                            )}
                                            {/* Status badge — top right */}
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
                                    <div key={post.id} onClick={() => setSelectedPost(post)} style={{ position: 'relative', aspectRatio: '1', background: PALETTE.creamDark, cursor: 'pointer', overflow: 'hidden', outline: isSelected ? '2.5px solid ' + PALETTE.caramel : 'none', outlineOffset: '-2px' }}
                                      onMouseEnter={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '1')}
                                      onMouseLeave={e => e.currentTarget.querySelector('.ig-hover')?.style && (e.currentTarget.querySelector('.ig-hover').style.opacity = '0')}
                                    >
                                      {post.image_url && !hasVid && (
                                        <img src={imgSrc(post.image_url, post.status === 'published')} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} />
                                      )}
                                      {post.image_url && hasVid && (
                                        <div style={{ position: 'absolute', inset: 0, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <svg width="22" height="22" viewBox="0 0 24 24" fill="rgba(255,255,255,0.8)"><path d="M8 5v14l11-7z"/></svg>
                                        </div>
                                      )}
                                      {!post.image_url && (
                                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 14 }}>BB</span>
                                        </div>
                                      )}
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
                            {[['✓','rgba(42,125,79,0.88)','Approved'],['✦','rgba(196,137,58,0.88)','Published'],['↩','rgba(192,57,43,0.88)','Revisions'],['…','rgba(44,31,14,0.55)','Pending']].map(([sym, bg, label]) => (
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
                            {post.image_url && isVideo(post.image_url) && <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill={PALETTE.caramel}><path d="M8 5v14l11-7z"/></svg></div>}
                            {!post.image_url && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 13 }}>BB</div>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                              <Badge status={post.status} />
                              <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{formatLabel}</span>
                              {client && selectedClient === 'all' && <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>· {client.name}</span>}
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
            clients={clients}
            onRefresh={fetchAll}
            onClose={() => setSelectedPost(null)}
            isMobile={isMobile}
          />
        )}
      </div>

      {composing && <ComposeModal clients={clients} onClose={() => setComposing(false)} onSaved={fetchAll} />}
      {hubClientId && <ClientHubModal client={clients.find(c => c.id === hubClientId)} onClose={() => setHubClientId(null)} />}
    </div>
  )
}
