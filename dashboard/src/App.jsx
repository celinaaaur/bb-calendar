import { useState, useEffect, useRef } from 'react'
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
const fmtTime = (str) => {
  if (!str) return ''
  return new Date(str).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' })
}

const STATUS = {
  pending:   { label: 'AWAITING APPROVAL',   color: '#A0620A', bg: '#FFF6E6', dot: '#D4860A', border: '#F5C87A' },
  approved:  { label: 'APPROVED',            color: '#1E6E3E', bg: '#E8F8EE', dot: '#2A7D4F', border: '#7ECBA1' },
  revision:  { label: 'REVISIONS REQUESTED', color: '#9B2B20', bg: '#FEECEA', dot: '#C0392B', border: '#F4A59F' },
  published: { label: 'PUBLISHED',           color: '#444',    bg: '#F2F2F2', dot: '#888',    border: '#CCC'    },
  archived:  { label: 'ARCHIVED',            color: '#777',    bg: '#F5F5F5', dot: '#AAA',    border: '#DDD'    },
}

const FORMATS = ['post', 'carousel', 'reel', 'story']

const statusLine = (status) => {
  if (status === 'pending') return 'AWAITING CLIENT APPROVAL'
  if (status === 'approved') return 'APPROVED — READY TO SCHEDULE'
  if (status === 'revision') return 'AWAITING REVISED VERSION FROM BROWN BUTTER'
  if (status === 'published') return 'PUBLISHED'
  if (status === 'archived') return 'ARCHIVED'
  return ''
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.pending
  return <span style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1, padding:'3px 7px', borderRadius:3, background:s.bg, color:s.color, border:'1px solid '+s.border }}>{s.label}</span>
}

function Avatar({ name, size }) {
  const sz = size || 24
  const colors = ['#2A7D4F','#B07D2A','#B03A2E','#2471A3','#6C3483','#117A65']
  const color = colors[name ? name.charCodeAt(0) % colors.length : 0]
  const initials = name ? name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?'
  return (
    <div style={{ width:sz, height:sz, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:sz*0.38, fontWeight:700, fontFamily:F.body, flexShrink:0 }}>{initials}</div>
  )
}

