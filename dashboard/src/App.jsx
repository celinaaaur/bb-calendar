import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

const formatDate = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

const STATUS = {
  pending:  { label: 'Pending Review', color: '#C9A96E', bg: 'rgba(201,169,110,0.12)', dot: '#C9A96E' },
  approved: { label: 'Approved',       color: '#5A8A6A', bg: 'rgba(90,138,106,0.12)',  dot: '#5A8A6A' },
  revision: { label: 'Needs Revision', color: '#B85C5C', bg: 'rgba(184,92,92,0.12)',   dot: '#B85C5C' },
}

function IGAvatar({ color }) {
  const bg = 'linear-gradient(135deg, #2C1A0E, ' + (color || '#C9A96E') + ')'
  return (
    <div style={{ width: 34, height: 34, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontFamily: 'Georgia, serif', fontWeight: 'bold', flexShrink: 0 }}>
      IG
    </div>
  )
}

function InstagramGrid({ posts, clientColor }) {
  const grid = [...posts].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)).slice(0, 9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #ede8e0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <IGAvatar color={clientColor} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', fontFamily: 'Georgia, serif' }}>Instagram Preview</div>
          <div style={{ fontSize: 10, color: '#aaa' }}>Next 9 scheduled posts</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
        {grid.map((post, i) => (
          <div key={i} style={{ aspectRatio: '1', borderRadius: 3, overflow: 'hidden', background: post ? (post.image_url ? 'transparent' : 'hsl(' + (25 + i * 12) + ', 22%, ' + (90 - i * 2) + '%)') : '#f0ece6', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {post && post.image_url && <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            {post && !post.image_url && <div style={{ padding: 5, textAlign: 'center' }}><div style={{ fontSize: 7, color: '#5a4a3a', lineHeight: 1.3 }}>{post.caption.slice(0, 45)}...</div></div>}
            {!post && <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#ddd' }} />}
            {post && <div style={{ position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: '50%', background: STATUS[post.status] ? STATUS[post.status].dot : '#ccc', border: '1.5px solid #fff' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function PostCard({ post, commentCount, onClick }) {
  const s = STATUS[post.status]
  return (
    <div onClick={onClick} style={{ background: '#fff', borderRadius: 14, border: '1px solid #ede8e0', padding: '18px 20px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(44,26,14,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
          </div>
          <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 13, color: '#3a2a1a', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.caption}</p>
        </div>
        {post.image_url && <img src={post.image_url} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid #ede8e0' }} />}
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#8a7a6a' }}>{'📅 ' + formatDate(post.scheduled_at)}</span>
        {commentCount > 0 && <span style={{ fontSize: 11, color: '#C9A96E', fontWeight: 600 }}>{'💬 ' + commentCount}</span>}
      </div>
    </div>
  )
}

function PostModal({ post, comments, onClose, onRefresh }) {
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  const s = STATUS[post.status]

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({ post_id: post.id, author: 'Brown Butter', author_type: 'agency', text: newComment.trim() })
    setNewComment('')
    setSaving(false)
    onRefresh()
  }

  const updateStatus = async (status) => {
    await supabase.from('posts').update({ status }).eq('id', post.id)
    onRefresh()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,15,5,0.6)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#faf7f3', borderRadius: 20, width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(30,15,5,0.35)' }}>
        <div style={{ padding: '18px 24px', background: '#2C1A0E', borderRadius: '20px 20px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Georgia, serif', color: '#C9A96E', fontWeight: 700, fontSize: 15 }}>Post Detail</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A96E', fontSize: 22, lineHeight: 1 }}>x</button>
        </div>
        <div style={{ padding: 24 }}>
          {post.image_url
            ? <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 12, maxHeight: 280, objectFit: 'cover', marginBottom: 20 }} />
            : <div style={{ width: '100%', height: 140, borderRadius: 12, marginBottom: 20, background: '#e8e0d5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: '#b0a090', fontSize: 13 }}>No asset uploaded</span></div>
          }
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 6 }}>CAPTION</div>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 14, color: '#3a2a1a', lineHeight: 1.7 }}>{post.caption}</p>
          </div>
          <div style={{ background: '#fff', borderRadius: 10, padding: '12px 16px', marginBottom: 20, border: '1px solid #ede8e0', display: 'flex', gap: 24 }}>
            <div><div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>SCHEDULED</div><div style={{ fontSize: 13, fontWeight: 600, color: '#3a2a1a' }}>{formatDate(post.scheduled_at)}</div></div>
            <div><div style={{ fontSize: 10, color: '#aaa', marginBottom: 2 }}>STATUS</div><span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.label}</span></div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>OVERRIDE STATUS</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(STATUS).map(([k, v]) => (
                <button key={k} onClick={() => updateStatus(k)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: post.status === k ? v.dot : v.bg, color: post.status === k ? '#fff' : v.color, fontWeight: 700, fontSize: 11 }}>{v.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 12 }}>COMMENTS</div>
            {comments.length === 0 && <p style={{ fontSize: 13, color: '#ccc', margin: '0 0 14px', fontStyle: 'italic' }}>No comments yet.</p>}
            {comments.map(c => (
              <div key={c.id} style={{ background: '#fff', borderRadius: 10, padding: '11px 14px', border: '1px solid #ede8e0', marginBottom: 10, borderLeft: '3px solid ' + (c.author_type === 'agency' ? '#C9A96E' : '#5A8A6A') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#3a2a1a' }}>{c.author}</span>
                  <span style={{ fontSize: 10, color: '#bbb' }}>{formatDate(c.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: '#5a4a3a', lineHeight: 1.5 }}>{c.text}</p>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Add a note or reply..." rows={2} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #e0d8ce', background: '#fff', fontSize: 13, color: '#3a2a1a', resize: 'none', outline: 'none', fontFamily: 'Georgia, serif' }} />
              <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#2C1A0E', color: '#C9A96E', fontWeight: 700, fontSize: 12, alignSelf: 'flex-end' }}>Send</button>
            </div>
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

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const filename = Date.now() + '.' + ext
    const { error } = await supabase.storage.from('post-assets').upload(filename, file, { upsert: true })
    if (!error) {
      const { data } = supabase.storage.from('post-assets').getPublicUrl(filename)
      setImageUrl(data.publicUrl)
    } else {
      const reader = new FileReader()
      reader.onload = (ev) => setImageUrl(ev.target.result)
      reader.readAsDataURL(file)
    }
    setUploading(false)
  }

  const handleSave = async () => {
    if (!caption.trim() || !scheduledAt || !clientId) return
    setSaving(true)
    await supabase.from('posts').insert({ client_id: clientId, caption: caption.trim(), scheduled_at: new Date(scheduledAt).toISOString(), image_url: imageUrl, platform: 'instagram', status: 'pending' })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,15,5,0.6)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#faf7f3', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 60px rgba(30,15,5,0.3)' }}>
        <div style={{ padding: '18px 24px', background: '#2C1A0E', borderRadius: '20px 20px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'Georgia, serif', color: '#C9A96E', fontWeight: 700, fontSize: 15 }}>New Post</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#C9A96E', fontSize: 22, lineHeight: 1 }}>x</button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>CLIENT</div>
            <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #e0d8ce', background: '#fff', fontSize: 13, color: '#3a2a1a', outline: 'none' }}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>ASSET {uploading && '(Uploading...)'}</div>
            {imageUrl
              ? <div style={{ position: 'relative' }}><img src={imageUrl} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 200, objectFit: 'cover' }} /><button onClick={() => setImageUrl(null)} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.65)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', color: '#fff', fontSize: 14 }}>x</button></div>
              : <div onClick={() => fileRef.current.click()} style={{ border: '2px dashed #d4c9b8', borderRadius: 10, padding: '24px 0', textAlign: 'center', cursor: 'pointer', background: '#fff' }}><div style={{ fontSize: 26, marginBottom: 6 }}>📸</div><div style={{ fontSize: 13, color: '#8a7a6a' }}>Click to upload image</div></div>
            }
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>CAPTION</div>
            <textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write caption here..." rows={4} style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #e0d8ce', background: '#fff', fontSize: 13, color: '#3a2a1a', resize: 'none', outline: 'none', fontFamily: 'Georgia, serif', lineHeight: 1.6, boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A96E', letterSpacing: 1, marginBottom: 8 }}>SCHEDULE DATE AND TIME</div>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid #e0d8ce', background: '#fff', fontSize: 13, color: '#3a2a1a', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <button onClick={handleSave} disabled={saving || !caption.trim() || !scheduledAt} style={{ padding: '13px 0', borderRadius: 10, border: 'none', cursor: 'pointer', background: caption.trim() && scheduledAt ? '#2C1A0E' : '#e0d8ce', color: caption.trim() && scheduledAt ? '#C9A96E' : '#b0a090', fontWeight: 700, fontSize: 14 }}>{saving ? 'Saving...' : 'Send to Client for Review'}</button>
        </div>
      </div>
    </div>
  )
}

function ActivityLog({ events }) {
  const icons = { approved: '✓', revision: '✎', comment: '💬' }
  const colors = { approved: '#5A8A6A', revision: '#B85C5C', comment: '#C9A96E' }
  return (
    <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #ede8e0' }}>
      <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#2C1A0E', marginBottom: 14 }}>Client Activity</div>
      {events.length === 0
        ? <p style={{ fontSize: 13, color: '#ccc', margin: 0, fontStyle: 'italic' }}>No client activity yet.</p>
        : events.slice(0, 10).map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: colors[e.type] + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: colors[e.type], flexShrink: 0 }}>{icons[e.type]}</div>
            <div>
              <div style={{ fontSize: 12, color: '#3a2a1a', lineHeight: 1.4 }}>
                {e.type === 'approved' && <span><strong>{e.client}</strong> approved a post</span>}
                {e.type === 'revision' && <span><strong>{e.client}</strong> requested revisions</span>}
                {e.type === 'comment' && <span><strong>{e.author}</strong>: {e.text ? e.text.slice(0, 55) : ''}...</span>}
              </div>
              <div style={{ fontSize: 10, color: '#ccc', marginTop: 2 }}>{formatDate(e.time)}</div>
            </div>
          </div>
        ))
      }
    </div>
  )
}

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [selectedClient, setSelectedClient] = useState('all')
  const [filter, setFilter] = useState('all')
  const [selectedPost, setSelectedPost] = useState(null)
  const [composing, setComposing] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchAll = async () => {
    const [{ data: c }, { data: p }, { data: cm }] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('posts').select('*').order('scheduled_at'),
      supabase.from('comments').select('*').order('created_at')
    ])
    if (c) setClients(c)
    if (p) setPosts(p)
    if (cm) setComments(cm)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const postSub = supabase.channel('posts-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchAll).subscribe()
    const commentSub = supabase.channel('comments-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll).subscribe()
    return () => { postSub.unsubscribe(); commentSub.unsubscribe() }
  }, [])

  const filteredPosts = posts.filter(p => selectedClient === 'all' || p.client_id === selectedClient).filter(p => filter === 'all' || p.status === filter)
  const selectedClientData = clients.find(c => c.id === selectedClient)

  const activityEvents = []
  comments.filter(c => c.author_type === 'client').forEach(c => {
    const post = posts.find(p => p.id === c.post_id)
    const client = clients.find(cl => cl.id === (post ? post.client_id : null))
    activityEvents.push({ type: 'comment', author: c.author, text: c.text, time: c.created_at, client: client ? client.name : '' })
  })
  posts.filter(p => p.status !== 'pending').forEach(p => {
    const client = clients.find(c => c.id === p.client_id)
    activityEvents.push({ type: p.status, time: p.updated_at, client: client ? client.name : '' })
  })
  activityEvents.sort((a, b) => new Date(b.time) - new Date(a.time))

  const counts = {
    all: filteredPosts.length,
    pending: posts.filter(p => p.status === 'pending').length,
    approved: posts.filter(p => p.status === 'approved').length,
    revision: posts.filter(p => p.status === 'revision').length,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f0ea', fontFamily: 'Calibri, Trebuchet MS, sans-serif' }}>
      <div style={{ background: '#2C1A0E', padding: '0 28px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, color: '#C9A96E', fontSize: 18 }}>Brown Butter</span>
          <div style={{ width: 1, height: 18, background: '#5a3a22' }} />
          <span style={{ fontSize: 11, color: '#8a6a4a', letterSpacing: 1 }}>CONTENT CALENDAR</span>
        </div>
        <button onClick={() => setComposing(true)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', background: '#C9A96E', color: '#2C1A0E', fontWeight: 700, fontSize: 12 }}>+ New Post</button>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          <button onClick={() => setSelectedClient('all')} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid ' + (selectedClient === 'all' ? '#2C1A0E' : '#e0d8ce'), cursor: 'pointer', fontSize: 12, background: selectedClient === 'all' ? '#2C1A0E' : '#fff', color: selectedClient === 'all' ? '#C9A96E' : '#5a4a3a', fontWeight: selectedClient === 'all' ? 700 : 500 }}>All Clients</button>
          {clients.map(c => (
            <button key={c.id} onClick={() => setSelectedClient(c.id)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid ' + (selectedClient === c.id ? '#2C1A0E' : '#e0d8ce'), cursor: 'pointer', fontSize: 12, background: selectedClient === c.id ? '#2C1A0E' : '#fff', color: selectedClient === c.id ? '#C9A96E' : '#5a4a3a', fontWeight: selectedClient === c.id ? 700 : 500 }}>{c.name}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {[['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['revision', 'Needs Revision']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: '7px 15px', borderRadius: 20, border: '1px solid ' + (filter === k ? '#2C1A0E' : '#e0d8ce'), cursor: 'pointer', fontSize: 11, background: filter === k ? '#2C1A0E' : '#fff', color: filter === k ? '#C9A96E' : '#5a4a3a', fontWeight: filter === k ? 700 : 500 }}>{label + ' (' + counts[k] + ')'}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
          <div>
            {loading
              ? <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>Loading posts...</div>
              : filteredPosts.length === 0
                ? <div style={{ background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center', border: '1px solid #ede8e0' }}><div style={{ fontSize: 34, marginBottom: 10 }}>📭</div><div style={{ fontFamily: 'Georgia, serif', color: '#8a7a6a', fontSize: 15 }}>No posts yet</div></div>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
                    {filteredPosts.map(post => <PostCard key={post.id} post={post} commentCount={comments.filter(c => c.post_id === post.id).length} onClick={() => setSelectedPost(post)} />)}
                  </div>
            }
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <InstagramGrid posts={selectedClient === 'all' ? posts : filteredPosts} clientColor={selectedClientData ? selectedClientData.brand_color : null} />
            <ActivityLog events={activityEvents} />
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #ede8e0' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#2C1A0E', marginBottom: 14 }}>Overview</div>
              {Object.entries({ pending: counts.pending, approved: counts.approved, revision: counts.revision }).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS[k].dot }} />
                    <span style={{ fontSize: 13, color: '#5a4a3a' }}>{STATUS[k].label}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: STATUS[k].color }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedPost && <PostModal post={posts.find(p => p.id === selectedPost.id) || selectedPost} comments={comments.filter(c => c.post_id === selectedPost.id)} onClose={() => setSelectedPost(null)} onRefresh={fetchAll} />}
      {composing && <ComposeModal clients={clients} onClose={() => setComposing(false)} onSaved={fetchAll} />}
    </div>
  )
}
