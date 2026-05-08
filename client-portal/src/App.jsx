import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const style = document.createElement('style')
style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=DM+Sans:wght@300;400;500;600;700&display=swap');"
document.head.appendChild(style)

const F = { display: "'Playfair Display', Georgia, serif", body: "'DM Sans', system-ui, sans-serif" }

const fmt = (str) => {
  if (!str) return ''
  const d = new Date(str)
  return d.toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric' }).toUpperCase() + ' · ' + d.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' })
}
const fmtShort = (str) => {
  if (!str) return ''
  return new Date(str).toLocaleDateString('en-PH', { month:'short', day:'numeric' })
}

const STATUS = {
  pending:   { label:'AWAITING YOUR APPROVAL', color:'#A0620A', bg:'#FFF6E6', dot:'#D4860A', border:'#F5C87A' },
  approved:  { label:'APPROVED',               color:'#1E6E3E', bg:'#E8F8EE', dot:'#2A7D4F', border:'#7ECBA1' },
  revision:  { label:'REVISIONS REQUESTED',    color:'#9B2B20', bg:'#FEECEA', dot:'#C0392B', border:'#F4A59F' },
  published: { label:'PUBLISHED',              color:'#444',    bg:'#F2F2F2', dot:'#888',    border:'#CCC'    },
  archived:  { label:'ARCHIVED',               color:'#777',    bg:'#F5F5F5', dot:'#AAA',    border:'#DDD'    },
}

const statusLine = (status) => {
  if (status === 'pending') return 'AWAITING YOUR REVIEW'
  if (status === 'approved') return 'APPROVED — BROWN BUTTER WILL SCHEDULE THIS POST'
  if (status === 'revision') return 'AWAITING REVISED VERSION FROM BROWN BUTTER'
  if (status === 'published') return 'THIS POST HAS BEEN PUBLISHED'
  return ''
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.pending
  return <span style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1, padding:'3px 7px', borderRadius:3, background:s.bg, color:s.color, border:'1px solid '+s.border }}>{s.label}</span>
}

