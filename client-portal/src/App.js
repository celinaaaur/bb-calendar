import { useState, useEffect } from 'react'
import { supabase } from './supabase'

// ─── Helpers ───────────────────────────────────────────────────────────────────
const formatDate = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

const STATUS = {
  pending:  { label: 'Pending Review',  color: '#C9A96E', bg: 'rgba(201,169,110,0.1)',  dot: '#C9A96E' },
  approved: { label: 'Approved',        color: '#5A8A6A', bg: 'rgba(90,138,106,0.1)',   dot: '#5A8A6A' },
  revision: { label: 'Needs Revision',  color: '#B85C5C', bg: 'rgba(184,92,92,0.1)',    dot: '#B85C5C' },
}

// ─── Instagram Grid ────────────────────────────────────────────────────────────
function InstagramGrid({ posts, brandColor }) {
  const grid = [...posts]
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 9)
  while (grid.length < 9) grid.push(null)

  return (
    <div style={{ background: '#fff', borderRadius: 18, padding: 22, border: '1px solid #e8e2d8', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `linear-gradient(135deg, ${brandColor || '#2C1A0E'}, #C9A96E)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 13, fontFamily: 'Georgia, serif', fontWeight: 'bold'
        }}>IG</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', fontFamily: 'Georgia, serif' }}>Instagram Feed Preview</div>
          <div style={{ fontSize: 11, color: '#aaa' }}>How your next 9 posts will look</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
        {grid.map((post, i) => (
          <div key={i} style={{
            aspectRatio: '1', borderRadius: 4, overflow: 'hidden',
            background: post
              ? (post.image_url ? 'transparent' : `hsl(${25 + i * 12}, 20%, ${88 - i * 2}%)`)
              : '#f4f0ea',
            position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {post?.image_url
              ? <img src={post.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : post
                ? <div style={{ padding: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: 7, color: '#5a4a3a', lineHeight: 1.3, fontFamily: 'Georgia, serif' }}>
                      {post.caption.slice(0, 48)}...
                    </div>
                  </div>
                : <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#ddd' }} />
            }
            {post && (
              <div style={{
                position: 'absolute', top: 4, right: 4,
                width: 8, height: 8, borderRadius: '50%',
                background: STATUS[post.status]?.dot,
                border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)'
              }} />
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 14, justifyContent: 'center' }}>
        {Object.entries(STATUS).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: v.dot }} />
            <span style={{ fontSize: 10, color: '#aaa' }}>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Post Card ─────────────────────────────────────────────────────────────────
function PostCard({ post, commentCount, onClick, brandColor }) {
  const s = STATUS[post.status]
  return (
    <div onClick={onClick} style={{
      background: '#fff', borderRadius: 16, border: '1px solid #e8e2d8',
      padding: '20px 22px', cursor: 'pointer',
      transition: 'box-shadow 0.2s, transform 0.15s',
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)'; e.currentTarget.style.transform = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '3px 11px', borderRadius: 20,
              background: s.bg, color: s.color, letterSpacing: 0.4
            }}>{s.label}</span>
          </div>
          <p style={{
            margin: 0, fontFamily: 'Georgia, serif', fontSize: 14, color: '#3a2a1a',
            lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden'
          }}>{post.caption}</p>
        </div>
        {post.image_url && (
          <img src={post.image_url} alt="" style={{
            width: 60, height: 60, borderRadius: 10, objectFit: 'cover', flexShrink: 0,
            border: '1px solid #e8e2d8'
          }} />
        )}
      </div>
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8a7a6a' }}>📅 {formatDate(post.scheduled_at)}</span>
        {commentCount > 0 && (
          <span style={{ fontSize: 11, color: brandColor || '#C9A96E', fontWeight: 600 }}>
            💬 {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Post Detail Modal ─────────────────────────────────────────────────────────
function PostModal({ post, comments, client, onClose, onRefresh }) {
  const [newComment, setNewComment] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [saving, setSaving] = useState(false)
  const s = STATUS[post.status]
  const brandColor = client?.brand_color || '#C9A96E'

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({
      post_id: post.id,
      author: authorName.trim() || client?.name || 'Client',
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

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20,20,20,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#faf8f5', borderRadius: 22, width: '100%', maxWidth: 640,
        maxHeight: '92vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.3)'
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px', borderBottom: '1px solid #ede8e0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: `linear-gradient(135deg, ${brandColor}22, ${brandColor}08)`,
          borderRadius: '22px 22px 0 0'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: brandColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {client?.name?.slice(0, 2).toUpperCase() || 'BB'}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2a1a0a', fontFamily: 'Georgia, serif' }}>{client?.name}</div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#8a7a6a', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '24px' }}>
          {/* Asset */}
          {post.image_url
            ? <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 14, maxHeight: 300, objectFit: 'cover', marginBottom: 22, border: '1px solid #e8e2d8' }} />
            : <div style={{ width: '100%', height: 150, borderRadius: 14, marginBottom: 22, background: 'linear-gradient(135deg, #ede8e0, #ddd5c8)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e2d8' }}>
                <span style={{ color: '#b8a898', fontSize: 13 }}>No image uploaded yet</span>
              </div>
          }

          {/* Caption */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: brandColor, letterSpacing: 1.2, marginBottom: 8 }}>CAPTION</div>
            <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 14, color: '#3a2a1a', lineHeight: 1.75, background: '#fff', padding: '14px 16px', borderRadius: 10, border: '1px solid #e8e2d8' }}>{post.caption}</p>
          </div>

          {/* Schedule info */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
            <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '12px 16px', border: '1px solid #e8e2d8' }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>SCHEDULED FOR</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#3a2a1a' }}>{formatDate(post.scheduled_at)}</div>
            </div>
            <div style={{ flex: 1, background: '#fff', borderRadius: 10, padding: '12px 16px', border: '1px solid #e8e2d8' }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 3 }}>PLATFORM</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#3a2a1a' }}>📸 Instagram</div>
            </div>
          </div>

          {/* Approval Actions */}
          <div style={{ marginBottom: 26 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: brandColor, letterSpacing: 1.2, marginBottom: 10 }}>YOUR DECISION</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <button onClick={() => setStatus('approved')} style={{
                padding: '14px 8px', borderRadius: 12, border: '2px solid',
                borderColor: post.status === 'approved' ? '#5A8A6A' : '#e0d8ce',
                cursor: 'pointer', background: post.status === 'approved' ? '#5A8A6A' : '#fff',
                color: post.status === 'approved' ? '#fff' : '#5A8A6A',
                fontWeight: 700, fontSize: 12, transition: 'all 0.2s', textAlign: 'center'
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>✓</div>
                Approve
              </button>
              <button onClick={() => setStatus('revision')} style={{
                padding: '14px 8px', borderRadius: 12, border: '2px solid',
                borderColor: post.status === 'revision' ? '#B85C5C' : '#e0d8ce',
                cursor: 'pointer', background: post.status === 'revision' ? '#B85C5C' : '#fff',
                color: post.status === 'revision' ? '#fff' : '#B85C5C',
                fontWeight: 700, fontSize: 12, transition: 'all 0.2s', textAlign: 'center'
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>✎</div>
                Request Changes
              </button>
              <button onClick={() => setStatus('pending')} style={{
                padding: '14px 8px', borderRadius: 12, border: '2px solid',
                borderColor: post.status === 'pending' ? '#C9A96E' : '#e0d8ce',
                cursor: 'pointer', background: post.status === 'pending' ? '#C9A96E' : '#fff',
                color: post.status === 'pending' ? '#fff' : '#C9A96E',
                fontWeight: 700, fontSize: 12, transition: 'all 0.2s', textAlign: 'center'
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>⏸</div>
                Keep Pending
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: brandColor, letterSpacing: 1.2, marginBottom: 12 }}>
              COMMENTS {comments.length > 0 && `(${comments.length})`}
            </div>
            {comments.length === 0
              ? <p style={{ fontSize: 13, color: '#ccc', fontStyle: 'italic', margin: '0 0 14px' }}>No comments yet. Leave a note below for the Brown Butter team.</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {comments.map(c => (
                    <div key={c.id} style={{
                      background: '#fff', borderRadius: 12, padding: '12px 15px',
                      border: '1px solid #e8e2d8',
                      borderLeft: `3px solid ${c.author_type === 'agency' ? '#C9A96E' : brandColor}`
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#2a1a0a' }}>
                          {c.author_type === 'agency' ? '🧈 ' : ''}{c.author}
                        </span>
                        <span style={{ fontSize: 10, color: '#ccc' }}>{formatDate(c.created_at)}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: '#5a4a3a', lineHeight: 1.55 }}>{c.text}</p>
                    </div>
                  ))}
                </div>
            }
            <input
              value={authorName}
              onChange={e => setAuthorName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #e0d8ce',
                background: '#fff', fontSize: 13, color: '#3a2a1a', marginBottom: 8,
                boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit'
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Leave a note or revision request for Brown Butter..."
                rows={3}
                style={{
                  flex: 1, padding: '11px 14px', borderRadius: 10, border: '1px solid #e0d8ce',
                  background: '#fff', fontSize: 13, color: '#3a2a1a', resize: 'none',
                  outline: 'none', fontFamily: 'Georgia, serif', lineHeight: 1.55
                }}
              />
              <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{
                padding: '11px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: brandColor, color: '#fff',
                fontWeight: 700, fontSize: 12, alignSelf: 'flex-end',
                opacity: saving || !newComment.trim() ? 0.5 : 1, transition: 'opacity 0.2s'
              }}>{saving ? '...' : 'Send'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Client Portal ────────────────────────────────────────────────────────
export default function ClientPortal() {
  const [client, setClient] = useState(null)
  const [posts, setPosts] = useState([])
  const [comments, setComments] = useState([])
  const [selectedPost, setSelectedPost] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Get slug from URL path e.g. /grasshopper
  const slug = window.location.pathname.replace('/', '').split('/')[0] || 'grasshopper'

  const fetchAll = async () => {
    const { data: clientData } = await supabase
      .from('clients').select('*').eq('slug', slug).single()

    if (!clientData) { setNotFound(true); setLoading(false); return }
    setClient(clientData)

    const [{ data: p }, { data: cm }] = await Promise.all([
      supabase.from('posts').select('*').eq('client_id', clientData.id).order('scheduled_at'),
      supabase.from('comments').select('*').order('created_at')
    ])
    if (p) setPosts(p)
    if (cm) setComments(cm)
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
    const postSub = supabase.channel('client-posts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, fetchAll)
      .subscribe()
    const commentSub = supabase.channel('client-comments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, fetchAll)
      .subscribe()
    return () => { postSub.unsubscribe(); commentSub.unsubscribe() }
  }, [])

  const filtered = filter === 'all' ? posts : posts.filter(p => p.status === filter)
  const brandColor = client?.brand_color || '#C9A96E'

  const counts = {
    all: posts.length,
    pending: posts.filter(p => p.status === 'pending').length,
    approved: posts.filter(p => p.status === 'approved').length,
    revision: posts.filter(p => p.status === 'revision').length,
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f8f5f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, color: '#C9A96E', marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontSize: 13, color: '#aaa' }}>Loading your content calendar...</div>
      </div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight: '100vh', background: '#f8f5f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, color: '#C9A96E', marginBottom: 8 }}>Brown Butter</div>
        <div style={{ fontSize: 14, color: '#8a7a6a' }}>Client portal not found. Please check your link.</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8f5f0', fontFamily: "'Calibri', 'Trebuchet MS', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e8e2d8',
        padding: '0 28px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 1px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: `linear-gradient(135deg, ${brandColor}, #2C1A0E)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'Georgia, serif'
          }}>{client.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 16, color: '#2a1a0a' }}>{client.name}</div>
            <div style={{ fontSize: 11, color: '#aaa' }}>Content Review Portal · Powered by Brown Butter</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#8a7a6a' }}>
          <span style={{ background: STATUS.pending.bg, color: STATUS.pending.color, padding: '4px 12px', borderRadius: 20, fontWeight: 700 }}>
            {counts.pending} pending
          </span>
          <span style={{ background: STATUS.approved.bg, color: STATUS.approved.color, padding: '4px 12px', borderRadius: 20, fontWeight: 700 }}>
            {counts.approved} approved
          </span>
        </div>
      </div>

      {/* Welcome Banner */}
      <div style={{
        background: `linear-gradient(135deg, ${brandColor}18, ${brandColor}08)`,
        borderBottom: `1px solid ${brandColor}22`,
        padding: '18px 28px'
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: '#3a2a1a', fontWeight: 600 }}>
            Hi {client.name} 👋 — here's your content for review.
          </div>
          <div style={{ fontSize: 13, color: '#8a7a6a', marginTop: 4 }}>
            Click any post to approve, request changes, or leave a comment. Brown Butter will be notified instantly.
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 24px' }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {[['all', 'All Posts'], ['pending', 'Pending Review'], ['approved', 'Approved'], ['revision', 'Needs Revision']].map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} style={{
              padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
              background: filter === k ? brandColor : '#fff',
              color: filter === k ? '#fff' : '#5a4a3a',
              fontWeight: filter === k ? 700 : 500,
              border: `1px solid ${filter === k ? brandColor : '#e0d8ce'}`,
              transition: 'all 0.2s'
            }}>{label} ({counts[k]})</button>
          ))}
        </div>

        {/* Main layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28 }}>
          <div>
            {filtered.length === 0
              ? <div style={{ background: '#fff', borderRadius: 16, padding: 48, textAlign: 'center', border: '1px solid #e8e2d8' }}>
                  <div style={{ fontSize: 34, marginBottom: 10 }}>📭</div>
                  <div style={{ fontFamily: 'Georgia, serif', color: '#8a7a6a', fontSize: 15 }}>No posts in this category yet.</div>
                </div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
                  {filtered.map(post => (
                    <PostCard
                      key={post.id}
                      post={post}
                      commentCount={comments.filter(c => c.post_id === post.id).length}
                      onClick={() => setSelectedPost(post)}
                      brandColor={brandColor}
                    />
                  ))}
                </div>
            }
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <InstagramGrid posts={posts} brandColor={brandColor} />

            {/* Quick stats */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e8e2d8' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#2a1a0a', marginBottom: 14 }}>Summary</div>
              {Object.entries(STATUS).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.dot }} />
                    <span style={{ fontSize: 13, color: '#5a4a3a' }}>{v.label}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: v.color }}>{counts[k]}</span>
                </div>
              ))}
            </div>

            {/* Brown Butter credit */}
            <div style={{ textAlign: 'center', padding: '14px 0' }}>
              <div style={{ fontSize: 11, color: '#ccc' }}>Powered by</div>
              <div style={{ fontFamily: 'Georgia, serif', fontWeight: 700, color: '#C9A96E', fontSize: 14, marginTop: 3 }}>Brown Butter</div>
              <div style={{ fontSize: 10, color: '#ddd', marginTop: 2 }}>Marketing Consultancy</div>
            </div>
          </div>
        </div>
      </div>

      {selectedPost && (
        <PostModal
          post={posts.find(p => p.id === selectedPost.id) || selectedPost}
          comments={comments.filter(c => c.post_id === selectedPost.id)}
          client={client}
          onClose={() => setSelectedPost(null)}
          onRefresh={fetchAll}
        />
      )}
    </div>
  )
}
