import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

const formatDate = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

const formatShort = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

const formatTime = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

const STATUS = {
  pending:   { label: 'Awaiting Approval',    color: '#B07D2A', bg: '#FFF8EC', dot: '#D4960A' },
  approved:  { label: 'Approved',             color: '#2A7D4F', bg: '#EDFAF3', dot: '#2A7D4F' },
  revision:  { label: 'Revisions Requested',  color: '#B03A2E', bg: '#FEF0EE', dot: '#C0392B' },
  published: { label: 'Published',            color: '#555',    bg: '#F5F5F5', dot: '#999'    },
  archived:  { label: 'Archived',             color: '#888',    bg: '#F5F5F5', dot: '#aaa'    },
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 4, background: s.bg, color: s.color, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function Avatar({ name, size }) {
  const sz = size || 26
  const colors = ['#2A7D4F','#B07D2A','#B03A2E','#2471A3','#6C3483','#117A65']
  const color = colors[name ? name.charCodeAt(0) % colors.length : 0]
  const initials = name ? name.split(' ').map(function(w){ return w[0] }).join('').slice(0,2).toUpperCase() : 'BB'
  return (
    <div style={{ width: sz, height: sz, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: sz * 0.36, fontWeight: 700, fontFamily: 'Georgia, serif', flexShrink: 0 }}>
      {initials}
    </div>
  )
}

function IGGrid({ posts }) {
  const grid = [...posts].filter(function(p){ return p.status !== 'archived' }).sort(function(a,b){ return new Date(a.scheduled_at) - new Date(b.scheduled_at) }).slice(0,9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
      {grid.map(function(post, i) {
        return (
          <div key={i} style={{ aspectRatio: '1', background: post ? (post.image_url ? 'transparent' : 'hsl(' + (20 + i*15) + ',20%,' + (88-i*2) + '%)') : '#F0EDE8', position: 'relative', overflow: 'hidden' }}>
            {post && post.image_url && <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            {post && !post.image_url && <div style={{ padding: 4, fontSize: 7, color: '#888', lineHeight: 1.3 }}>{post.caption.slice(0,40)}</div>}
            {post && <div style={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%', background: STATUS[post.status] ? STATUS[post.status].dot : '#ccc', border: '1.5px solid #fff' }} />}
          </div>
        )
      })}
    </div>
  )
}

function PostCard({ post, commentCount, onClick }) {
  const s = STATUS[post.status] || STATUS.pending
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', background: '#fff', borderBottom: '1px solid #F0EDE8', cursor: 'pointer', transition: 'background 0.12s' }}
      onMouseEnter={function(e){ e.currentTarget.style.background = '#FAFAF8' }}
      onMouseLeave={function(e){ e.currentTarget.style.background = '#fff' }}
    >
      <div style={{ width: 52, height: 52, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: '#F0EDE8' }}>
        {post.image_url
          ? <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
              <span style={{ color: '#C9A96E' }}>BB</span>
            </div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
          <StatusBadge status={post.status} />
          <span style={{ fontSize: 11, color: '#aaa' }}>IG</span>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#2C1A0E', lineHeight: 1.5, fontFamily: 'Georgia, serif', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.caption}</p>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: '#999' }}>{formatDate(post.scheduled_at)}</span>
          {commentCount > 0 && <span style={{ fontSize: 11, color: '#C9A96E', fontWeight: 600 }}>{commentCount} comment{commentCount !== 1 ? 's' : ''}</span>}
        </div>
      </div>
      {post.image_url && <img src={post.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 4, objectFit: 'cover', flexShrink: 0, opacity: 0.7 }} />}
    </div>
  )
}

function GridCard({ post, onClick }) {
  return (
    <div onClick={onClick} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', border: '1px solid #EDE8E0', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
      onMouseEnter={function(e){ e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
      onMouseLeave={function(e){ e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
    >
      <div style={{ height: 140, background: post.image_url ? 'transparent' : '#F5F0E8', overflow: 'hidden', position: 'relative' }}>
        {post.image_url
          ? <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'Georgia, serif', color: '#C9A96E', fontSize: 22, fontWeight: 700 }}>BB</span>
            </div>
        }
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <StatusBadge status={post.status} />
        </div>
      </div>
      <div style={{ padding: '12px 14px' }}>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#2C1A0E', lineHeight: 1.5, fontFamily: 'Georgia, serif', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.caption}</p>
        <div style={{ fontSize: 11, color: '#999' }}>{formatDate(post.scheduled_at)}</div>
      </div>
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

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={function(){ if (month === 0) { setMonth(11); setYear(year-1) } else setMonth(month-1) }} style={{ background: 'none', border: '1px solid #E0D8CE', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#666' }}>Prev</button>
        <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, color: '#2C1A0E', flex: 1, textAlign: 'center' }}>{monthNames[month]} {year}</span>
        <button onClick={function(){ if (month === 11) { setMonth(0); setYear(year+1) } else setMonth(month+1) }} style={{ background: 'none', border: '1px solid #E0D8CE', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, color: '#666' }}>Next</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#E0D8CE' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(function(d){ return (
          <div key={d} style={{ background: '#F5F0E8', padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#999', letterSpacing: 0.5 }}>{d}</div>
        )})}
        {cells.map(function(day, i) {
          const dayPosts = day ? posts.filter(function(p){
            const d = new Date(p.scheduled_at)
            return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day
          }) : []
          const isToday = day && new Date().getFullYear() === year && new Date().getMonth() === month && new Date().getDate() === day
          return (
            <div key={i} style={{ background: '#fff', minHeight: 80, padding: 6, borderTop: isToday ? '2px solid #C9A96E' : 'none' }}>
              {day && <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#C9A96E' : '#666', marginBottom: 4 }}>{day}</div>}
              {dayPosts.map(function(p) {
                return (
                  <div key={p.id} onClick={function(){ onSelect(p) }} style={{ background: STATUS[p.status] ? STATUS[p.status].bg : '#F5F0E8', borderLeft: '2px solid ' + (STATUS[p.status] ? STATUS[p.status].dot : '#ccc'), padding: '3px 5px', marginBottom: 2, borderRadius: 2, cursor: 'pointer', fontSize: 10, color: '#2C1A0E', lineHeight: 1.3 }}>
                    {formatTime(p.scheduled_at)} — {p.caption.slice(0,20)}...
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PostModal({ post, comments, clients, onClose, onRefresh }) {
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  const client = clients.find(function(c){ return c.id === post.client_id })
  const s = STATUS[post.status] || STATUS.pending

  const sendComment = async function() {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({ post_id: post.id, author: 'Brown Butter', author_type: 'agency', text: newComment.trim() })
    setNewComment('')
    setSaving(false)
    onRefresh()
  }

  const updateStatus = async function(status) {
    await supabase.from('posts').update({ status: status }).eq('id', post.id)
    onRefresh()
  }

  const deletePost = async function() {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    await supabase.from('posts').delete().eq('id', post.id)
    onRefresh()
    onClose()
  }

  const archivePost = async function() {
    await supabase.from('posts').update({ status: 'archived' }).eq('id', post.id)
    onRefresh()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={function(e){ e.stopPropagation() }} style={{ background: '#FAFAF8', borderRadius: 16, width: '100%', maxWidth: 660, maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #EDE8E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', borderRadius: '16px 16px 0 0', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar name={client ? client.name : 'BB'} size={30} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2C1A0E', fontFamily: 'Georgia, serif' }}>{client ? client.name : 'Brown Butter'}</div>
              <StatusBadge status={post.status} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {post.status !== 'archived' && (
              <button onClick={archivePost} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #E0D8CE', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#888' }}>Archive</button>
            )}
            <button onClick={deletePost} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#FEF0EE', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#B03A2E' }}>Delete</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#999', lineHeight: 1 }}>x</button>
          </div>
        </div>

        <div style={{ padding: 22 }}>
          {/* Asset */}
          {post.image_url
            ? <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 300, objectFit: 'cover', marginBottom: 18 }} />
            : <div style={{ width: '100%', height: 140, borderRadius: 10, marginBottom: 18, background: '#F0EDE8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: 'Georgia, serif', color: '#C9A96E', fontSize: 24, fontWeight: 700 }}>BB</span>
              </div>
          }

          {/* Caption */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 6 }}>CAPTION</div>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 14, color: '#2C1A0E', lineHeight: 1.75, background: '#fff', padding: '12px 14px', borderRadius: 8, border: '1px solid #EDE8E0' }}>{post.caption}</p>
          </div>

          {/* Schedule */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #EDE8E0' }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3, letterSpacing: 0.5 }}>SCHEDULED</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#2C1A0E' }}>{formatDate(post.scheduled_at)}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #EDE8E0' }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3, letterSpacing: 0.5 }}>PLATFORM</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#2C1A0E' }}>Instagram</div>
            </div>
          </div>

          {/* Status override */}
          {post.status !== 'archived' && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 10 }}>UPDATE STATUS</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['pending','approved','revision','published'].map(function(k) {
                  const v = STATUS[k]
                  return (
                    <button key={k} onClick={function(){ updateStatus(k) }} style={{ flex: 1, padding: '9px 6px', borderRadius: 7, border: '1.5px solid ' + (post.status === k ? v.dot : '#E0D8CE'), cursor: 'pointer', background: post.status === k ? v.bg : '#fff', color: post.status === k ? v.color : '#888', fontWeight: post.status === k ? 700 : 500, fontSize: 10, transition: 'all 0.15s' }}>{v.label}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 12 }}>COMMENTS {comments.length > 0 && '(' + comments.length + ')'}</div>
            {comments.length === 0 && <p style={{ fontSize: 13, color: '#ccc', fontStyle: 'italic', margin: '0 0 14px' }}>No comments yet.</p>}
            {comments.map(function(c) {
              return (
                <div key={c.id} style={{ background: '#fff', borderRadius: 8, padding: '10px 14px', border: '1px solid #EDE8E0', marginBottom: 8, borderLeft: '3px solid ' + (c.author_type === 'agency' ? '#C9A96E' : '#2A7D4F') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#2C1A0E' }}>{c.author}</span>
                    <span style={{ fontSize: 10, color: '#bbb' }}>{formatDate(c.created_at)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#555', lineHeight: 1.5 }}>{c.text}</p>
                </div>
              )
            })}
            {post.status !== 'archived' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <textarea value={newComment} onChange={function(e){ setNewComment(e.target.value) }} placeholder="Add a note or reply to client..." rows={2} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #E0D8CE', background: '#fff', fontSize: 13, color: '#2C1A0E', resize: 'none', outline: 'none', fontFamily: 'Georgia, serif' }} />
                <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2C1A0E', color: '#C9A96E', fontWeight: 700, fontSize: 12, alignSelf: 'flex-end', opacity: saving || !newComment.trim() ? 0.5 : 1 }}>Send</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ComposeModal({ clients, onClose, onSaved }) {
  const [clientId, setClientId] = useState(clients[0] ? clients[0].id : '')
  const [caption, setCaption] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [imageUrl, setImageUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  const handleFile = async function(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const filename = Date.now() + '.' + ext
    const res = await supabase.storage.from('post-assets').upload(filename, file, { upsert: true })
    if (!res.error) {
      const pub = supabase.storage.from('post-assets').getPublicUrl(filename)
      setImageUrl(pub.data.publicUrl)
    } else {
      const reader = new FileReader()
      reader.onload = function(ev){ setImageUrl(ev.target.result) }
      reader.readAsDataURL(file)
    }
    setUploading(false)
  }

  const handleSave = async function() {
    if (!caption.trim() || !scheduledAt || !clientId) return
    setSaving(true)
    await supabase.from('posts').insert({ client_id: clientId, caption: caption.trim(), scheduled_at: new Date(scheduledAt).toISOString(), image_url: imageUrl, platform: 'instagram', status: 'pending' })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={function(e){ e.stopPropagation() }} style={{ background: '#FAFAF8', borderRadius: 16, width: '100%', maxWidth: 520, maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid #EDE8E0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2C1A0E', borderRadius: '16px 16px 0 0' }}>
          <span style={{ fontFamily: 'Georgia, serif', color: '#C9A96E', fontWeight: 700, fontSize: 15 }}>New Post</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A96E', fontSize: 22, lineHeight: 1 }}>x</button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>CLIENT</div>
            <select value={clientId} onChange={function(e){ setClientId(e.target.value) }} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E0D8CE', background: '#fff', fontSize: 13, color: '#2C1A0E', outline: 'none' }}>
              {clients.map(function(c){ return <option key={c.id} value={c.id}>{c.name}</option> })}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>ASSET {uploading ? '(Uploading...)' : ''}</div>
            {imageUrl
              ? <div style={{ position: 'relative' }}>
                  <img src={imageUrl} alt="" style={{ width: '100%', borderRadius: 8, maxHeight: 200, objectFit: 'cover' }} />
                  <button onClick={function(){ setImageUrl(null) }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', color: '#fff', fontSize: 14 }}>x</button>
                </div>
              : <div onClick={function(){ fileRef.current.click() }} style={{ border: '2px dashed #D4C9B8', borderRadius: 8, padding: '24px 0', textAlign: 'center', cursor: 'pointer', background: '#fff' }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>+</div>
                  <div style={{ fontSize: 13, color: '#999' }}>Click to upload image</div>
                </div>
            }
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>CAPTION</div>
            <textarea value={caption} onChange={function(e){ setCaption(e.target.value) }} placeholder="Write your caption..." rows={4} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E0D8CE', background: '#fff', fontSize: 13, color: '#2C1A0E', resize: 'none', outline: 'none', fontFamily: 'Georgia, serif', lineHeight: 1.6, boxSizing: 'border-box' }} />
            <div style={{ fontSize: 10, color: caption.length > 2200 ? '#B03A2E' : '#ccc', textAlign: 'right', marginTop: 3 }}>{caption.length} / 2,200</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>SCHEDULE DATE AND TIME</div>
            <input type="datetime-local" value={scheduledAt} onChange={function(e){ setScheduledAt(e.target.value) }} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #E0D8CE', background: '#fff', fontSize: 13, color: '#2C1A0E', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <button onClick={handleSave} disabled={saving || !caption.trim() || !scheduledAt} style={{ padding: '12px 0', borderRadius: 8, border: 'none', cursor: caption.trim() && scheduledAt ? 'pointer' : 'not-allowed', background: caption.trim() && scheduledAt ? '#2C1A0E' : '#E0D8CE', color: caption.trim() && scheduledAt ? '#C9A96E' : '#aaa', fontWeight: 700, fontSize: 13, transition: 'all 0.2s' }}>
            {saving ? 'Saving...' : 'Send to Client for Review'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [selectedClient, setSelectedClient] = useState('all')
  const [filter, setFilter] = useState('active')
  const [view, setView] = useState('queue')
  const [selectedPost, setSelectedPost] = useState(null)
  const [composing, setComposing] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchAll = async function() {
    const results = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('posts').select('*').order('scheduled_at'),
      supabase.from('comments').select('*').order('created_at')
    ])
    if (results[0].data) setClients(results[0].data)
    if (results[1].data) setPosts(results[1].data)
    if (results[2].data) setComments(results[2].data)
    setLoading(false)
  }

  useEffect(function() {
    fetchAll()
    const postSub = supabase.channel('db-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchAll).subscribe()
    const commentSub = supabase.channel('db-comments').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll).subscribe()
    return function() { postSub.unsubscribe(); commentSub.unsubscribe() }
  }, [])

  // Email reminder check — runs on load
  useEffect(function() {
    const now = new Date()
    posts.forEach(function(post) {
      if (post.status !== 'approved') return
      const scheduled = new Date(post.scheduled_at)
      const diff = scheduled - now
      if (diff > 0 && diff < 15 * 60 * 1000) {
        const client = clients.find(function(c){ return c.id === post.client_id })
        console.log('REMINDER: Post for ' + (client ? client.name : 'client') + ' is due at ' + formatTime(post.scheduled_at))
      }
    })
  }, [posts])

  const activePosts = posts.filter(function(p){ return p.status !== 'archived' })
  const archivedPosts = posts.filter(function(p){ return p.status === 'archived' })

  const clientPosts = (filter === 'archived' ? archivedPosts : activePosts).filter(function(p){
    return selectedClient === 'all' || p.client_id === selectedClient
  })

  const filteredPosts = filter === 'archived' ? clientPosts : clientPosts.filter(function(p){
    if (filter === 'active') return true
    return p.status === filter
  })

  const counts = {
    active: activePosts.filter(function(p){ return selectedClient === 'all' || p.client_id === selectedClient }).length,
    pending: activePosts.filter(function(p){ return p.status === 'pending' && (selectedClient === 'all' || p.client_id === selectedClient) }).length,
    approved: activePosts.filter(function(p){ return p.status === 'approved' && (selectedClient === 'all' || p.client_id === selectedClient) }).length,
    revision: activePosts.filter(function(p){ return p.status === 'revision' && (selectedClient === 'all' || p.client_id === selectedClient) }).length,
    published: activePosts.filter(function(p){ return p.status === 'published' && (selectedClient === 'all' || p.client_id === selectedClient) }).length,
    archived: archivedPosts.filter(function(p){ return selectedClient === 'all' || p.client_id === selectedClient }).length,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F2ED', fontFamily: 'Calibri, Trebuchet MS, sans-serif', display: 'flex', flexDirection: 'column' }}>

      {/* Top Nav */}
      <div style={{ background: '#2C1A0E', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, color: '#C9A96E', fontSize: 17 }}>Brown Butter</span>
          <span style={{ color: '#5a3a22', fontSize: 12 }}>|</span>
          <span style={{ fontSize: 11, color: '#8a6a4a', letterSpacing: 1 }}>CONTENT CALENDAR</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#5a3a22' }}>
            {counts.pending > 0 ? counts.pending + ' awaiting approval' : 'All posts reviewed'}
          </span>
          <button onClick={function(){ setComposing(true) }} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#C9A96E', color: '#2C1A0E', fontWeight: 700, fontSize: 12 }}>+ New Post</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{ width: 220, background: '#fff', borderRight: '1px solid #EDE8E0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* Client List */}
          <div style={{ padding: '16px 14px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>CLIENTS</div>
            <button onClick={function(){ setSelectedClient('all') }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: selectedClient === 'all' ? '#F5F0E8' : 'transparent', color: selectedClient === 'all' ? '#2C1A0E' : '#666', fontWeight: selectedClient === 'all' ? 700 : 400, fontSize: 13, marginBottom: 2 }}>
              All Clients
            </button>
            {clients.map(function(c) {
              return (
                <button key={c.id} onClick={function(){ setSelectedClient(c.id) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: selectedClient === c.id ? '#F5F0E8' : 'transparent', color: selectedClient === c.id ? '#2C1A0E' : '#666', fontWeight: selectedClient === c.id ? 700 : 400, fontSize: 13, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: c.brand_color || '#C9A96E', flexShrink: 0 }} />
                  {c.name}
                </button>
              )
            })}
          </div>

          <div style={{ height: 1, background: '#EDE8E0', margin: '8px 14px' }} />

          {/* View */}
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>VIEW</div>
            {[['queue','Queue'],['grid','Grid'],['calendar','Calendar']].map(function(item) {
              return (
                <button key={item[0]} onClick={function(){ setView(item[0]) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: view === item[0] ? '#F5F0E8' : 'transparent', color: view === item[0] ? '#2C1A0E' : '#666', fontWeight: view === item[0] ? 700 : 400, fontSize: 13, marginBottom: 2 }}>
                  {item[1]}
                </button>
              )
            })}
          </div>

          <div style={{ height: 1, background: '#EDE8E0', margin: '8px 14px' }} />

          {/* Filter */}
          <div style={{ padding: '8px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, marginBottom: 8 }}>FILTER</div>
            {[
              ['active', 'Everything', counts.active],
              ['pending', 'Awaiting approval', counts.pending],
              ['revision', 'Revisions requested', counts.revision],
              ['approved', 'Approved', counts.approved],
              ['published', 'Published', counts.published],
              ['archived', 'Archived', counts.archived],
            ].map(function(item) {
              const dot = item[0] === 'pending' ? '#D4960A' : item[0] === 'revision' ? '#C0392B' : item[0] === 'approved' ? '#2A7D4F' : item[0] === 'published' ? '#999' : item[0] === 'archived' ? '#bbb' : '#C9A96E'
              return (
                <button key={item[0]} onClick={function(){ setFilter(item[0]) }} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', background: filter === item[0] ? '#F5F0E8' : 'transparent', color: filter === item[0] ? '#2C1A0E' : '#666', fontWeight: filter === item[0] ? 700 : 400, fontSize: 13, marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    {item[0] !== 'active' && <div style={{ width: 7, height: 7, borderRadius: '50%', background: dot }} />}
                    {item[1]}
                  </div>
                  {item[2] > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: filter === item[0] ? '#C9A96E' : '#bbb' }}>{item[2]}</span>}
                </button>
              )
            })}
          </div>

          {/* IG Grid preview */}
          <div style={{ margin: '12px 14px', borderRadius: 8, overflow: 'hidden', border: '1px solid #EDE8E0' }}>
            <div style={{ padding: '8px 10px', background: '#F5F0E8', fontSize: 10, fontWeight: 700, color: '#999', letterSpacing: 0.5 }}>IG GRID PREVIEW</div>
            <IGGrid posts={selectedClient === 'all' ? posts : posts.filter(function(p){ return p.client_id === selectedClient })} />
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading
            ? <div style={{ padding: 48, textAlign: 'center', color: '#aaa', fontSize: 14 }}>Loading...</div>
            : view === 'calendar'
              ? <CalendarView posts={filteredPosts} onSelect={setSelectedPost} />
              : filteredPosts.length === 0
                ? <div style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>+</div>
                    <div style={{ fontFamily: 'Georgia, serif', color: '#999', fontSize: 15 }}>No posts here yet</div>
                    <button onClick={function(){ setComposing(true) }} style={{ marginTop: 16, padding: '9px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2C1A0E', color: '#C9A96E', fontWeight: 700, fontSize: 13 }}>Create First Post</button>
                  </div>
                : view === 'queue'
                  ? <div>{filteredPosts.map(function(post){ return <PostCard key={post.id} post={post} commentCount={comments.filter(function(c){ return c.post_id === post.id }).length} onClick={function(){ setSelectedPost(post) }} /> })}</div>
                  : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, padding: 20 }}>
                      {filteredPosts.map(function(post){ return <GridCard key={post.id} post={post} onClick={function(){ setSelectedPost(post) }} /> })}
                    </div>
          }
        </div>
      </div>

      {selectedPost && (
        <PostModal
          post={posts.find(function(p){ return p.id === selectedPost.id }) || selectedPost}
          comments={comments.filter(function(c){ return c.post_id === selectedPost.id })}
          clients={clients}
          onClose={function(){ setSelectedPost(null) }}
          onRefresh={fetchAll}
        />
      )}
      {composing && <ComposeModal clients={clients} onClose={function(){ setComposing(false) }} onSaved={fetchAll} />}
    </div>
  )
}