function IGGrid({ posts, brandColor }) {
  const grid = [...posts].filter(p => p.status!=='archived').sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,9)
  while (grid.length<9) grid.push(null)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:3 }}>
      {grid.map((p,i) => (
        <div key={i} style={{ aspectRatio:'1', background:p?(p.image_url?'transparent':'hsl('+(20+i*15)+',18%,'+(88-i*2)+'%)'):'#EEE', position:'relative', overflow:'hidden', borderRadius:2 }}>
          {p?.image_url && <img src={p.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
          {p&&!p.image_url && <div style={{ padding:3, fontSize:6, color:'#888', lineHeight:1.3 }}>{p.caption.slice(0,35)}</div>}
          {p && <div style={{ position:'absolute', top:2, right:2, width:6, height:6, borderRadius:'50%', background:STATUS[p.status]?.dot||'#ccc', border:'1px solid #fff' }} />}
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
  const brandColor = client?.brand_color || '#C9A96E'

  const sendComment = async () => {
    if (!newComment.trim()) return
    setSaving(true)
    await supabase.from('comments').insert({ post_id:post.id, author:authorName.trim()||(client?.name||'Client'), author_type:'client', text:newComment.trim() })
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

  const formatLabel = post.format ? (post.format.charAt(0).toUpperCase()+post.format.slice(1)) + (post.slide_count ? ' · '+post.slide_count+' slides' : '') : 'Post'

  return (
    <div style={{ width:340, background:'#fff', borderLeft:'1px solid #EDE8E0', display:'flex', flexDirection:'column', flexShrink:0, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'14px 18px', borderBottom:'1px solid #EDE8E0', display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0 }}>
        <div>
          <Badge status={post.status} />
          <div style={{ fontFamily:F.display, fontStyle:'italic', fontSize:13, color:'#1A0E00', marginTop:6, lineHeight:1.4 }}>{post.caption.slice(0,60)}{post.caption.length>60?'...':''}</div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#bbb', lineHeight:1, flexShrink:0, marginLeft:8, marginTop:2 }}>x</button>
      </div>

      {/* Asset */}
      <div style={{ flexShrink:0 }}>
        {post.image_url
          ? <img src={post.image_url} alt="" style={{ width:'100%', objectFit:'cover', maxHeight:220 }} />
          : <div style={{ width:'100%', height:120, background:'#F5F0E8', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <span style={{ fontFamily:F.display, color:'#C9A96E', fontSize:16, fontWeight:700, fontStyle:'italic' }}>No image uploaded</span>
            </div>
        }
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #EDE8E0', flexShrink:0 }}>
        {[['details','Details'],['discussion','Discussion'+(comments.length>0?' ('+comments.length+')':'')]].map(([k,l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ flex:1, padding:'10px 0', border:'none', cursor:'pointer', background:'transparent', fontFamily:F.body, fontSize:11, fontWeight:activeTab===k?700:400, color:activeTab===k?'#1A0E00':'#999', borderBottom:activeTab===k?'2px solid '+brandColor:'2px solid transparent', transition:'all 0.15s' }}>{l}</button>
        ))}
      </div>

      <div style={{ flex:1, overflow:'auto', padding:18 }}>

        {activeTab === 'details' && (
          <div>
            {/* Details */}
            <div style={{ marginBottom:20 }}>
              <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1.2, color:'#bbb', marginBottom:12 }}>DETAILS</div>
              {[
                ['PLATFORM', 'Instagram'],
                ['FORMAT', formatLabel],
                post.campaign ? ['CAMPAIGN', post.campaign] : null,
                ['SCHEDULED', fmt(post.scheduled_at)],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display:'grid', gridTemplateColumns:'90px 1fr', gap:8, marginBottom:10, alignItems:'center' }}>
                  <span style={{ fontFamily:F.body, fontSize:10, fontWeight:600, color:'#bbb', letterSpacing:0.8 }}>{label}</span>
                  <span style={{ fontFamily:F.body, fontSize:12, color:'#333' }}>{value}</span>
                </div>
              ))}
            </div>

            {versions.length > 0 && (
              <>
                <div style={{ height:1, background:'#EDE8E0', marginBottom:20 }} />
                <div style={{ marginBottom:20 }}>
                  <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1.2, color:'#bbb', marginBottom:12 }}>VERSION HISTORY</div>
                  {versions.sort((a,b) => b.version_number-a.version_number).map(v => (
                    <div key={v.id} style={{ display:'flex', gap:14, marginBottom:14, paddingBottom:14, borderBottom:'1px dashed #EDE8E0' }}>
                      <div style={{ fontFamily:F.display, fontStyle:'italic', fontWeight:700, fontSize:16, color:'#9B2B20', flexShrink:0, width:28 }}>v{v.version_number}</div>
                      <div>
                        <div style={{ fontFamily:F.body, fontSize:10, color:'#aaa', marginBottom:3 }}>{fmtShort(v.created_at)} · {v.author}</div>
                        <div style={{ fontFamily:F.body, fontSize:12, color:'#333', lineHeight:1.5 }}>{v.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Approve / Reject / Request Revisions */}
            {post.status !== 'archived' && post.status !== 'published' && (
              <>
                <div style={{ height:1, background:'#EDE8E0', marginBottom:16 }} />
                <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                  <button onClick={() => setStatus('revision')} style={{ flex:1, padding:'11px 8px', borderRadius:8, border:'1.5px solid #C0392B', cursor:'pointer', background:'#fff', color:'#9B2B20', fontWeight:700, fontSize:12, fontFamily:F.body, display:'flex', alignItems:'center', justifyContent:'center', gap:5, transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background='#FEECEA' }}
                    onMouseLeave={e => { e.currentTarget.style.background='#fff' }}
                  >
                    x Reject
                  </button>
                  <button onClick={() => setStatus('revision')} style={{ flex:1.4, padding:'11px 8px', borderRadius:8, border:'none', cursor:'pointer', background:'#C0392B', color:'#fff', fontWeight:700, fontSize:12, fontFamily:F.body, transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background='#A93226' }}
                    onMouseLeave={e => { e.currentTarget.style.background='#C0392B' }}
                  >
                    Request revisions
                  </button>
                  <button onClick={() => setStatus('approved')} style={{ flex:1.2, padding:'11px 8px', borderRadius:8, border:'none', cursor:'pointer', background:'#2A7D4F', color:'#fff', fontWeight:700, fontSize:12, fontFamily:F.body, display:'flex', alignItems:'center', justifyContent:'center', gap:5, transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.background='#1E6E3E' }}
                    onMouseLeave={e => { e.currentTarget.style.background='#2A7D4F' }}
                  >
                    + Approve
                  </button>
                </div>
                <div style={{ fontFamily:F.body, fontSize:9, letterSpacing:1, color:'#bbb', textAlign:'center' }}>{statusLine(post.status)}</div>
              </>
            )}

            {(post.status === 'approved' || post.status === 'published') && (
              <div style={{ marginTop:16, padding:'10px 14px', background:'#E8F8EE', borderRadius:8, border:'1px solid #7ECBA1' }}>
                <div style={{ fontFamily:F.body, fontSize:11, fontWeight:700, color:'#1E6E3E', letterSpacing:0.5 }}>{statusLine(post.status)}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'discussion' && (
          <div>
            {comments.length === 0 && <p style={{ fontFamily:F.body, fontSize:12, color:'#ccc', fontStyle:'italic', margin:'0 0 16px' }}>No comments yet. Leave a note for the Brown Butter team.</p>}
            {comments.map(c => (
              <div key={c.id} style={{ marginBottom:16, paddingBottom:16, borderBottom:'1px dashed #EDE8E0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <span style={{ fontFamily:F.body, fontSize:12, fontWeight:700, color:'#1A0E00' }}>
                    {c.author_type==='agency' ? 'Brown Butter' : c.author + (client?' ('+client.name+')':'')}
                  </span>
                  <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>{fmtShort(c.created_at)}</span>
                </div>
                <p style={{ margin:0, fontFamily:F.body, fontSize:13, color:'#444', lineHeight:1.6 }}>{c.text}</p>
              </div>
            ))}
            <input value={authorName} onChange={e => setAuthorName(e.target.value)} placeholder="Your name (optional)" style={{ width:'100%', padding:'8px 10px', borderRadius:7, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:12, color:'#333', marginBottom:8, boxSizing:'border-box', outline:'none', fontFamily:F.body }} />
            <div style={{ background:'#FAFAF8', border:'1px solid #EDE8E0', borderRadius:8, padding:'10px 12px' }}>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={handleKeyDown} placeholder="Leave a note for the team..." rows={3} style={{ width:'100%', border:'none', background:'transparent', fontSize:13, color:'#333', resize:'none', outline:'none', fontFamily:F.body, lineHeight:1.6, boxSizing:'border-box' }} />
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                <span style={{ fontFamily:'monospace', fontSize:10, color:'#ccc' }}>Cmd + Enter to send</span>
                <button onClick={sendComment} disabled={saving||!newComment.trim()} style={{ padding:'7px 16px', borderRadius:6, border:'1px solid #E0D8CE', background:'#fff', cursor:'pointer', fontFamily:F.body, fontSize:12, fontWeight:600, color:'#555', opacity:saving||!newComment.trim()?0.5:1 }}>Post comment</button>
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

  const slug = window.location.pathname.replace('/','').split('/')[0] || ''

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
    const s1 = supabase.channel('cp-posts').on('postgres_changes',{event:'*',schema:'public',table:'posts'},fetchAll).subscribe()
    const s2 = supabase.channel('cp-comments').on('postgres_changes',{event:'*',schema:'public',table:'comments'},fetchAll).subscribe()
    return () => { s1.unsubscribe(); s2.unsubscribe() }
  }, [])

  if (loading) return (
    <div style={{ minHeight:'100vh', background:'#F5F2ED', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:F.display, fontSize:20, color:'#C9A96E', marginBottom:8 }}>Brown Butter</div>
        <div style={{ fontFamily:F.body, fontSize:13, color:'#aaa' }}>Loading your content...</div>
      </div>
    </div>
  )

  if (notFound) return (
    <div style={{ minHeight:'100vh', background:'#F5F2ED', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:F.display, fontSize:20, color:'#C9A96E', marginBottom:8 }}>Brown Butter</div>
        <div style={{ fontFamily:F.body, fontSize:14, color:'#999' }}>Portal not found. Please check your link.</div>
      </div>
    </div>
  )

  const brandColor = client?.brand_color || '#C9A96E'
  const activePosts = posts.filter(p => p.status !== 'archived')
  const filteredPosts = filter==='all' ? activePosts : activePosts.filter(p => p.status===filter)

  const counts = {
    all: activePosts.length,
    pending: activePosts.filter(p => p.status==='pending').length,
    approved: activePosts.filter(p => p.status==='approved').length,
    revision: activePosts.filter(p => p.status==='revision').length,
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F5F2ED', fontFamily:F.body, display:'flex', flexDirection:'column' }}>
      <div style={{ background:'#fff', borderBottom:'1px solid #EDE8E0', padding:'0 24px', height:54, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:brandColor, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:11, fontFamily:F.body }}>
            {client.name.slice(0,2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontFamily:F.display, fontWeight:700, fontSize:15, color:'#1A0E00' }}>{client.name}</div>
            <div style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>Content Review · Managed by Brown Butter</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {counts.pending>0 && <span style={{ fontFamily:F.body, background:'#FFF6E6', color:'#A0620A', padding:'4px 12px', borderRadius:20, fontWeight:700, fontSize:10, letterSpacing:0.5 }}>{counts.pending} AWAITING APPROVAL</span>}
          {counts.revision>0 && <span style={{ fontFamily:F.body, background:'#FEECEA', color:'#9B2B20', padding:'4px 12px', borderRadius:20, fontWeight:700, fontSize:10, letterSpacing:0.5 }}>{counts.revision} NEEDS CHANGES</span>}
        </div>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* Sidebar */}
        <div style={{ width:200, background:'#FAFAF8', borderRight:'1px solid #EDE8E0', display:'flex', flexDirection:'column', flexShrink:0 }}>
          <div style={{ padding:'18px 14px' }}>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#C9A96E', letterSpacing:1.2, marginBottom:10 }}>FILTER</div>
            {[['all','All Posts',counts.all],['pending','Awaiting Approval',counts.pending],['approved','Approved',counts.approved],['revision','Needs Changes',counts.revision]].map(([k,l,n]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:6, border:'none', cursor:'pointer', background:filter===k?'#F0EBE0':'transparent', color:filter===k?'#1A0E00':'#666', fontWeight:filter===k?700:400, fontSize:12, fontFamily:F.body, marginBottom:2, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                {l}
                {n>0 && <span style={{ fontSize:10, fontWeight:700, color:filter===k?brandColor:'#ccc' }}>{n}</span>}
              </button>
            ))}
          </div>
          <div style={{ height:1, background:'#EDE8E0', margin:'0 14px' }} />
          <div style={{ margin:'16px 14px 0', borderRadius:8, overflow:'hidden', border:'1px solid #EDE8E0' }}>
            <div style={{ padding:'7px 10px', background:'#F0EBE0', fontFamily:F.body, fontSize:9, fontWeight:700, color:'#999', letterSpacing:0.8 }}>FEED PREVIEW</div>
            <IGGrid posts={posts} brandColor={brandColor} />
          </div>
          <div style={{ padding:'16px 14px', marginTop:'auto' }}>
            <div style={{ fontFamily:F.body, fontSize:10, color:'#ccc', marginBottom:4 }}>Managed by</div>
            <div style={{ fontFamily:F.display, fontWeight:700, color:'#C9A96E', fontSize:14 }}>Brown Butter</div>
          </div>
        </div>

        {/* Center */}
        <div style={{ flex:1, overflow:'auto', minWidth:0 }}>
          <div style={{ padding:'18px 24px 12px', borderBottom:'1px solid #EDE8E0', background:'#FAFAF8' }}>
            <div style={{ fontFamily:F.display, fontStyle:'italic', fontWeight:700, fontSize:22, color:'#1A0E00' }}>
              {filter==='all'?'Your Content':filter==='pending'?'Awaiting Your Approval':filter==='approved'?'Approved Posts':'Needs Changes'}
            </div>
            <div style={{ fontFamily:F.body, fontSize:12, color:'#999', marginTop:4 }}>
              {filteredPosts.length} post{filteredPosts.length!==1?'s':''} · Click any post to review
            </div>
          </div>

          {filteredPosts.length===0
            ? <div style={{ padding:60, textAlign:'center' }}>
                <div style={{ fontFamily:F.display, color:'#bbb', fontSize:16, fontStyle:'italic' }}>No posts in this category</div>
              </div>
            : filteredPosts.map(post => {
                const postComments = comments.filter(c => c.post_id===post.id)
                const isSelected = selectedPost?.id===post.id
                const formatLabel = post.format ? post.format.charAt(0).toUpperCase()+post.format.slice(1) : 'Post'
                return (
                  <div key={post.id} onClick={() => setSelectedPost(post)} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 20px', borderBottom:'1px solid #EDE8E0', cursor:'pointer', background:isSelected?'#FDF8F0':'#fff', transition:'background 0.1s', borderLeft:isSelected?'3px solid '+brandColor:'3px solid transparent' }}
                    onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background='#FAFAF8' }}
                    onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background='#fff' }}
                  >
                    <div style={{ width:50, height:50, borderRadius:6, overflow:'hidden', flexShrink:0, background:'#F0EBE0' }}>
                      {post.image_url?<img src={post.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />:<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', fontFamily:F.display, color:'#C9A96E', fontSize:13, fontStyle:'italic' }}>BB</div>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                        <Badge status={post.status} />
                        <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>{formatLabel}</span>
                        {post.campaign && <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>· {post.campaign}</span>}
                      </div>
                      <p style={{ margin:0, fontFamily:F.body, fontSize:13, color:'#1A0E00', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{post.caption}</p>
                      <div style={{ marginTop:5, display:'flex', gap:12 }}>
                        <span style={{ fontFamily:F.body, fontSize:10, color:'#aaa' }}>{fmt(post.scheduled_at)}</span>
                        {postComments.length>0 && <span style={{ fontFamily:F.body, fontSize:10, color:brandColor, fontWeight:600 }}>{postComments.length} comment{postComments.length!==1?'s':''}</span>}
                      </div>
                    </div>
                    {post.image_url && <img src={post.image_url} alt="" style={{ width:40, height:40, borderRadius:4, objectFit:'cover', flexShrink:0, opacity:0.7 }} />}
                  </div>
                )
              })
          }
        </div>

        {/* Right Panel */}
        {selectedPost && (
          <RightPanel
            post={posts.find(p => p.id===selectedPost.id)||selectedPost}
            comments={comments.filter(c => c.post_id===selectedPost.id)}
            versions={versions.filter(v => v.post_id===selectedPost.id)}
            client={client}
            onClose={() => setSelectedPost(null)}
            onRefresh={fetchAll}
          />
        )}
      </div>
    </div>
  )
}