function IGGrid({ posts }) {
  const grid = [...posts].filter(p => p.status !== 'archived').sort((a,b) => new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,9)
  while (grid.length < 9) grid.push(null)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:2 }}>
      {grid.map((p,i) => (
        <div key={i} style={{ aspectRatio:'1', background: p?(p.image_url?'transparent':'hsl('+(20+i*15)+',18%,'+(88-i*2)+'%)'):'#EEE', position:'relative', overflow:'hidden' }}>
          {p?.image_url && <img src={p.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
          {p && !p.image_url && <div style={{ padding:3, fontSize:6, color:'#888', lineHeight:1.3 }}>{p.caption.slice(0,35)}</div>}
          {p && <div style={{ position:'absolute', top:2, right:2, width:6, height:6, borderRadius:'50%', background:STATUS[p.status]?.dot||'#ccc', border:'1px solid #fff' }} />}
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
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return (
    <div style={{ padding:'20px 24px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:20 }}>
        <button onClick={() => { if(month===0){setMonth(11);setYear(year-1)}else setMonth(month-1) }} style={{ background:'none', border:'1px solid #E0D8CE', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontFamily:F.body, fontSize:13, color:'#555' }}>Prev</button>
        <span style={{ fontFamily:F.display, fontWeight:700, fontSize:18, color:'#1A0E00', flex:1, textAlign:'center' }}>{MONTHS[month]} {year}</span>
        <button onClick={() => { if(month===11){setMonth(0);setYear(year+1)}else setMonth(month+1) }} style={{ background:'none', border:'1px solid #E0D8CE', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontFamily:F.body, fontSize:13, color:'#555' }}>Next</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1, background:'#E0D8CE' }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} style={{ background:'#F5F0E8', padding:'7px 4px', textAlign:'center', fontFamily:F.body, fontSize:10, fontWeight:700, color:'#999', letterSpacing:0.8 }}>{d}</div>)}
        {cells.map((day,i) => {
          const dayPosts = day ? posts.filter(p => { const d=new Date(p.scheduled_at); return d.getFullYear()===year && d.getMonth()===month && d.getDate()===day }) : []
          const isToday = day && now.getFullYear()===year && now.getMonth()===month && now.getDate()===day
          return (
            <div key={i} style={{ background:'#fff', minHeight:80, padding:5, borderTop: isToday?'2px solid #C9A96E':'none' }}>
              {day && <div style={{ fontFamily:F.body, fontSize:11, fontWeight:isToday?700:400, color:isToday?'#C9A96E':'#888', marginBottom:3 }}>{day}</div>}
              {dayPosts.map(p => (
                <div key={p.id} onClick={() => onSelect(p)} style={{ background:STATUS[p.status]?.bg||'#F5F0E8', borderLeft:'2px solid '+(STATUS[p.status]?.dot||'#ccc'), padding:'2px 4px', marginBottom:2, borderRadius:2, cursor:'pointer', fontFamily:F.body, fontSize:9, color:'#333', lineHeight:1.4 }}>
                  {fmtTime(p.scheduled_at)} — {p.caption.slice(0,18)}...
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RightPanel({ post, comments, versions, clients, onRefresh, onClose }) {
  const [newComment, setNewComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const client = clients.find(c => c.id === post.client_id)

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

  const deletePost = async () => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    await supabase.from('posts').delete().eq('id', post.id)
    onRefresh()
    onClose()
  }

  const archivePost = async () => {
    await supabase.from('posts').update({ status: 'archived' }).eq('id', post.id)
    onRefresh()
    onClose()
  }

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendComment()
  }

  const formatLabel = post.format ? (post.format.charAt(0).toUpperCase() + post.format.slice(1)) + (post.slide_count ? ' · ' + post.slide_count + ' slides' : '') : 'Post'

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
          ? <img src={post.image_url} alt="" style={{ width:'100%', objectFit:'cover', maxHeight:200 }} />
          : <div style={{ width:'100%', height:120, background:'#F5F0E8', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <span style={{ fontFamily:F.display, color:'#C9A96E', fontSize:18, fontWeight:700, fontStyle:'italic' }}>BB</span>
            </div>
        }
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #EDE8E0', flexShrink:0 }}>
        {[['details','Details'],['discussion','Discussion '+(comments.length>0?'('+comments.length+')':'')]].map(([k,l]) => (
          <button key={k} onClick={() => setActiveTab(k)} style={{ flex:1, padding:'10px 0', border:'none', cursor:'pointer', background:'transparent', fontFamily:F.body, fontSize:11, fontWeight:activeTab===k?700:400, color:activeTab===k?'#1A0E00':'#999', borderBottom: activeTab===k?'2px solid #C9A96E':'2px solid transparent', transition:'all 0.15s' }}>{l}</button>
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
                post.designer ? ['DESIGNER', post.designer] : null,
                post.campaign ? ['CAMPAIGN', post.campaign] : null,
                ['SCHEDULED', fmt(post.scheduled_at)],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display:'grid', gridTemplateColumns:'90px 1fr', gap:8, marginBottom:10, alignItems:'center' }}>
                  <span style={{ fontFamily:F.body, fontSize:10, fontWeight:600, color:'#bbb', letterSpacing:0.8 }}>{label}</span>
                  <span style={{ fontFamily:F.body, fontSize:12, color:'#333' }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ height:1, background:'#EDE8E0', marginBottom:20 }} />

            {/* Version History */}
            {versions.length > 0 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1.2, color:'#bbb', marginBottom:12 }}>VERSION HISTORY</div>
                {versions.sort((a,b) => b.version_number - a.version_number).map(v => (
                  <div key={v.id} style={{ display:'flex', gap:14, marginBottom:14, paddingBottom:14, borderBottom:'1px dashed #EDE8E0' }}>
                    <div style={{ fontFamily:F.display, fontStyle:'italic', fontWeight:700, fontSize:16, color:'#9B2B20', flexShrink:0, width:28 }}>v{v.version_number}</div>
                    <div>
                      <div style={{ fontFamily:F.body, fontSize:10, color:'#aaa', marginBottom:3 }}>{fmtShort(v.created_at)} · {v.author}</div>
                      <div style={{ fontFamily:F.body, fontSize:12, color:'#333', lineHeight:1.5 }}>{v.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ height:1, background:'#EDE8E0', marginBottom:20 }} />

            {/* Status actions */}
            {post.status !== 'archived' && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, letterSpacing:1.2, color:'#bbb', marginBottom:10 }}>UPDATE STATUS</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:14 }}>
                  {['pending','approved','revision','published'].map(k => {
                    const v = STATUS[k]
                    return (
                      <button key={k} onClick={() => updateStatus(k)} style={{ padding:'8px 12px', borderRadius:7, border:'1.5px solid '+(post.status===k?v.dot:'#EDE8E0'), cursor:'pointer', background:post.status===k?v.bg:'#fff', color:post.status===k?v.color:'#888', fontWeight:post.status===k?700:400, fontSize:11, fontFamily:F.body, textAlign:'left', transition:'all 0.15s' }}>
                        {k.charAt(0).toUpperCase()+k.slice(1).replace('revision','Revisions requested').replace('published','Mark as published').replace('pending','Reset to pending').replace('approved','Mark as approved')}
                      </button>
                    )
                  })}
                </div>
                <div style={{ fontFamily:F.body, fontSize:9, letterSpacing:1, color:'#bbb', textAlign:'center' }}>{statusLine(post.status)}</div>
              </div>
            )}

            {/* Archive / Delete */}
            <div style={{ display:'flex', gap:8 }}>
              {post.status !== 'archived' && (
                <button onClick={archivePost} style={{ flex:1, padding:'8px 0', borderRadius:7, border:'1px solid #E0D8CE', background:'#fff', cursor:'pointer', fontFamily:F.body, fontSize:11, fontWeight:600, color:'#888' }}>Archive</button>
              )}
              <button onClick={deletePost} style={{ flex:1, padding:'8px 0', borderRadius:7, border:'none', background:'#FEECEA', cursor:'pointer', fontFamily:F.body, fontSize:11, fontWeight:700, color:'#9B2B20' }}>Delete Post</button>
            </div>
          </div>
        )}

        {activeTab === 'discussion' && (
          <div>
            {comments.length === 0 && <p style={{ fontFamily:F.body, fontSize:12, color:'#ccc', fontStyle:'italic', margin:'0 0 16px' }}>No comments yet.</p>}
            {comments.map(c => (
              <div key={c.id} style={{ marginBottom:16, paddingBottom:16, borderBottom:'1px dashed #EDE8E0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <span style={{ fontFamily:F.body, fontSize:12, fontWeight:700, color:'#1A0E00' }}>{c.author}{c.author_type==='client' && client ? ' ('+client.name+')' : ''}</span>
                  <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>{fmtShort(c.created_at)}</span>
                </div>
                <p style={{ margin:0, fontFamily:F.body, fontSize:13, color:'#444', lineHeight:1.6 }}>{c.text}</p>
              </div>
            ))}
            <div style={{ background:'#FAFAF8', border:'1px solid #EDE8E0', borderRadius:8, padding:'10px 12px', marginTop:8 }}>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={handleKeyDown} placeholder="Leave a note for the team..." rows={3} style={{ width:'100%', border:'none', background:'transparent', fontSize:13, color:'#333', resize:'none', outline:'none', fontFamily:F.body, lineHeight:1.6, boxSizing:'border-box' }} />
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                <span style={{ fontFamily:'monospace', fontSize:10, color:'#ccc' }}>Cmd + Enter to send</span>
                <button onClick={sendComment} disabled={saving || !newComment.trim()} style={{ padding:'7px 16px', borderRadius:6, border:'1px solid #E0D8CE', background:'#fff', cursor:'pointer', fontFamily:F.body, fontSize:12, fontWeight:600, color:'#555', opacity: saving||!newComment.trim()?0.5:1 }}>Post comment</button>
              </div>
            </div>
          </div>
        )}
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
      reader.onload = ev => setImageUrl(ev.target.result)
      reader.readAsDataURL(file)
    }
    setUploading(false)
  }

  const handleSave = async () => {
    if (!caption.trim() || !scheduledAt || !clientId) return
    setSaving(true)
    await supabase.from('posts').insert({
      client_id: clientId, caption: caption.trim(),
      scheduled_at: new Date(scheduledAt).toISOString(),
      image_url: imageUrl, platform: 'instagram', status: 'pending',
      format, slide_count: format==='carousel'&&slideCount ? parseInt(slideCount) : null,
      designer: designer||null, campaign: campaign||null
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:520, maxHeight:'92vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding:'16px 22px', borderBottom:'1px solid #EDE8E0', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#1A0E00', borderRadius:'14px 14px 0 0' }}>
          <span style={{ fontFamily:F.display, color:'#C9A96E', fontWeight:700, fontSize:16 }}>New Post</span>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#C9A96E', fontSize:20, lineHeight:1 }}>x</button>
        </div>
        <div style={{ padding:22, display:'flex', flexDirection:'column', gap:14 }}>

          <div>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>CLIENT</div>
            <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', outline:'none', fontFamily:F.body }}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>FORMAT</div>
              <select value={format} onChange={e => setFormat(e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', outline:'none', fontFamily:F.body }}>
                {FORMATS.map(f => <option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
              </select>
            </div>
            {format==='carousel' && (
              <div>
                <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>SLIDES</div>
                <input type="number" min="2" max="20" value={slideCount} onChange={e => setSlideCount(e.target.value)} placeholder="e.g. 4" style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', outline:'none', fontFamily:F.body, boxSizing:'border-box' }} />
              </div>
            )}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>DESIGNER (optional)</div>
              <input value={designer} onChange={e => setDesigner(e.target.value)} placeholder="e.g. Jonas T." style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', outline:'none', fontFamily:F.body, boxSizing:'border-box' }} />
            </div>
            <div>
              <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>CAMPAIGN (optional)</div>
              <input value={campaign} onChange={e => setCampaign(e.target.value)} placeholder="e.g. Summer Menu" style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', outline:'none', fontFamily:F.body, boxSizing:'border-box' }} />
            </div>
          </div>

          <div>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>ASSET {uploading && <span style={{ color:'#C9A96E', fontWeight:400 }}>Uploading...</span>}</div>
            {imageUrl
              ? <div style={{ position:'relative' }}>
                  <img src={imageUrl} alt="" style={{ width:'100%', borderRadius:8, maxHeight:180, objectFit:'cover' }} />
                  <button onClick={() => setImageUrl(null)} style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.6)', border:'none', borderRadius:'50%', width:24, height:24, cursor:'pointer', color:'#fff', fontSize:13 }}>x</button>
                </div>
              : <div onClick={() => fileRef.current.click()} style={{ border:'2px dashed #D4C9B8', borderRadius:8, padding:'18px 0', textAlign:'center', cursor:'pointer', background:'#FAFAF8' }}>
                  <div style={{ fontFamily:F.body, fontSize:22, color:'#C9A96E', marginBottom:4 }}>+</div>
                  <div style={{ fontFamily:F.body, fontSize:12, color:'#aaa' }}>Click to upload image</div>
                </div>
            }
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display:'none' }} />
          </div>

          <div>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>CAPTION</div>
            <textarea value={caption} onChange={e => setCaption(e.target.value)} placeholder="Write your caption..." rows={4} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', resize:'none', outline:'none', fontFamily:F.body, lineHeight:1.6, boxSizing:'border-box' }} />
            <div style={{ fontFamily:F.body, fontSize:10, color:caption.length>2200?'#C0392B':'#ccc', textAlign:'right', marginTop:2 }}>{caption.length} / 2,200</div>
          </div>

          <div>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#bbb', letterSpacing:1.2, marginBottom:7 }}>SCHEDULE DATE AND TIME</div>
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid #E0D8CE', background:'#FAFAF8', fontSize:13, color:'#1A0E00', boxSizing:'border-box', outline:'none', fontFamily:F.body }} />
          </div>

          <button onClick={handleSave} disabled={saving || !caption.trim() || !scheduledAt} style={{ padding:'11px 0', borderRadius:8, border:'none', cursor:caption.trim()&&scheduledAt?'pointer':'not-allowed', background:caption.trim()&&scheduledAt?'#1A0E00':'#E0D8CE', color:caption.trim()&&scheduledAt?'#C9A96E':'#aaa', fontWeight:700, fontSize:13, fontFamily:F.body }}>
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
  const [versions, setVersions] = useState([])
  const [selectedClient, setSelectedClient] = useState('all')
  const [filter, setFilter] = useState('active')
  const [view, setView] = useState('queue')
  const [selectedPost, setSelectedPost] = useState(null)
  const [composing, setComposing] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchAll = async () => {
    const [c, p, cm, v] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('posts').select('*').order('scheduled_at'),
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
    const s1 = supabase.channel('dash-posts').on('postgres_changes',{event:'*',schema:'public',table:'posts'},fetchAll).subscribe()
    const s2 = supabase.channel('dash-comments').on('postgres_changes',{event:'*',schema:'public',table:'comments'},fetchAll).subscribe()
    const s3 = supabase.channel('dash-versions').on('postgres_changes',{event:'*',schema:'public',table:'versions'},fetchAll).subscribe()
    return () => { s1.unsubscribe(); s2.unsubscribe(); s3.unsubscribe() }
  }, [])

  const activePosts = posts.filter(p => p.status !== 'archived')
  const archivedPosts = posts.filter(p => p.status === 'archived')
  const base = filter === 'archived' ? archivedPosts : activePosts
  const clientFiltered = base.filter(p => selectedClient === 'all' || p.client_id === selectedClient)
  const filteredPosts = filter === 'archived' || filter === 'active' ? clientFiltered : clientFiltered.filter(p => p.status === filter)

  const counts = {
    active: activePosts.filter(p => selectedClient==='all'||p.client_id===selectedClient).length,
    pending: activePosts.filter(p => p.status==='pending'&&(selectedClient==='all'||p.client_id===selectedClient)).length,
    approved: activePosts.filter(p => p.status==='approved'&&(selectedClient==='all'||p.client_id===selectedClient)).length,
    revision: activePosts.filter(p => p.status==='revision'&&(selectedClient==='all'||p.client_id===selectedClient)).length,
    published: activePosts.filter(p => p.status==='published'&&(selectedClient==='all'||p.client_id===selectedClient)).length,
    archived: archivedPosts.filter(p => selectedClient==='all'||p.client_id===selectedClient).length,
  }

  return (
    <div style={{ minHeight:'100vh', background:'#F5F2ED', fontFamily:F.body, display:'flex', flexDirection:'column' }}>
      <div style={{ background:'#1A0E00', height:52, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 22px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:F.display, fontWeight:700, color:'#C9A96E', fontSize:16 }}>Brown Butter</span>
          <span style={{ color:'#5a3a22', fontSize:11 }}>|</span>
          <span style={{ fontFamily:F.body, fontSize:10, color:'#7a5a3a', letterSpacing:1.2 }}>CONTENT CALENDAR</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {counts.pending > 0 && <span style={{ fontFamily:F.body, fontSize:11, color:'#8a6a4a' }}>{counts.pending} awaiting approval</span>}
          <button onClick={() => setComposing(true)} style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', background:'#C9A96E', color:'#1A0E00', fontWeight:700, fontSize:11, fontFamily:F.body }}>+ New Post</button>
        </div>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
        {/* Sidebar */}
        <div style={{ width:210, background:'#FAFAF8', borderRight:'1px solid #EDE8E0', display:'flex', flexDirection:'column', flexShrink:0, overflow:'auto' }}>
          <div style={{ padding:'16px 14px 8px' }}>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#C9A96E', letterSpacing:1.2, marginBottom:8 }}>CLIENTS</div>
            {[{id:'all',name:'All Clients',brand_color:'#C9A96E'}, ...clients].map(c => (
              <button key={c.id} onClick={() => setSelectedClient(c.id)} style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:6, border:'none', cursor:'pointer', background:selectedClient===c.id?'#F0EBE0':'transparent', color:selectedClient===c.id?'#1A0E00':'#666', fontWeight:selectedClient===c.id?700:400, fontSize:12, fontFamily:F.body, marginBottom:1, display:'flex', alignItems:'center', gap:7 }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:c.brand_color||'#C9A96E', flexShrink:0 }} />
                {c.name}
              </button>
            ))}
          </div>
          <div style={{ height:1, background:'#EDE8E0', margin:'8px 14px' }} />
          <div style={{ padding:'8px 14px' }}>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#C9A96E', letterSpacing:1.2, marginBottom:8 }}>VIEW</div>
            {[['queue','Queue'],['grid','Grid Preview'],['calendar','Calendar']].map(([k,l]) => (
              <button key={k} onClick={() => setView(k)} style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:6, border:'none', cursor:'pointer', background:view===k?'#F0EBE0':'transparent', color:view===k?'#1A0E00':'#666', fontWeight:view===k?700:400, fontSize:12, fontFamily:F.body, marginBottom:1 }}>{l}</button>
            ))}
          </div>
          <div style={{ height:1, background:'#EDE8E0', margin:'8px 14px' }} />
          <div style={{ padding:'8px 14px' }}>
            <div style={{ fontFamily:F.body, fontSize:9, fontWeight:700, color:'#C9A96E', letterSpacing:1.2, marginBottom:8 }}>FILTER</div>
            {[['active','Everything',counts.active,'#C9A96E'],['pending','Awaiting approval',counts.pending,'#D4860A'],['revision','Revisions requested',counts.revision,'#C0392B'],['approved','Approved',counts.approved,'#2A7D4F'],['published','Published',counts.published,'#888'],['archived','Archived',counts.archived,'#bbb']].map(([k,l,n,dot]) => (
              <button key={k} onClick={() => setFilter(k)} style={{ width:'100%', textAlign:'left', padding:'7px 9px', borderRadius:6, border:'none', cursor:'pointer', background:filter===k?'#F0EBE0':'transparent', color:filter===k?'#1A0E00':'#666', fontWeight:filter===k?700:400, fontSize:12, fontFamily:F.body, marginBottom:1, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  {k!=='active' && <div style={{ width:6, height:6, borderRadius:'50%', background:dot }} />}
                  {l}
                </div>
                {n>0 && <span style={{ fontSize:10, fontWeight:700, color:filter===k?'#C9A96E':'#ccc' }}>{n}</span>}
              </button>
            ))}
          </div>
          <div style={{ margin:'12px 14px 0', borderRadius:8, overflow:'hidden', border:'1px solid #EDE8E0' }}>
            <div style={{ padding:'7px 10px', background:'#F0EBE0', fontFamily:F.body, fontSize:9, fontWeight:700, color:'#999', letterSpacing:0.8 }}>IG GRID PREVIEW</div>
            <IGGrid posts={selectedClient==='all'?posts:posts.filter(p=>p.client_id===selectedClient)} />
          </div>
        </div>

        {/* Center */}
        <div style={{ flex:1, overflow:'auto', minWidth:0 }}>
          <div style={{ padding:'18px 24px 12px', borderBottom:'1px solid #EDE8E0', background:'#FAFAF8' }}>
            <div style={{ fontFamily:F.display, fontStyle:'italic', fontWeight:700, fontSize:24, color:'#1A0E00' }}>
              {filter==='active'?"Today's pass":filter==='archived'?'Archived':filter==='pending'?'Awaiting Approval':filter==='revision'?'Revisions Requested':filter==='approved'?'Approved':'Published'}
            </div>
            <div style={{ fontFamily:F.body, fontSize:12, color:'#999', marginTop:4 }}>
              {(counts[filter]||0)} post{(counts[filter]||0)!==1?'s':''} · {selectedClient==='all'?'All clients':clients.find(c=>c.id===selectedClient)?.name}
            </div>
          </div>

          {loading
            ? <div style={{ padding:48, textAlign:'center', fontFamily:F.body, color:'#aaa' }}>Loading...</div>
            : view==='calendar'
              ? <CalendarView posts={filteredPosts} onSelect={setSelectedPost} />
              : filteredPosts.length===0
                ? <div style={{ padding:60, textAlign:'center' }}>
                    <div style={{ fontFamily:F.display, color:'#bbb', fontSize:16, fontStyle:'italic', marginBottom:16 }}>No posts here yet</div>
                    <button onClick={() => setComposing(true)} style={{ padding:'9px 20px', borderRadius:7, border:'none', cursor:'pointer', background:'#1A0E00', color:'#C9A96E', fontWeight:700, fontSize:12, fontFamily:F.body }}>Create First Post</button>
                  </div>
                : view==='grid'
                  ? <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:12, padding:20 }}>
                      {filteredPosts.map(post => (
                        <div key={post.id} onClick={() => setSelectedPost(post)} style={{ background:'#fff', borderRadius:8, overflow:'hidden', border:'1.5px solid '+(selectedPost?.id===post.id?'#C9A96E':'#EDE8E0'), cursor:'pointer', transition:'all 0.15s' }}
                          onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 18px rgba(0,0,0,0.08)' }}
                          onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='none' }}
                        >
                          <div style={{ height:120, background:post.image_url?'transparent':'#F5F0E8', overflow:'hidden' }}>
                            {post.image_url?<img src={post.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />:<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', fontFamily:F.display, color:'#C9A96E', fontSize:16, fontWeight:700, fontStyle:'italic' }}>BB</div>}
                          </div>
                          <div style={{ padding:'10px 12px' }}>
                            <Badge status={post.status} />
                            <p style={{ margin:'6px 0 4px', fontFamily:F.body, fontSize:11, color:'#333', lineHeight:1.4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{post.caption}</p>
                            <div style={{ fontFamily:F.body, fontSize:10, color:'#aaa' }}>{fmtShort(post.scheduled_at)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  : <div>
                      {filteredPosts.map(post => {
                        const postComments = comments.filter(c => c.post_id===post.id)
                        const isSelected = selectedPost?.id===post.id
                        const client = clients.find(c => c.id===post.client_id)
                        const formatLabel = post.format ? post.format.charAt(0).toUpperCase()+post.format.slice(1) : 'Post'
                        return (
                          <div key={post.id} onClick={() => setSelectedPost(post)} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 20px', borderBottom:'1px solid #EDE8E0', cursor:'pointer', background:isSelected?'#FDF8F0':'#fff', transition:'background 0.1s', borderLeft:isSelected?'3px solid #C9A96E':'3px solid transparent' }}
                            onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background='#FAFAF8' }}
                            onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background='#fff' }}
                          >
                            <div style={{ width:50, height:50, borderRadius:6, overflow:'hidden', flexShrink:0, background:'#F0EBE0' }}>
                              {post.image_url?<img src={post.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />:<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', fontFamily:F.display, color:'#C9A96E', fontSize:14, fontStyle:'italic' }}>BB</div>}
                            </div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5, flexWrap:'wrap' }}>
                                <Badge status={post.status} />
                                <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>{formatLabel}</span>
                                {client && selectedClient==='all' && <span style={{ fontFamily:F.body, fontSize:10, color:'#bbb' }}>· {client.name}</span>}
                              </div>
                              <p style={{ margin:0, fontFamily:F.body, fontSize:13, color:'#1A0E00', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{post.caption}</p>
                              <div style={{ marginTop:5, display:'flex', gap:12 }}>
                                <span style={{ fontFamily:F.body, fontSize:10, color:'#aaa' }}>{fmt(post.scheduled_at)}</span>
                                {postComments.length>0 && <span style={{ fontFamily:F.body, fontSize:10, color:'#C9A96E', fontWeight:600 }}>{postComments.length} comment{postComments.length!==1?'s':''}</span>}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
          }
        </div>

        {/* Right Panel */}
        {selectedPost && (
          <RightPanel
            post={posts.find(p => p.id===selectedPost.id)||selectedPost}
            comments={comments.filter(c => c.post_id===selectedPost.id)}
            versions={versions.filter(v => v.post_id===selectedPost.id)}
            clients={clients}
            onRefresh={fetchAll}
            onClose={() => setSelectedPost(null)}
          />
        )}
      </div>

      {composing && <ComposeModal clients={clients} onClose={() => setComposing(false)} onSaved={fetchAll} />}
    </div>
  )
}
