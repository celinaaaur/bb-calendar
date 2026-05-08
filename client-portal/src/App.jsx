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

const fmt = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() + ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}
const fmtShort = (str) => {
  if (!str) return ''
  return new Date(str).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}

const STATUS = {
  pending:   { label: 'AWAITING APPROVAL', color: '#8A5A00', bg: '#FFF6E6', dot: '#C4893A', border: '#E8C87A' },
  approved:  { label: 'APPROVED',          color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F', border: '#7ECBA1' },
  revision:  { label: 'REVISIONS REQUESTED', color: '#7A2018', bg: '#FEECEA', dot: '#C0392B', border: '#F4A59F' },
  published: { label: 'PUBLISHED',         color: '#444',    bg: '#F2F2F2', dot: '#888',    border: '#CCC'    },
  archived:  { label: 'ARCHIVED',          color: '#777',    bg: '#F5F5F5', dot: '#AAA',    border: '#DDD'    },
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
          {p?.image_url && <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          {p && !p.image_url && <div style={{ padding: 3, fontSize: 6, color: PALETTE.muted, lineHeight: 1.3 }}>{p.caption?.slice(0, 30)}</div>}
          {p && <div style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: STATUS[p.status]?.dot || '#ccc', border: '1px solid rgba(255,255,255,0.8)' }} />}
        </div>
      ))}
    </div>
  )
}

