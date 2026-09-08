// Vercel serverless function — receives a Database Webhook payload from
// Supabase whenever a row is inserted into comments, status_changes, or
// requests.
//
// Two separate notification paths:
//   - General notifications (to everyone in NOTIFY_EMAIL): a client leaves
//     a comment, or a client submits a new ad hoc request.
//   - Personal notifications (to just the assigned teammate): a post gets
//     approved or sent back for revisions. This does NOT go to the general
//     NOTIFY_EMAIL list — only to whoever is listed in "Assigned to" on
//     that post, looked up by name in the team_members table. If nobody's
//     assigned (or their name doesn't match anyone in team_members),
//     nothing gets sent for that event at all.
//
// Setup required (see chat for full walkthrough):
//   1. npm install resend ws
//   2. Add these env vars in Vercel → Project → Settings → Environment Variables:
//        SUPABASE_URL          (your project URL, e.g. https://xxxx.supabase.co)
//        SUPABASE_ANON_KEY     (same anon key your frontend already uses)
//        RESEND_API_KEY        (from resend.com)
//        NOTIFY_EMAIL          (where you want the general notifications sent —
//                                supports multiple addresses, comma-separated,
//                                e.g. "celina@brown-butter.com, arjay@brown-butter.com")
//        WEBHOOK_SECRET        (any random string you make up)
//   3. In Supabase → Database → Webhooks, create 3 webhooks (comments,
//      status_changes, requests) on INSERT, all pointing at
//      https://<your-vercel-domain>/api/notify with header
//      x-webhook-secret: <same random string>
//   4. Make sure team_members has a row for each teammate (name + email) —
//      the "name" has to match what's typed into "Assigned to" on a post
//      exactly (case-insensitive) for the lookup to find them.

import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const resend = new Resend(process.env.RESEND_API_KEY)
// The Supabase client always tries to set up a realtime (WebSocket)
// connection internally, even though this function never uses it — on
// Node < 22 there's no built-in WebSocket, which crashes the whole
// function before it even runs. Passing the ws package explicitly as
// the transport (Supabase's own documented fix for this) avoids that.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  realtime: { transport: ws },
})

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'Brown Butter Dashboard <onboarding@resend.dev>'

// NOTIFY_EMAIL can be one address or several, comma-separated — Resend's
// "to" field accepts an array, so split on commas and trim any stray spaces.
const NOTIFY_RECIPIENTS = (process.env.NOTIFY_EMAIL || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Basic shared-secret check so random internet traffic can't trigger emails
  if (process.env.WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { table, type, record } = req.body || {}

  // Only care about new rows being created
  if (type !== 'INSERT' || !record) {
    return res.status(200).json({ skipped: true, reason: 'not an insert' })
  }

  try {
    let subject = null
    let text = null

    if (table === 'comments') {
      // Only notify on client comments, not the agency's own replies
      if (record.author_type !== 'client') {
        return res.status(200).json({ skipped: true, reason: 'agency comment' })
      }
      const { data: post, error: postError } = await supabase.from('posts').select('caption, client_id').eq('id', record.post_id).single()
      if (postError) console.error('Failed to fetch post for comment notification (continuing anyway):', postError)
      const { data: client } = post
        ? await supabase.from('clients').select('name').eq('id', post.client_id).single()
        : { data: null }
      const who = record.author || client?.name || 'A client'
      const captionPreview = (post?.caption || '').slice(0, 80)
      subject = `💬 ${who} left a comment`
      text = `${who} commented on "${captionPreview}${post?.caption?.length > 80 ? '…' : ''}":\n\n"${record.text}"\n\nOpen the dashboard to reply.`
    }

    else if (table === 'status_changes') {
      // Only notify on client-driven approvals/revision requests
      if (!['approved', 'revision'].includes(record.status)) {
        return res.status(200).json({ skipped: true, reason: 'not approval/revision' })
      }
      const { data: post, error: postError } = await supabase.from('posts').select('caption, client_id, designer').eq('id', record.post_id).single()
      if (postError) {
        console.error('Failed to fetch post for status_changes notification:', postError)
        return res.status(500).json({ error: 'post lookup failed', details: postError })
      }
      const { data: client } = post
        ? await supabase.from('clients').select('name').eq('id', post.client_id).single()
        : { data: null }
      const who = record.changed_by || client?.name || 'A client'
      const captionPreview = (post?.caption || '').slice(0, 80)
      const captionSuffix = post?.caption?.length > 80 ? '…' : ''

      // This only ever emails whoever the post is assigned to — no general
      // broadcast for approvals/revisions. If nobody's assigned (or their
      // name doesn't match anyone in team_members), nothing gets sent.
      if (!post?.designer) {
        return res.status(200).json({ skipped: true, reason: 'no one assigned to this post' })
      }
      const { data: teamMembers, error: teamError } = await supabase
        .from('team_members')
        .select('email, name')
        .ilike('name', post.designer.trim())
      if (teamError) {
        console.error('Failed to query team_members:', teamError)
        return res.status(500).json({ error: 'team_members lookup failed', details: teamError })
      }
      const assignee = teamMembers?.[0]
      if (!assignee?.email) {
        return res.status(200).json({ skipped: true, reason: 'assignee not found in team_members' })
      }

      const assigneeSubject = record.status === 'approved'
        ? `✅ Your post was approved: "${captionPreview}${captionSuffix}"`
        : `↩️ Revisions requested on your post: "${captionPreview}${captionSuffix}"`
      const assigneeText = record.status === 'approved'
        ? `Good news — ${who} approved "${captionPreview}${captionSuffix}", which is assigned to you.`
        : `${who} requested revisions on "${captionPreview}${captionSuffix}", which is assigned to you. Open the dashboard to see their notes.`

      const { data: sendData, error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: assignee.email,
        subject: assigneeSubject,
        text: assigneeText,
      })

      if (sendError) {
        console.error('Resend rejected the assignee email:', sendError)
        return res.status(502).json({ sent: false, subject: assigneeSubject, resendError: sendError })
      }
      return res.status(200).json({ sent: true, subject: assigneeSubject, to: assignee.email, id: sendData?.id })
    }

    else if (table === 'requests') {
      // Only notify on newly submitted requests
      if (record.status !== 'new') {
        return res.status(200).json({ skipped: true, reason: 'not a new request' })
      }
      const { data: client } = await supabase.from('clients').select('name').eq('id', record.client_id).single()
      const who = client?.name || 'A client'
      subject = `📥 New request from ${who}`
      text = `${who} submitted a request: "${record.title}"${record.description ? '\n\n' + record.description : ''}`
    }

    else {
      return res.status(200).json({ skipped: true, reason: 'unhandled table' })
    }

    if (!subject) {
      return res.status(200).json({ skipped: true, reason: 'nothing to send' })
    }
    if (NOTIFY_RECIPIENTS.length === 0) {
      return res.status(200).json({ skipped: true, reason: 'NOTIFY_EMAIL not configured' })
    }

    const { data: sendData, error: sendError } = await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_RECIPIENTS,
      subject,
      text,
    })

    if (sendError) {
      console.error('Resend rejected the email:', sendError)
      return res.status(502).json({ sent: false, subject, resendError: sendError })
    }

    return res.status(200).json({ sent: true, subject, id: sendData?.id })
  } catch (err) {
    console.error('notify.js error:', err)
    return res.status(500).json({ error: err.message })
  }
}
