import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const style = document.createElement('style')
style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #F5F0E8; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #D4C9B0; border-radius: 4px; }
  textarea:focus, input:focus { outline: none; }
  button { cursor: pointer; }

  .filter-scroll {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 14px 16px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .filter-scroll::-webkit-scrollbar { display: none; }

  .bottom-sheet-overlay {
    position: fixed;
    inset: 0;
    background: rgba(44,31,14,0.4);
    z-index: 200;
    animation: fadeIn 0.2s ease;
  }
  .bottom-sheet {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    background: #fff;
    border-radius: 18px 18px 0 0;
    height: 92vh;
    display: flex;
    flex-direction: column;
    z-index: 201;
    animation: slideUp 0.28s cubic-bezier(0.32,0.72,0,1);
    overflow: hidden;
  }
  @keyframes fadeIn {
    from { opacity: 0; } to { opacity: 1; }
  }
  @keyframes slideUp {
    from { transform: translateY(100%); } to { transform: translateY(0); }
  }
  .sheet-drag-handle {
    width: 36px; height: 4px;
    background: #D4C9B0;
    border-radius: 4px;
    margin: 10px auto 4px;
    flex-shrink: 0;
  }
`
document.head.appendChild(style)

const F = {
  display: "'DM Serif Display', Georgia, serif",
  body: "'DM Sans', system-ui, sans-serif"
}

const PALETTE = {
  cream: '#F5F0E8',
  creamDark: '#EDE5D4',
  creamMid: '#FAF6EE',
  border: '#D4C9B0',
  borderLight: '#E8E0D0',
  espresso: '#2C1F0E',
  espressoLight: '#5C4A30',
  caramel: '#C4893A',
  caramelLight: '#F0E8D5',
  muted: '#8A7560',
  mutedLight: '#B8A898',
}

const isVideo = (url) => {
  if (!url) return false
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  return ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)
}

// Append low-res transform params for published posts
const imgSrc = (url, published = false) => {
  if (!url || isVideo(url)) return url
  if (published && url.includes('supabase')) {
    return url + (url.includes('?') ? '&' : '?') + 'width=800&quality=60'
  }
  return url
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
  if (days < 7) return days + ' days ago'
  return fmtShort(str)
}
const weekRange = () => {
  const now = new Date()
  const day = now.getDay()
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  const f = (d) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }).toUpperCase()
  return f(mon) + ' — ' + f(sun)
}
const greeting = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const STATUS = {
  pending:   { label: 'AWAITING APPROVAL',   color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A', border: '#E8C87A' },
  approved:  { label: 'APPROVED',            color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F', border: '#7ECBA1' },
  revision:  { label: 'REVISIONS REQUESTED', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B', border: '#F4A59F' },
  published: { label: 'PUBLISHED',           color: '#444',    bg: '#F2F2F2', dot: '#888',    border: '#CCC'    },
  archived:  { label: 'ARCHIVED',            color: '#777',    bg: '#F5F5F5', dot: '#AAA',    border: '#DDD'    },
}

const statusLine = (status) => {
  if (status === 'pending') return 'Nothing goes live until you say so.'
  if (status === 'approved') return 'Approved — Brown Butter will schedule this post.'
  if (status === 'revision') return 'Awaiting revised version from Brown Butter.'
  if (status === 'published') return 'This post has been published.'
  return ''
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{
      fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em',
      padding: '3px 8px', borderRadius: 3,
      background: s.bg, color: s.color, border: '0.5px solid ' + s.border,
      textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>{s.label}</span>
  )
}

// ── What's New box ────────────────────────────────────────────────────────────
function WhatsNewBox({ posts, comments, versions, isMobile }) {
  const [dismissed, setDismissed] = useState(false)

  // Build activity feed from posts + comments + versions, last 14 days
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const items = []

  posts.forEach(p => {
    const ts = new Date(p.updated_at || p.created_at).getTime()
    if (ts < cutoff) return
    const caption = p.caption?.slice(0, 36) + (p.caption?.length > 36 ? '…' : '')
    if (p.status === 'published') {
      items.push({ ts, icon: '✦', color: PALETTE.caramel, text: `"${caption}" is now live on Instagram`, date: p.updated_at || p.created_at })
    } else if (p.status === 'revision') {
      items.push({ ts, icon: '↩', color: '#C0392B', text: `Revisions requested on "${caption}"`, date: p.updated_at || p.created_at })
    } else if (p.status === 'pending') {
      const created = new Date(p.created_at).getTime()
      if (Date.now() - created < 7 * 24 * 60 * 60 * 1000) {
        items.push({ ts: created, icon: '+', color: '#2A7D4F', text: `New post added: "${caption}"`, date: p.created_at })
      }
    }
  })

  versions.forEach(v => {
    const ts = new Date(v.created_at).getTime()
    if (ts < cutoff) return
    const post = posts.find(p => p.id === v.post_id)
    const caption = post?.caption?.slice(0, 32) + (post?.caption?.length > 32 ? '…' : '') || 'a post'
    items.push({ ts, icon: '✎', color: PALETTE.muted, text: `Caption updated on "${caption}"`, date: v.created_at })
  })

  comments.filter(c => c.author_type === 'agency').forEach(c => {
    const ts = new Date(c.created_at).getTime()
    if (ts < cutoff) return
    items.push({ ts, icon: '💬', color: PALETTE.espresso, text: `Brown Butter left a note: "${c.text?.slice(0, 40)}…"`, date: c.created_at })
  })

  items.sort((a, b) => b.ts - a.ts)
  const recent = items.slice(0, 5)

  if (dismissed || recent.length === 0) return null

  return (
    <div style={{
      margin: isMobile ? '16px 18px 0' : '20px 28px 0',
      background: '#fff',
      border: '0.5px solid ' + PALETTE.border,
      borderRadius: 10,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: PALETTE.espresso, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 14 }}>What's new</span>
          <span style={{ fontFamily: F.body, fontSize: 9, color: '#7a5a3a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>from Brown Butter</span>
        </div>
        <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', color: '#7a5a3a', fontSize: 14, lineHeight: 1, padding: 2 }}>✕</button>
      </div>
      {/* Items */}
      <div>
        {recent.map((item, i) => (
          <div key={i} style={{
            padding: '11px 16px',
            borderBottom: i < recent.length - 1 ? '0.5px solid ' + PALETTE.borderLight : 'none',
            display: 'flex', gap: 12, alignItems: 'flex-start'
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: PALETTE.creamDark,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: item.color, fontWeight: 700, marginTop: 1
            }}>{item.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{item.text}</div>
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginTop: 2 }}>{fmtAgo(item.date)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Calendar view ─────────────────────────────────────────────────────────────
function CalendarView({ posts, onSelectPost, isMobile }) {
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
    <div style={{ padding: isMobile ? '16px 12px' : '20px 24px' }}>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(year - 1) } else setMonth(month - 1) }}
          style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 6, padding: '6px 14px', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>←</button>
        <span style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 18, color: PALETTE.espresso, flex: 1, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(year + 1) } else setMonth(month + 1) }}
          style={{ background: 'none', border: '0.5px solid ' + PALETTE.border, borderRadius: 6, padding: '6px 14px', fontFamily: F.body, fontSize: 12, color: PALETTE.muted }}>→</button>
      </div>
      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: PALETTE.border, borderRadius: 8, overflow: 'hidden' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ background: PALETTE.creamDark, padding: '7px 4px', textAlign: 'center', fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          const dayPosts = day ? posts.filter(p => {
            const d = new Date(p.scheduled_at)
            return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
          }) : []
          const isToday = day && now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
          return (
            <div key={i} style={{ background: '#fff', minHeight: isMobile ? 60 : 80, padding: 5, borderTop: isToday ? '2px solid ' + PALETTE.caramel : 'none' }}>
              {day && <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: isToday ? 600 : 400, color: isToday ? PALETTE.caramel : PALETTE.mutedLight, marginBottom: 3 }}>{day}</div>}
              {dayPosts.slice(0, isMobile ? 1 : 2).map(p => (
                <div key={p.id} onClick={() => onSelectPost(p)} style={{
                  background: STATUS[p.status]?.bg || PALETTE.cream,
                  borderLeft: '2px solid ' + (STATUS[p.status]?.dot || '#ccc'),
                  padding: '2px 4px', marginBottom: 2, borderRadius: 2,
                  cursor: 'pointer', fontFamily: F.body,
                  fontSize: isMobile ? 8 : 9, color: PALETTE.espresso, lineHeight: 1.4
                }}>
                  {isMobile ? fmtTime(p.scheduled_at) : fmtTime(p.scheduled_at) + ' — ' + p.caption?.slice(0, 14) + '...'}
                </div>
              ))}
              {dayPosts.length > (isMobile ? 1 : 2) && (
                <div style={{ fontFamily: F.body, fontSize: 8, color: PALETTE.mutedLight }}>+{dayPosts.length - (isMobile ? 1 : 2)} more</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function IGGrid({ posts }) {
  const grid = [...posts].filter(p => p.status !== 'archived')
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2 }}>
      {grid.map((p, i) => (
        <div key={i} style={{
          aspectRatio: '1', overflow: 'hidden', borderRadius: 2, position: 'relative',
          background: p ? (p.image_url ? 'transparent' : `hsl(${28 + i * 8},20%,${86 - i * 2}%)`) : '#E8E0D0'
        }}>
          {p?.image_url && !isVideo(p.image_url) && <img src={imgSrc(p.image_url, p.status === 'published')} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {p?.image_url && isVideo(p.image_url) && (
            <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          )}
          {p && !p.image_url && <div style={{ padding: 3, fontSize: 6, color: PALETTE.muted, lineHeight: 1.3 }}>{p.caption?.slice(0, 30)}</div>}
          {p && <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: STATUS[p.status]?.dot || '#ccc', border: '1px solid rgba(255,255,255,0.8)' }} />}
        </div>
      ))}
    </div>
  )
}

// ── Carousel mockup ──────────────────────────────────────────────────────────
function CarouselMockup({ post, client, images, handle, initials, avatarBg }) {
  const [idx, setIdx] = useState(0)
  const total = images.length
  const goTo = (i) => setIdx(Math.max(0, Math.min(total - 1, i)))

  return (
    <div style={{ padding: '14px 16px', background: PALETTE.creamMid, borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
      <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '2px solid ' + PALETTE.caramel }}>{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 600, color: '#111' }}>{handle}</div>
            {post.campaign && <div style={{ fontFamily: F.body, fontSize: 10, color: '#999' }}>{post.campaign}</div>}
          </div>
          <div style={{ fontSize: 16, color: '#555', letterSpacing: 2, lineHeight: 1 }}>···</div>
        </div>

        <div style={{ width: '100%', paddingBottom: '125%', position: 'relative', background: PALETTE.creamDark, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', position: 'absolute', top: 0, left: 0, height: '100%', width: '100%',
            transform: `translateX(-${idx * 100}%)`, transition: 'transform 0.3s ease'
          }}>
            {images.map((url, i) => (
              <div key={i} style={{ minWidth: '100%', height: '100%', position: 'relative' }}>
                {isVideo(url)
                  ? <video src={url} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
                  : <img src={imgSrc(url, post.status === 'published')} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                }
              </div>
            ))}
          </div>

          {/* Left/right tap zones */}
          {idx > 0 && <div onClick={() => goTo(idx - 1)} style={{ position: 'absolute', left: 0, top: 0, width: '30%', height: '100%', cursor: 'pointer', zIndex: 5 }} />}
          {idx < total - 1 && <div onClick={() => goTo(idx + 1)} style={{ position: 'absolute', right: 0, top: 0, width: '30%', height: '100%', cursor: 'pointer', zIndex: 5 }} />}

          {/* Arrow chevrons */}
          {idx > 0 && (
            <div onClick={() => goTo(idx - 1)} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </div>
          )}
          {idx < total - 1 && (
            <div onClick={() => goTo(idx + 1)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          )}

          {/* Slide counter badge */}
          <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.55)', color: '#fff', fontFamily: F.body, fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 10, zIndex: 6 }}>
            {idx + 1}/{total}
          </div>

          {/* Dot indicators */}
          <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4, zIndex: 6 }}>
            {images.map((_, i) => (
              <div key={i} onClick={() => goTo(i)} style={{ width: 5, height: 5, borderRadius: '50%', background: i === idx ? '#3897F0' : 'rgba(255,255,255,0.8)', cursor: 'pointer', boxShadow: '0 0 2px rgba(0,0,0,0.3)' }} />
            ))}
          </div>
        </div>

        <div style={{ padding: '10px 12px 6px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <div style={{ marginLeft: 'auto' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ fontFamily: F.body, fontSize: 13, color: '#111', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{handle}</span>{' '}
            {(post.caption || '').split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </div>
          {post.scheduled_at && <div style={{ fontFamily: F.body, fontSize: 11, color: '#999', marginTop: 6 }}>{fmtShort(post.scheduled_at)}</div>}
        </div>
      </div>
    </div>
  )
}

function IGMockup({ post, client }) {
  const handle = client?.ig_handle || client?.name?.toLowerCase().replace(/\s+/g, '.') || 'handle'
  const initials = (client?.name || 'BB').slice(0, 2).toUpperCase()
  const avatarBg = client?.brand_color || PALETTE.caramel
  const isStory = post.format === 'story'
  const isReel = post.format === 'reel'
  const hasVideo = isVideo(post.image_url)
  const src = imgSrc(post.image_url, post.status === 'published')

  // ── Carousel mockup ────────────────────────────────────────────────────────
  const images = Array.isArray(post.images) && post.images.length > 0 ? post.images : (post.image_url ? [post.image_url] : [])
  const isCarousel = post.format === 'carousel' && images.length > 1
  if (isCarousel) {
    return <CarouselMockup post={post} client={client} images={images} handle={handle} initials={initials} avatarBg={avatarBg} />
  }

  // ── Story mockup ──────────────────────────────────────────────────────────
  if (isStory) {
    return (
      <div style={{ padding: '14px 16px', background: PALETTE.creamMid, borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
        {/* Phone shell */}
        <div style={{ margin: '0 auto', width: 200, background: '#111', borderRadius: 28, padding: '10px 6px', boxShadow: '0 8px 32px rgba(44,31,14,0.18)' }}>
          {/* Notch */}
          <div style={{ width: 60, height: 6, background: '#222', borderRadius: 4, margin: '0 auto 6px' }} />
          {/* Story frame */}
          <div style={{ borderRadius: 18, overflow: 'hidden', position: 'relative', aspectRatio: '9/16', background: '#1A1A1A' }}>
            {/* Media */}
            {post.image_url && !hasVideo && (
              <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            {post.image_url && hasVideo && (
              <video src={post.image_url} controls playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
            )}
            {!post.image_url && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 12 }}>No asset uploaded</span>
              </div>
            )}

            {/* Story progress bars */}
            <div style={{ position: 'absolute', top: 10, left: 8, right: 8, display: 'flex', gap: 3, zIndex: 10 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ flex: 1, height: 2, borderRadius: 2, background: i === 1 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }} />
              ))}
            </div>

            {/* Story header: avatar + handle + time */}
            <div style={{ position: 'absolute', top: 20, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 7, zIndex: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarBg, border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0 }}>{initials}</div>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 600, color: '#fff', lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>{handle}</div>
                <div style={{ fontFamily: F.body, fontSize: 8, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>
                  {post.scheduled_at ? fmtShort(post.scheduled_at) : 'Just now'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.7)', letterSpacing: 1 }}>···</div>
            </div>

            {/* Caption overlay at bottom */}
            {post.caption && (
              <div style={{ position: 'absolute', bottom: 28, left: 8, right: 8, zIndex: 10 }}>
                <div style={{
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(4px)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  fontFamily: F.body,
                  fontSize: 8,
                  color: '#fff',
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>{post.caption}</div>
              </div>
            )}

            {/* Story bottom bar: reply + send */}
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, zIndex: 10 }}>
              <div style={{ flex: 1, height: 24, borderRadius: 12, border: '1px solid rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                <span style={{ fontFamily: F.body, fontSize: 8, color: 'rgba(255,255,255,0.6)' }}>Send message</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </div>
          </div>
          {/* Home indicator */}
          <div style={{ width: 50, height: 4, background: '#444', borderRadius: 4, margin: '6px auto 2px' }} />
        </div>
      </div>
    )
  }

  // ── Default: Feed post / Reel mockup ─────────────────────────────────────
  return (
    <div style={{ padding: '14px 16px', background: PALETTE.creamMid, borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
      <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: F.body, flexShrink: 0, border: '2px solid ' + PALETTE.caramel }}>{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 600, color: '#111' }}>{handle}</div>
            {post.campaign && <div style={{ fontFamily: F.body, fontSize: 10, color: '#999' }}>{post.campaign}</div>}
          </div>
          <div style={{ fontSize: 16, color: '#555', letterSpacing: 2, lineHeight: 1 }}>···</div>
        </div>
        <div style={{ width: '100%', paddingBottom: hasVideo && isReel ? '177.78%' : '125%', position: 'relative', background: PALETTE.creamDark }}>
          {post.image_url && !hasVideo && (
            <img src={src} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
          {post.image_url && hasVideo && (
            <video src={post.image_url} controls playsInline style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
          )}
          {!post.image_url && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 14 }}>No asset uploaded</span>
            </div>
          )}
        </div>
        <div style={{ padding: '10px 12px 6px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          <div style={{ marginLeft: 'auto' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.6"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </div>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ fontFamily: F.body, fontSize: 13, color: '#111', lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{handle}</span>{' '}
            {(post.caption || '').split('\n').map((line, i, arr) => (
              <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
            ))}
          </div>
          {post.scheduled_at && (
            <div style={{ fontFamily: F.body, fontSize: 11, color: '#999', marginTop: 6 }}>{fmtShort(post.scheduled_at)}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function PostPanel({ post, comments, versions, client, onClose, onRefresh, isMobile }) {
  const [newComment, setNewComment] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const brandColor = client?.brand_color || PALETTE.caramel
  const isPublished = post.status === 'published'

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({
      post_id: post.id,
      author: authorName.trim() || (client?.name || 'Client'),
      author_type: 'client',
      text: newComment.trim()
    })
    setNewComment('')
    setSaving(false)
    onRefresh()
  }

  const setStatus = async (status) => {
    await supabase.from('posts').update({ status }).eq('id', post.id)
    onRefresh()
    if (isMobile) onClose()
  }

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendComment()
  }

  const formatLabel = post.format
    ? post.format.charAt(0).toUpperCase() + post.format.slice(1) + (post.slide_count ? ' · ' + post.slide_count + ' slides' : '')
    : 'Post'

  const content = (
    <>
      <div style={{ padding: '14px 18px 12px', borderBottom: '0.5px solid ' + PALETTE.borderLight, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <Badge status={post.status} />
          <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 13, color: PALETTE.espresso, marginTop: 7, lineHeight: 1.4 }}>
            {post.caption?.slice(0, 55)}{post.caption?.length > 55 ? '…' : ''}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: PALETTE.mutedLight, lineHeight: 1, flexShrink: 0, padding: 4 }}>✕</button>
      </div>

      <IGMockup post={post} client={client} />

      <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
        {[['details', 'Details'], ['discussion', 'Comments' + (comments.length > 0 ? ' (' + comments.length + ')' : '')]].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{
            flex: 1, padding: '12px 0', border: 'none', background: 'transparent',
            fontFamily: F.body, fontSize: 12, fontWeight: activeTab === k ? 500 : 400,
            color: activeTab === k ? PALETTE.espresso : PALETTE.muted,
            borderBottom: activeTab === k ? '1.5px solid ' + brandColor : '1.5px solid transparent',
            transition: 'all 0.15s'
          }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '18px 18px 32px', minHeight: 0 }}>
        {activeTab === 'details' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 14, textTransform: 'uppercase' }}>Details</div>
              {[
                ['Platform', 'Instagram'],
                ['Format', formatLabel],
                post.campaign ? ['Campaign', post.campaign] : null,
                ['Scheduled', fmt(post.scheduled_at)],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 11, alignItems: 'start' }}>
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>{label}</span>
                  <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{value}</span>
                </div>
              ))}
            </div>

            {versions.length > 0 && (
              <>
                <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 12, textTransform: 'uppercase' }}>Version History</div>
                  {versions.sort((a, b) => b.version_number - a.version_number).map(v => (
                    <div key={v.id} style={{ display: 'flex', gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: '0.5px dashed ' + PALETTE.borderLight }}>
                      <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 15, color: '#9B2B20', flexShrink: 0, width: 26 }}>v{v.version_number}</div>
                      <div>
                        <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 3 }}>{fmtShort(v.created_at)} · {v.author}</div>
                        <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{v.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!isPublished && post.status !== 'archived' && (
              <>
                <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setStatus('revision')} style={{ flex: 1, padding: '12px 8px', borderRadius: 8, border: '0.5px solid #D4A0A0', background: '#fff', color: '#9B2B20', fontWeight: 400, fontSize: 13, fontFamily: F.body, transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#FEECEA'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >Request revisions</button>
                  <button onClick={() => setStatus('approved')} style={{ flex: 1, padding: '12px 8px', borderRadius: 8, border: 'none', background: PALETTE.espresso, color: PALETTE.cream, fontWeight: 400, fontSize: 13, fontFamily: F.body, transition: 'all 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = PALETTE.espressoLight}
                    onMouseLeave={e => e.currentTarget.style.background = PALETTE.espresso}
                  >+ Approve</button>
                </div>
                <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, textAlign: 'center', letterSpacing: '0.04em' }}>{statusLine(post.status)}</div>
              </>
            )}

            {isPublished && (
              <div style={{ marginTop: 4, padding: '12px 14px', background: '#F2F2F2', borderRadius: 6, border: '0.5px solid #CCC' }}>
                <div style={{ fontFamily: F.body, fontSize: 12, color: '#555' }}>This post is live on Instagram.</div>
              </div>
            )}

            {post.status === 'approved' && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#E8F8EE', borderRadius: 6, border: '0.5px solid #7ECBA1' }}>
                <div style={{ fontFamily: F.body, fontSize: 12, color: '#1E6E3E' }}>{statusLine(post.status)}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'discussion' && (
          <div>
            {comments.length === 0 && (
              <p style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.mutedLight, fontStyle: 'italic', margin: '0 0 20px', lineHeight: 1.6 }}>
                No comments yet. Leave a note for the Brown Butter team.
              </p>
            )}
            {comments.map(c => (
              <div key={c.id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '0.5px dashed ' + PALETTE.borderLight }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: F.body, fontSize: 13, fontWeight: 500, color: PALETTE.espresso }}>
                    {c.author_type === 'agency' ? 'Brown Butter' : c.author}
                  </span>
                  <span style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight }}>{fmtShort(c.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontFamily: F.body, fontSize: 13, color: PALETTE.espressoLight, lineHeight: 1.65 }}>{c.text}</p>
              </div>
            ))}
            <input value={authorName} onChange={e => setAuthorName(e.target.value)} placeholder="Your name (optional)"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, fontSize: 13, color: PALETTE.espresso, marginBottom: 10, fontFamily: F.body }}
            />
            <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 10, padding: '12px 14px' }}>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={handleKeyDown} placeholder="Leave a note for the team..." rows={3}
                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: 13, color: PALETTE.espresso, resize: 'none', fontFamily: F.body, lineHeight: 1.6 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid ' + PALETTE.borderLight }}>
                <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>⌘ + Enter to send</span>
                <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{ padding: '8px 18px', borderRadius: 6, border: '0.5px solid ' + PALETTE.border, background: newComment.trim() ? PALETTE.espresso : '#fff', color: newComment.trim() ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 13, opacity: saving ? 0.5 : 1, transition: 'all 0.15s' }}>
                  Post comment
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )

  if (isMobile) {
    return (
      <>
        <div className="bottom-sheet-overlay" onClick={onClose} />
        <div className="bottom-sheet">
          <div className="sheet-drag-handle" />
          {content}
        </div>
      </>
    )
  }

  return (
    <div style={{ width: 320, background: '#fff', borderLeft: '0.5px solid ' + PALETTE.border, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden' }}>
      {content}
    </div>
  )
}

// ── Billing helpers ─────────────────────────────────────────────────────────
const BILLING_STATUS = {
  paid:    { label: 'PAID',    color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F' },
  pending: { label: 'PENDING', color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A' },
  overdue: { label: 'OVERDUE', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B' },
}
const fmtMoney = (n) => n == null || n === '' ? '—' : '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateLong = (str) => str ? new Date(str + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

// ── Meeting Notes section ────────────────────────────────────────────────────
function NotesSection({ notes, isMobile }) {
  const sorted = [...notes].sort((a, b) => new Date(b.meeting_date) - new Date(a.meeting_date))
  return (
    <div style={{ padding: isMobile ? '20px 20px 40px' : '28px 40px', maxWidth: 720 }}>
      <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 20 : 24, color: PALETTE.espresso, marginBottom: 4 }}>Meeting Notes</div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 24, fontWeight: 300 }}>
        {sorted.length} note{sorted.length !== 1 ? 's' : ''} from Brown Butter
      </div>
      {sorted.length === 0 ? (
        <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 16, padding: '48px 0', textAlign: 'center' }}>No meeting notes yet</div>
      ) : sorted.map(n => (
        <div key={n.id} style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, padding: '18px 20px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 16, color: PALETTE.espresso }}>{n.title}</div>
            <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, whiteSpace: 'nowrap' }}>{fmtDateLong(n.meeting_date)}</div>
          </div>
          <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espressoLight, lineHeight: 1.7 }}>
            {(n.body || '').split('\n').map((line, i, arr) => <span key={i}>{line}{i < arr.length - 1 && <br />}</span>)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Billing section ───────────────────────────────────────────────────────────
function BillingSection({ cycles, isMobile }) {
  const sorted = [...cycles].sort((a, b) => new Date(b.cycle_start) - new Date(a.cycle_start))
  const today = new Date()
  const current = sorted.find(c => new Date(c.cycle_start) <= today && today <= new Date(c.cycle_end)) || sorted[0]
  const history = sorted.filter(c => c.id !== current?.id)

  return (
    <div style={{ padding: isMobile ? '20px 20px 40px' : '28px 40px', maxWidth: 720 }}>
      <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 20 : 24, color: PALETTE.espresso, marginBottom: 4 }}>Billing</div>
      <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginBottom: 24, fontWeight: 300 }}>Your billing cycles with Brown Butter</div>

      {!current ? (
        <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 16, padding: '48px 0', textAlign: 'center' }}>No billing information yet</div>
      ) : (
        <>
          <div style={{ background: PALETTE.espresso, borderRadius: 12, padding: '22px 24px', marginBottom: 24, color: PALETTE.cream }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5a3a', marginBottom: 6 }}>Current cycle</div>
                <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 16 : 20 }}>{fmtDateLong(current.cycle_start)} – {fmtDateLong(current.cycle_end)}</div>
              </div>
              <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: BILLING_STATUS[current.status]?.bg || '#F2F2F2', color: BILLING_STATUS[current.status]?.color || '#555', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{BILLING_STATUS[current.status]?.label || current.status}</span>
            </div>
            <div style={{ fontFamily: F.display, fontSize: isMobile ? 28 : 34, color: PALETTE.caramel }}>{fmtMoney(current.amount)}</div>
            {current.notes && <div style={{ fontFamily: F.body, fontSize: 12, color: 'rgba(245,240,232,0.75)', marginTop: 10, lineHeight: 1.6 }}>{current.notes}</div>}
            {current.invoice_url && (
              <a href={current.invoice_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 14, fontFamily: F.body, fontSize: 12, color: PALETTE.caramel, textDecoration: 'underline' }}>View invoice →</a>
            )}
          </div>

          {history.length > 0 && (
            <>
              <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 12, textTransform: 'uppercase' }}>History</div>
              <div style={{ background: '#fff', border: '0.5px solid ' + PALETTE.borderLight, borderRadius: 10, overflow: 'hidden' }}>
                {history.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < history.length - 1 ? '0.5px solid ' + PALETTE.borderLight : 'none', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espresso }}>{fmtDateLong(c.cycle_start)} – {fmtDateLong(c.cycle_end)}</div>
                      {c.notes && <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginTop: 2 }}>{c.notes}</div>}
                    </div>
                    <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.espresso, fontWeight: 500 }}>{fmtMoney(c.amount)}</div>
                    <span style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.09em', padding: '3px 8px', borderRadius: 3, background: BILLING_STATUS[c.status]?.bg || '#F2F2F2', color: BILLING_STATUS[c.status]?.color || '#555', textTransform: 'uppercase' }}>{BILLING_STATUS[c.status]?.label || c.status}</span>
                    {c.invoice_url && <a href={c.invoice_url} target="_blank" rel="noreferrer" style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.caramel }}>Invoice</a>}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function ClientPortal() {
  const [client, setClient] = useState(null)
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [versions, setVersions] = useState([])
  const [selectedPost, setSelectedPost] = useState(null)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const [unlocked, setUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [section, setSection] = useState('content') // 'content' | 'notes' | 'billing'
  const [notes, setNotes] = useState([])
  const [billingCycles, setBillingCycles] = useState([])

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const slug = window.location.pathname.replace('/', '').split('/')[0] || ''
  const unlockKey = 'bb_portal_unlocked_' + slug

  const fetchAll = async () => {
    const { data: clientData } = await supabase.from('clients').select('*').eq('slug', slug).single()
    if (!clientData) { setNotFound(true); setLoading(false); return }
    setClient(clientData)

    const needsPassword = !!(clientData.portal_password && clientData.portal_password.trim())
    const isUnlocked = !needsPassword || sessionStorage.getItem(unlockKey) === 'true'
    setUnlocked(isUnlocked)

    if (!isUnlocked) { setLoading(false); return }

    const [p, cm, v, mn, bc] = await Promise.all([
      supabase.from('posts').select('*').eq('client_id', clientData.id).order('scheduled_at'),
      supabase.from('comments').select('*').order('created_at'),
      supabase.from('versions').select('*').order('created_at'),
      supabase.from('meeting_notes').select('*').eq('client_id', clientData.id).order('meeting_date', { ascending: false }),
      supabase.from('billing_cycles').select('*').eq('client_id', clientData.id).order('cycle_start', { ascending: false })
    ])
    if (p.data) setPosts(p.data)
    if (cm.data) setComments(cm.data)
    if (v.data) setVersions(v.data)
    if (mn.data) setNotes(mn.data)
    if (bc.data) setBillingCycles(bc.data)
    setLoading(false)
  }

  const tryUnlock = async () => {
    if (!passwordInput.trim()) return
    setUnlocking(true)
    setPasswordError(false)
    if (passwordInput === client.portal_password) {
      sessionStorage.setItem(unlockKey, 'true')
      setPasswordInput('')
      await fetchAll()
      setUnlocking(false)
    } else {
      setPasswordError(true)
      setUnlocking(false)
    }
  }

  useEffect(() => {
    fetchAll()
    const s1 = supabase.channel('cp-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchAll).subscribe()
    const s2 = supabase.channel('cp-comments').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll).subscribe()
    const s3 = supabase.channel('cp-notes').on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_notes' }, fetchAll).subscribe()
    const s4 = supabase.channel('cp-billing').on('postgres_changes', { event: '*', schema: 'public', table: 'billing_cycles' }, fetchAll).subscribe()
    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe(); s4.unsubscribe() }
  }, [])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 22, color: PALETTE.caramel, marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontWeight: 300 }}>Loading your content...</div>
      </div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 22, color: PALETTE.caramel, marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.muted, fontWeight: 300 }}>Portal not found. Please check your link.</div>
      </div>
    </div>
  )

  if (!unlocked) return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 24, color: PALETTE.caramel, marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.muted, fontWeight: 300, marginBottom: 28, lineHeight: 1.6 }}>
          This portal is password protected. Enter the password{client?.name ? ' for ' + client.name : ''} to continue.
        </div>
        <input
          type="password"
          value={passwordInput}
          onChange={e => { setPasswordInput(e.target.value); setPasswordError(false) }}
          onKeyDown={e => e.key === 'Enter' && tryUnlock()}
          placeholder="Password"
          autoFocus
          style={{ width: '100%', padding: '13px 14px', borderRadius: 8, border: '0.5px solid ' + (passwordError ? '#C0392B' : PALETTE.border), background: '#fff', fontSize: 14, color: PALETTE.espresso, fontFamily: F.body, textAlign: 'center', marginBottom: 10, boxSizing: 'border-box' }}
        />
        {passwordError && <div style={{ fontFamily: F.body, fontSize: 12, color: '#C0392B', marginBottom: 12 }}>Incorrect password. Please try again.</div>}
        <button onClick={tryUnlock} disabled={unlocking || !passwordInput.trim()} style={{ width: '100%', padding: '13px 0', borderRadius: 8, border: 'none', background: passwordInput.trim() ? PALETTE.espresso : PALETTE.creamDark, color: passwordInput.trim() ? PALETTE.cream : PALETTE.mutedLight, fontFamily: F.body, fontSize: 13, fontWeight: 500, cursor: passwordInput.trim() ? 'pointer' : 'not-allowed', transition: 'all 0.15s' }}>
          {unlocking ? 'Checking…' : 'Enter'}
        </button>
        <div style={{ fontFamily: F.body, fontSize: 11, color: PALETTE.mutedLight, marginTop: 20 }}>Don't have the password? Contact Brown Butter.</div>
      </div>
    </div>
  )

  const brandColor = client?.brand_color || PALETTE.caramel
  const activePosts = posts.filter(p => ['pending', 'approved', 'revision'].includes(p.status))
  const publishedPosts = posts.filter(p => p.status === 'published')

  const filteredPosts = filter === 'all' ? activePosts
    : filter === 'published' ? publishedPosts
    : activePosts.filter(p => p.status === filter)

  const counts = {
    all: activePosts.length,
    pending: activePosts.filter(p => p.status === 'pending').length,
    revision: activePosts.filter(p => p.status === 'revision').length,
    approved: activePosts.filter(p => p.status === 'approved').length,
    published: publishedPosts.length,
  }

  const pageTitle = filter === 'all' ? 'Your Content'
    : filter === 'pending' ? 'Awaiting Your Approval'
    : filter === 'approved' ? 'Approved Posts'
    : filter === 'published' ? 'Published Posts'
    : 'Needs Changes'

  const firstName = (client?.contact_name || client?.name || '').split(' ')[0]

  const filterOptions = [
    ['all', 'All Posts', counts.all],
    ['pending', 'Awaiting Approval', counts.pending],
    ['approved', 'Approved', counts.approved],
    ['revision', 'Needs Changes', counts.revision],
    ['published', 'Published', counts.published],
  ]

  return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, fontFamily: F.body, display: 'flex', flexDirection: 'column' }}>

      {/* Hero */}
      <div style={{ background: PALETTE.cream, borderBottom: '0.5px solid ' + PALETTE.border, padding: isMobile ? '20px 20px 18px' : '28px 40px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: isMobile ? 20 : 32 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 18 : 22, color: PALETTE.espresso }}>{client.name}</span>
            <span style={{ fontFamily: F.body, fontSize: isMobile ? 12 : 14, color: PALETTE.muted, fontWeight: 300, fontStyle: 'italic' }}>— this week on social</span>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 13 : 16, color: PALETTE.espresso }}>{greeting()}, {firstName}.</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: PALETTE.caramel, display: 'inline-block' }} />
              <span style={{ fontFamily: F.body, fontSize: 8, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Prepared by Brown Butter</span>
            </div>
          </div>
        </div>

        <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.caramel, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8, fontWeight: 500 }}>
          This week · {weekRange()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ maxWidth: isMobile ? '100%' : 540, flex: 1 }}>
            <div style={{ fontFamily: F.display, fontSize: isMobile ? 36 : 52, lineHeight: 1.05, color: PALETTE.espresso, marginBottom: isMobile ? 10 : 16 }}>
              <span style={{ color: PALETTE.caramel }}>{counts.pending}</span> post{counts.pending !== 1 ? 's' : ''} waiting<br />
              on your approval.
            </div>
            {!isMobile && (
              <div style={{ fontFamily: F.body, fontSize: 14, color: PALETTE.muted, fontWeight: 300, lineHeight: 1.65, marginBottom: 28, maxWidth: 400 }}>
                Brown Butter has {counts.pending} post{counts.pending !== 1 ? 's' : ''} ready for you to review. Take your time — nothing goes live until you say so.
              </div>
            )}
            <div style={{ display: 'flex', gap: isMobile ? 24 : 40, marginTop: isMobile ? 12 : 0 }}>
              {[[counts.pending, 'Awaiting you'], [counts.revision, 'Revising'], [counts.published, 'Published']].map(([num, label]) => (
                <div key={label}>
                  <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 26 : 34, color: PALETTE.espresso, lineHeight: 1 }}>{num}</div>
                  <div style={{ fontFamily: F.body, fontSize: 8, color: PALETTE.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4, fontWeight: 500 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {!isMobile && (
            <div style={{ flexShrink: 0, position: 'relative', width: 210, height: 210, marginBottom: 8 }}>
              {[
                { rotate: '-5deg', bottom: '14px', right: '8px', opacity: 0.3, z: 1 },
                { rotate: '-2deg', bottom: '6px', right: '4px', opacity: 0.6, z: 2 },
                { rotate: '1.5deg', bottom: '0px', right: '0px', opacity: 1, z: 3 },
              ].map((layer, i) => {
                const pendingPosts = activePosts.filter(p => p.status === 'pending')
                const p = pendingPosts[i] || pendingPosts[0]
                const warmBg = `hsl(${14 + i * 5},${42 - i * 8}%,${50 - i * 4}%)`
                return (
                  <div key={i} style={{ position: 'absolute', bottom: layer.bottom, right: layer.right, width: 178, height: 178, borderRadius: 10, background: p?.image_url && !isVideo(p.image_url) ? 'transparent' : warmBg, transform: `rotate(${layer.rotate})`, opacity: layer.opacity, zIndex: layer.z, overflow: 'hidden', boxShadow: '0 6px 24px rgba(44,31,14,0.10)' }}>
                    {p?.image_url && !isVideo(p.image_url) && <img src={imgSrc(p.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {i === 2 && <div style={{ position: 'absolute', bottom: 12, left: 14, fontFamily: F.body, fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.8)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{pendingPosts[0]?.format?.toUpperCase() || 'POST'}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Desktop sidebar */}
        {!isMobile && (
          <div style={{ width: 192, background: PALETTE.cream, borderRight: '0.5px solid ' + PALETTE.border, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ padding: '22px 16px 0' }}>
              <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Portal</div>
              {[['content', 'Content'], ['notes', 'Meeting Notes'], ['billing', 'Billing']].map(([k, l]) => (
                <button key={k} onClick={() => { setSection(k); setSelectedPost(null) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5, border: 'none', background: section === k ? PALETTE.espresso : 'transparent', color: section === k ? PALETTE.cream : PALETTE.muted, fontWeight: section === k ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 2, transition: 'all 0.12s' }}
                  onMouseEnter={e => { if (section !== k) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={e => { if (section !== k) e.currentTarget.style.background = 'transparent' }}
                >{l}</button>
              ))}
            </div>
            {section === 'content' && (
              <div style={{ padding: '18px 16px 22px' }}>
                <div style={{ height: '0.5px', background: PALETTE.border, margin: '2px 0 16px' }} />
                {/* View toggle */}
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>View</div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
                  {[['list', 'List'], ['calendar', 'Calendar']].map(([k, l]) => (
                    <button key={k} onClick={() => setView(k)} style={{
                      flex: 1, padding: '6px 0', borderRadius: 5, border: '0.5px solid ' + (view === k ? PALETTE.caramel : PALETTE.border),
                      background: view === k ? PALETTE.caramel : 'transparent',
                      color: view === k ? '#fff' : PALETTE.muted,
                      fontFamily: F.body, fontSize: 11, fontWeight: view === k ? 500 : 400, transition: 'all 0.12s'
                    }}>{l}</button>
                  ))}
                </div>
                <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Filter</div>
                {[['all','All Posts',counts.all],['pending','Awaiting Approval',counts.pending],['approved','Approved',counts.approved],['revision','Needs Changes',counts.revision]].map(([k,l,n]) => (
                  <button key={k} onClick={() => { setFilter(k); setSelectedPost(null) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5, border: 'none', background: filter === k ? PALETTE.creamDark : 'transparent', color: filter === k ? PALETTE.espresso : PALETTE.muted, fontWeight: filter === k ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.12s' }}
                    onMouseEnter={e => { if (filter !== k) e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                    onMouseLeave={e => { if (filter !== k) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {k !== 'all' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS[k]?.dot || PALETTE.mutedLight, flexShrink: 0, display: 'inline-block' }} />}
                      {l}
                    </span>
                    {n > 0 && <span style={{ fontSize: 10, color: filter === k ? brandColor : PALETTE.mutedLight, fontWeight: 500 }}>{n}</span>}
                  </button>
                ))}
                <div style={{ height: '0.5px', background: PALETTE.border, margin: '10px 0' }} />
                <button onClick={() => { setFilter('published'); setSelectedPost(null) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5, border: 'none', background: filter === 'published' ? PALETTE.creamDark : 'transparent', color: filter === 'published' ? PALETTE.espresso : PALETTE.muted, fontWeight: filter === 'published' ? 500 : 400, fontSize: 12, fontFamily: F.body, marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.12s' }}
                  onMouseEnter={e => { if (filter !== 'published') e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
                  onMouseLeave={e => { if (filter !== 'published') e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS.published.dot, flexShrink: 0, display: 'inline-block' }} />
                    Published
                  </span>
                  {counts.published > 0 && <span style={{ fontSize: 10, color: filter === 'published' ? brandColor : PALETTE.mutedLight, fontWeight: 500 }}>{counts.published}</span>}
                </button>
              </div>
            )}
            {section === 'content' && <div style={{ height: '0.5px', background: PALETTE.border, margin: '0 16px' }} />}
            {section === 'content' && (
              <div style={{ margin: '18px 16px 0', borderRadius: 6, overflow: 'hidden', border: '0.5px solid ' + PALETTE.border }}>
                <div style={{ padding: '7px 10px', background: PALETTE.creamDark, fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Feed Preview</div>
                <IGGrid posts={posts} />
              </div>
            )}
            <div style={{ padding: '20px 16px', marginTop: 'auto' }}>
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 3, fontWeight: 300 }}>Managed by</div>
              <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 15 }}>Brown Butter</div>
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>

          {/* Mobile primary section tabs */}
          {isMobile && (
            <div className="filter-scroll" style={{ borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.cream, paddingBottom: 8 }}>
              {[['content', 'Content'], ['notes', 'Meeting Notes'], ['billing', 'Billing']].map(([k, l]) => (
                <button key={k} onClick={() => { setSection(k); setSelectedPost(null) }} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 20, border: '0.5px solid ' + (section === k ? brandColor : PALETTE.border), background: section === k ? PALETTE.espresso : '#fff', color: section === k ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 12, fontWeight: section === k ? 500 : 400, whiteSpace: 'nowrap' }}>{l}</button>
              ))}
            </div>
          )}

          {/* Mobile filter + view chips */}
          {isMobile && section === 'content' && (
            <div className="filter-scroll" style={{ borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.cream }}>
              {/* View toggles */}
              <button onClick={() => setView('list')} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 20, border: '0.5px solid ' + (view === 'list' ? brandColor : PALETTE.border), background: view === 'list' ? PALETTE.espresso : '#fff', color: view === 'list' ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 12, whiteSpace: 'nowrap' }}>List</button>
              <button onClick={() => setView('calendar')} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: 20, border: '0.5px solid ' + (view === 'calendar' ? brandColor : PALETTE.border), background: view === 'calendar' ? PALETTE.espresso : '#fff', color: view === 'calendar' ? PALETTE.cream : PALETTE.muted, fontFamily: F.body, fontSize: 12, whiteSpace: 'nowrap' }}>Calendar</button>
              <div style={{ width: 1, background: PALETTE.border, flexShrink: 0, alignSelf: 'stretch', margin: '6px 4px' }} />
              {filterOptions.map(([k, l, n]) => (
                <button key={k} onClick={() => { setFilter(k); setSelectedPost(null) }} style={{
                  flexShrink: 0, padding: '7px 14px', borderRadius: 20,
                  border: '0.5px solid ' + (filter === k ? brandColor : PALETTE.border),
                  background: filter === k ? PALETTE.espresso : '#fff',
                  color: filter === k ? PALETTE.cream : PALETTE.muted,
                  fontFamily: F.body, fontSize: 12, fontWeight: filter === k ? 500 : 400,
                  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'all 0.12s'
                }}>
                  {k !== 'all' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: filter === k ? PALETTE.cream : (STATUS[k]?.dot || PALETTE.mutedLight), display: 'inline-block' }} />}
                  {l}
                  {n > 0 && <span style={{ fontSize: 10, opacity: 0.7 }}>{n}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Meeting Notes section */}
          {section === 'notes' && <NotesSection notes={notes} isMobile={isMobile} />}

          {/* Billing section */}
          {section === 'billing' && <BillingSection cycles={billingCycles} isMobile={isMobile} />}

          {section === 'content' && (
          <>
          {/* What's New box — shown in list view only */}
          {view === 'list' && (
            <WhatsNewBox posts={posts} comments={comments} versions={versions} isMobile={isMobile} />
          )}

          {/* Calendar view */}
          {view === 'calendar' && (
            <CalendarView
              posts={posts.filter(p => p.status !== 'archived')}
              onSelectPost={(p) => { setSelectedPost(p); setView('list') }}
              isMobile={isMobile}
            />
          )}

          {/* List view */}
          {view === 'list' && (
            <>
              <div style={{ padding: isMobile ? '16px 20px 12px' : '22px 28px 16px', borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid, marginTop: 16 }}>
                <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: isMobile ? 20 : 24, color: PALETTE.espresso, lineHeight: 1 }}>{pageTitle}</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 5, fontWeight: 300 }}>
                  {filteredPosts.length} post{filteredPosts.length !== 1 ? 's' : ''}
                  {filter === 'published' ? ' · Your published content' : ' · Tap any post to review'}
                </div>
              </div>

              {filteredPosts.length === 0
                ? <div style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 18 }}>
                      {filter === 'published' ? 'No published posts yet' : 'No posts in this category'}
                    </div>
                  </div>
                : filteredPosts.map(post => {
                    const postComments = comments.filter(c => c.post_id === post.id)
                    const isSelected = selectedPost?.id === post.id
                    const formatLabel = post.format ? post.format.charAt(0).toUpperCase() + post.format.slice(1) : 'Post'
                    const hasVid = isVideo(post.image_url)
                    const thumb = imgSrc(post.image_url, post.status === 'published')
                    return (
                      <div key={post.id} onClick={() => setSelectedPost(post)} style={{
                        display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16,
                        padding: isMobile ? '14px 18px' : '14px 24px',
                        borderBottom: '0.5px solid ' + PALETTE.borderLight,
                        cursor: 'pointer',
                        background: isSelected && !isMobile ? '#FDF8F0' : '#fff',
                        borderLeft: isSelected && !isMobile ? '2px solid ' + brandColor : '2px solid transparent',
                        transition: 'background 0.1s'
                      }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = PALETTE.creamMid }}
                        onMouseLeave={e => { e.currentTarget.style.background = isSelected && !isMobile ? '#FDF8F0' : '#fff' }}
                      >
                        <div style={{ width: isMobile ? 56 : 52, height: isMobile ? 56 : 52, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: PALETTE.creamDark, position: 'relative' }}>
                          {post.image_url && !hasVid && <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          {post.image_url && hasVid && (
                            <div style={{ width: '100%', height: '100%', background: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill={PALETTE.caramel}><path d="M8 5v14l11-7z"/></svg>
                            </div>
                          )}
                          {!post.image_url && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 13 }}>BB</div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, flexWrap: 'wrap' }}>
                            <Badge status={post.status} />
                            <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{formatLabel}</span>
                            {post.campaign && <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>· {post.campaign}</span>}
                          </div>
                          <p style={{ margin: 0, fontFamily: F.body, fontSize: isMobile ? 14 : 13, color: PALETTE.espresso, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 300 }}>{post.caption}</p>
                          <div style={{ marginTop: 5, display: 'flex', gap: 12, alignItems: 'center' }}>
                            <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{fmt(post.scheduled_at)}</span>
                            {postComments.length > 0 && <span style={{ fontFamily: F.body, fontSize: 10, color: brandColor, fontWeight: 500 }}>{postComments.length} comment{postComments.length !== 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        {post.image_url && !hasVid && (
                          <img src={thumb} alt="" style={{ width: isMobile ? 48 : 42, height: isMobile ? 48 : 42, borderRadius: 4, objectFit: 'cover', flexShrink: 0, opacity: 0.6 }} />
                        )}
                        {isMobile && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={PALETTE.mutedLight} strokeWidth="1.5" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                        )}
                      </div>
                    )
                  })
              }
            </>
          )}

          {isMobile && view === 'list' && (
            <div style={{ padding: '20px 20px 32px', marginTop: 'auto', textAlign: 'center' }}>
              <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 3 }}>Managed by</div>
              <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 15 }}>Brown Butter</div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Desktop side panel */}
        {!isMobile && selectedPost && (
          <PostPanel
            post={posts.find(p => p.id === selectedPost.id) || selectedPost}
            comments={comments.filter(c => c.post_id === selectedPost.id)}
            versions={versions.filter(v => v.post_id === selectedPost.id)}
            client={client}
            onClose={() => setSelectedPost(null)}
            onRefresh={fetchAll}
            isMobile={false}
          />
        )}
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && selectedPost && (
        <PostPanel
          post={posts.find(p => p.id === selectedPost.id) || selectedPost}
          comments={comments.filter(c => c.post_id === selectedPost.id)}
          versions={versions.filter(v => v.post_id === selectedPost.id)}
          client={client}
          onClose={() => setSelectedPost(null)}
          onRefresh={fetchAll}
          isMobile={true}
        />
      )}
    </div>
  )
}