function RightPanel({ post, comments, versions, client, onClose, onRefresh }) {
  const [newComment, setNewComment] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const brandColor = client?.brand_color || PALETTE.caramel

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
  }

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendComment()
  }

  const formatLabel = post.format
    ? post.format.charAt(0).toUpperCase() + post.format.slice(1) + (post.slide_count ? ' · ' + post.slide_count + ' slides' : '')
    : 'Post'

  return (
    <div style={{
      width: 320, background: '#fff',
      borderLeft: '0.5px solid ' + PALETTE.border,
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '0.5px solid ' + PALETTE.borderLight,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0
      }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <Badge status={post.status} />
          <div style={{
            fontFamily: F.display, fontStyle: 'italic', fontSize: 14,
            color: PALETTE.espresso, marginTop: 8, lineHeight: 1.4
          }}>
            {post.caption?.slice(0, 55)}{post.caption?.length > 55 ? '…' : ''}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', fontSize: 16, color: PALETTE.mutedLight,
          lineHeight: 1, flexShrink: 0, padding: 2, marginTop: 2,
          transition: 'color 0.15s'
        }}
          onMouseEnter={e => e.currentTarget.style.color = PALETTE.espresso}
          onMouseLeave={e => e.currentTarget.style.color = PALETTE.mutedLight}
        >✕</button>
      </div>

      {/* Image */}
      <div style={{ flexShrink: 0 }}>
        {post.image_url
          ? <img src={post.image_url} alt="" style={{ width: '100%', objectFit: 'cover', maxHeight: 200, display: 'block' }} />
          : <div style={{
              width: '100%', height: 100, background: PALETTE.creamDark,
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontFamily: F.display, color: PALETTE.caramel, fontSize: 14, fontStyle: 'italic' }}>No image uploaded</span>
            </div>
        }
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid ' + PALETTE.borderLight, flexShrink: 0 }}>
        {[
          ['details', 'Details'],
          ['discussion', 'Discussion' + (comments.length > 0 ? ' (' + comments.length + ')' : '')]
        ].map(([k, l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{
            flex: 1, padding: '11px 0', border: 'none', background: 'transparent',
            fontFamily: F.body, fontSize: 11, fontWeight: activeTab === k ? 500 : 400,
            color: activeTab === k ? PALETTE.espresso : PALETTE.muted,
            borderBottom: activeTab === k ? '1.5px solid ' + brandColor : '1.5px solid transparent',
            transition: 'all 0.15s', letterSpacing: '0.03em'
          }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px' }}>
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
                  <span style={{ fontFamily: F.body, fontSize: 10, fontWeight: 400, color: PALETTE.mutedLight, letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 1 }}>{label}</span>
                  <span style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.espresso, lineHeight: 1.5 }}>{value}</span>
                </div>
              ))}
            </div>

            {versions.length > 0 && (
              <>
                <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 20 }} />
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, letterSpacing: '0.12em', color: PALETTE.mutedLight, marginBottom: 14, textTransform: 'uppercase' }}>Version History</div>
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

            {post.status !== 'archived' && post.status !== 'published' && (
              <>
                <div style={{ height: '0.5px', background: PALETTE.borderLight, marginBottom: 18 }} />
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setStatus('revision')} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 6,
                    border: '0.5px solid #D4A0A0', background: '#fff',
                    color: '#9B2B20', fontWeight: 400, fontSize: 12, fontFamily: F.body,
                    transition: 'all 0.15s'
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = '#FEECEA'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >Request revisions</button>
                  <button onClick={() => setStatus('approved')} style={{
                    flex: 1, padding: '10px 8px', borderRadius: 6,
                    border: 'none', background: PALETTE.espresso,
                    color: PALETTE.cream, fontWeight: 400, fontSize: 12, fontFamily: F.body,
                    transition: 'all 0.15s'
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = PALETTE.espressoLight}
                    onMouseLeave={e => e.currentTarget.style.background = PALETTE.espresso}
                  >+ Approve</button>
                </div>
                <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, textAlign: 'center', letterSpacing: '0.04em' }}>{statusLine(post.status)}</div>
              </>
            )}

            {(post.status === 'approved' || post.status === 'published') && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#E8F8EE', borderRadius: 6, border: '0.5px solid #7ECBA1' }}>
                <div style={{ fontFamily: F.body, fontSize: 11, color: '#1E6E3E', letterSpacing: '0.03em' }}>{statusLine(post.status)}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'discussion' && (
          <div>
            {comments.length === 0 && (
              <p style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontStyle: 'italic', margin: '0 0 20px', lineHeight: 1.6 }}>
                No comments yet. Leave a note for the Brown Butter team.
              </p>
            )}
            {comments.map(c => (
              <div key={c.id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '0.5px dashed ' + PALETTE.borderLight }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'baseline' }}>
                  <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 500, color: PALETTE.espresso }}>
                    {c.author_type === 'agency' ? 'Brown Butter' : c.author}
                  </span>
                  <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{fmtShort(c.created_at)}</span>
                </div>
                <p style={{ margin: 0, fontFamily: F.body, fontSize: 13, color: PALETTE.espressoLight, lineHeight: 1.65 }}>{c.text}</p>
              </div>
            ))}
            <input
              value={authorName}
              onChange={e => setAuthorName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid,
                fontSize: 12, color: PALETTE.espresso, marginBottom: 8,
                fontFamily: F.body
              }}
            />
            <div style={{ background: PALETTE.creamMid, border: '0.5px solid ' + PALETTE.border, borderRadius: 8, padding: '10px 14px' }}>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Leave a note for the team..."
                rows={3}
                style={{
                  width: '100%', border: 'none', background: 'transparent',
                  fontSize: 13, color: PALETTE.espresso, resize: 'none',
                  fontFamily: F.body, lineHeight: 1.6
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid ' + PALETTE.borderLight }}>
                <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>⌘ + Enter to send</span>
                <button
                  onClick={sendComment}
                  disabled={saving || !newComment.trim()}
                  style={{
                    padding: '6px 16px', borderRadius: 5,
                    border: '0.5px solid ' + PALETTE.border,
                    background: newComment.trim() ? PALETTE.espresso : '#fff',
                    color: newComment.trim() ? PALETTE.cream : PALETTE.muted,
                    fontFamily: F.body, fontSize: 12, fontWeight: 400,
                    opacity: saving ? 0.5 : 1, transition: 'all 0.15s'
                  }}
                >Post comment</button>
              </div>
            </div>
          </div>
        )}
      </div>
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
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const slug = window.location.pathname.replace('/', '').split('/')[0] || ''

  const fetchAll = async () => {
    const { data: clientData } = await supabase.from('clients').select('*').eq('slug', slug).single()
    if (!clientData) { setNotFound(true); setLoading(false); return }
    setClient(clientData)
    const [p, cm, v] = await Promise.all([
      supabase.from('posts').select('*').eq('client_id', clientData.id).order('scheduled_at'),
      supabase.from('comments').select('*').order('created_at'),
      supabase.from('versions').select('*').order('created_at')
    ])
    if (p.data) setPosts(p.data)
    if (cm.data) setComments(cm.data)
    if (v.data) setVersions(v.data)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const s1 = supabase.channel('cp-posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchAll).subscribe()
    const s2 = supabase.channel('cp-comments').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll).subscribe()
    return () => { s1.unsubscribe(); s2.unsubscribe() }
  }, [])

  // Loading screen
  if (loading) return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 22, color: PALETTE.caramel, marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.mutedLight, fontWeight: 300, letterSpacing: '0.05em' }}>Loading your content...</div>
      </div>
    </div>
  )

  // Not found screen
  if (notFound) return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 22, color: PALETTE.caramel, marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: PALETTE.muted, fontWeight: 300 }}>Portal not found. Please check your link.</div>
      </div>
    </div>
  )

  const brandColor = client?.brand_color || PALETTE.caramel
  const activePosts = posts.filter(p => p.status !== 'archived')
  const filteredPosts = filter === 'all' ? activePosts : activePosts.filter(p => p.status === filter)

  const counts = {
    all: activePosts.length,
    pending: activePosts.filter(p => p.status === 'pending').length,
    approved: activePosts.filter(p => p.status === 'approved').length,
    revision: activePosts.filter(p => p.status === 'revision').length,
  }

  const pageTitle = filter === 'all' ? 'Your Content'
    : filter === 'pending' ? 'Awaiting Your Approval'
    : filter === 'approved' ? 'Approved Posts'
    : 'Needs Changes'

  return (
    <div style={{ minHeight: '100vh', background: PALETTE.cream, fontFamily: F.body, display: 'flex', flexDirection: 'column' }}>

      {/* Top bar */}
      <div style={{
        background: PALETTE.espresso, padding: '0 28px', height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100, flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: brandColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 500, fontSize: 10, fontFamily: F.body
          }}>
            {client.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 16, color: '#fff', lineHeight: 1.1 }}>{client.name}</div>
            <div style={{ fontFamily: F.body, fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 1 }}>
              Content Review · Managed by Brown Butter
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {counts.pending > 0 && (
            <span style={{
              fontFamily: F.body, background: PALETTE.caramelLight, color: '#7A4F00',
              padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 500,
              letterSpacing: '0.06em'
            }}>{counts.pending} awaiting approval</span>
          )}
          {counts.revision > 0 && (
            <span style={{
              fontFamily: F.body, background: '#FEECEA', color: '#7A2018',
              padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 500,
              letterSpacing: '0.06em'
            }}>{counts.revision} needs changes</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <div style={{
          width: 192, background: PALETTE.cream,
          borderRight: '0.5px solid ' + PALETTE.border,
          display: 'flex', flexDirection: 'column', flexShrink: 0
        }}>
          <div style={{ padding: '22px 16px' }}>
            <div style={{ fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.mutedLight, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Filter</div>
            {[
              ['all', 'All Posts', counts.all],
              ['pending', 'Awaiting Approval', counts.pending],
              ['approved', 'Approved', counts.approved],
              ['revision', 'Needs Changes', counts.revision],
            ].map(([k, l, n]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 5,
                border: 'none', background: filter === k ? PALETTE.creamDark : 'transparent',
                color: filter === k ? PALETTE.espresso : PALETTE.muted,
                fontWeight: filter === k ? 500 : 400, fontSize: 12, fontFamily: F.body,
                marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'all 0.12s'
              }}
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
          </div>

          <div style={{ height: '0.5px', background: PALETTE.border, margin: '0 16px' }} />

          <div style={{ margin: '18px 16px 0', borderRadius: 6, overflow: 'hidden', border: '0.5px solid ' + PALETTE.border }}>
            <div style={{ padding: '7px 10px', background: PALETTE.creamDark, fontFamily: F.body, fontSize: 9, fontWeight: 500, color: PALETTE.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Feed Preview
            </div>
            <IGGrid posts={posts} />
          </div>

          <div style={{ padding: '20px 16px', marginTop: 'auto' }}>
            <div style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight, marginBottom: 3, fontWeight: 300 }}>Managed by</div>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 15 }}>Brown Butter</div>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          <div style={{ padding: '22px 28px 16px', borderBottom: '0.5px solid ' + PALETTE.border, background: PALETTE.creamMid }}>
            <div style={{ fontFamily: F.display, fontStyle: 'italic', fontSize: 26, color: PALETTE.espresso, lineHeight: 1 }}>{pageTitle}</div>
            <div style={{ fontFamily: F.body, fontSize: 12, color: PALETTE.muted, marginTop: 6, fontWeight: 300 }}>
              {filteredPosts.length} post{filteredPosts.length !== 1 ? 's' : ''} · Click any post to review
            </div>
          </div>

          {filteredPosts.length === 0
            ? (
              <div style={{ padding: 60, textAlign: 'center' }}>
                <div style={{ fontFamily: F.display, fontStyle: 'italic', color: PALETTE.mutedLight, fontSize: 18 }}>No posts in this category</div>
              </div>
            )
            : filteredPosts.map(post => {
                const postComments = comments.filter(c => c.post_id === post.id)
                const isSelected = selectedPost?.id === post.id
                const formatLabel = post.format ? post.format.charAt(0).toUpperCase() + post.format.slice(1) : 'Post'
                return (
                  <div
                    key={post.id}
                    onClick={() => setSelectedPost(post)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '14px 24px',
                      borderBottom: '0.5px solid ' + PALETTE.borderLight,
                      cursor: 'pointer',
                      background: isSelected ? '#FDF8F0' : '#fff',
                      borderLeft: isSelected ? '2px solid ' + brandColor : '2px solid transparent',
                      transition: 'background 0.1s'
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = PALETTE.creamMid }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff' }}
                  >
                    <div style={{ width: 52, height: 52, borderRadius: 5, overflow: 'hidden', flexShrink: 0, background: PALETTE.creamDark }}>
                      {post.image_url
                        ? <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: F.display, fontStyle: 'italic', color: PALETTE.caramel, fontSize: 13 }}>BB</div>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <Badge status={post.status} />
                        <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{formatLabel}</span>
                        {post.campaign && <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>· {post.campaign}</span>}
                      </div>
                      <p style={{
                        margin: 0, fontFamily: F.body, fontSize: 13, color: PALETTE.espresso,
                        lineHeight: 1.55, display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontWeight: 300
                      }}>{post.caption}</p>
                      <div style={{ marginTop: 6, display: 'flex', gap: 14, alignItems: 'center' }}>
                        <span style={{ fontFamily: F.body, fontSize: 10, color: PALETTE.mutedLight }}>{fmt(post.scheduled_at)}</span>
                        {postComments.length > 0 && (
                          <span style={{ fontFamily: F.body, fontSize: 10, color: brandColor, fontWeight: 500 }}>
                            {postComments.length} comment{postComments.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {post.image_url && (
                      <img src={post.image_url} alt="" style={{ width: 42, height: 42, borderRadius: 4, objectFit: 'cover', flexShrink: 0, opacity: 0.6 }} />
                    )}
                  </div>
                )
              })
          }
        </div>

        {/* Right panel */}
        {selectedPost && (
          <RightPanel
            post={posts.find(p => p.id === selectedPost.id) || selectedPost}
            comments={comments.filter(c => c.post_id === selectedPost.id)}
            versions={versions.filter(v => v.post_id === selectedPost.id)}
            client={client}
            onClose={() => setSelectedPost(null)}
            onRefresh={fetchAll}
          />
        )}
      </div>
    </div>
  )
}
