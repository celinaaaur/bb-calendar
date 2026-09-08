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
const DASHBOARD_URL = 'https://dashboard.brown-butter.com'

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
      subject = `💬 New comment from ${who}`
      text = `${who} commented on "${captionPreview}${post?.caption?.length > 80 ? '…' : ''}":\n\n"${record.text}"\n\nReply here: ${DASHBOARD_URL}`
    }

    else if (table === 'status_changes') {
      // Only notify on client-driven approvals/revision requests
      if (!['approved', 'revision'].includes(record.status)) {
        return res.status(200).json({ skipped: true, reason: 'not approval/revision' })
      }
      const { data: post, error: postError } = await supabase.from('posts').select('caption, client_id, designer, image_url, cover_url, campaign, scheduled_at').eq('id', record.post_id).single()
      if (postError) {
        console.error('Failed to fetch post for status_changes notification:', postError)
        return res.status(500).json({ error: 'post lookup failed', details: postError })
      }
      const { data: client } = post
        ? await supabase.from('clients').select('name, ig_handle, logo_url, brand_color').eq('id', post.client_id).single()
        : { data: null }
      const clientName = client?.name || 'Client'
      const who = record.changed_by || clientName

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

      const isApproved = record.status === 'approved'
      const statusEmoji = isApproved ? '✅' : '↩️'
      const statusLabel = isApproved ? 'POST APPROVED' : 'REVISIONS REQUESTED'
      const actionVerb = isApproved ? 'approved this post' : 'requested revisions for this post'
      const assigneeSubject = `${statusEmoji} ${clientName} ${statusLabel}`
      // Cover photo takes priority for video posts, since image_url on a
      // video is just the raw file, not something an email client can
      // preview like an image.
      const thumbnailUrl = post?.cover_url || post?.image_url || null
      const handle = client?.ig_handle || clientName.toLowerCase().replace(/\s+/g, '.')
      const avatarInitials = clientName.slice(0, 2).toUpperCase()
      const avatarColor = client?.brand_color || '#3C2211'
      const scheduledLabel = post?.scheduled_at
        ? new Date(post.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : ''

      // Built with a <table> for the header row rather than flexbox — email
      // clients (especially Outlook) render tables far more reliably than
      // modern CSS layout.
      const assigneeHtml = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 8px;">
          <p style="font-size: 15px; line-height: 1.6; color: #2C1F0E; margin: 0 0 16px;">${who} ${actionVerb}:</p>

          <div style="border: 1px solid #E0DACE; border-radius: 8px; overflow: hidden; background: #ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%;">
              <tr>
                <td style="padding: 10px 12px; width: 34px; vertical-align: middle;">
                  ${client?.logo_url
                    ? `<img src="${client.logo_url}" alt="" style="width: 32px; height: 32px; border-radius: 50%; display: block;" />`
                    : `<div style="width: 32px; height: 32px; border-radius: 50%; background-color: ${avatarColor}; color: #ffffff; font-size: 11px; font-weight: bold; text-align: center; line-height: 32px;">${avatarInitials}</div>`
                  }
                </td>
                <td style="padding: 10px 12px 10px 0; vertical-align: middle;">
                  <div style="font-size: 13px; font-weight: bold; color: #111111;">${handle}</div>
                  ${post?.campaign ? `<div style="font-size: 11px; color: #999999;">${post.campaign}</div>` : ''}
                </td>
              </tr>
            </table>
            ${thumbnailUrl ? `<img src="${thumbnailUrl}" alt="" style="width: 100%; display: block;" />` : ''}
            <div style="padding: 12px 12px 4px; font-size: 20px; line-height: 1;">&#9825;&nbsp;&nbsp;&#128172;&nbsp;&nbsp;&#10148;</div>
            <div style="padding: 6px 12px 4px; font-size: 13px; line-height: 1.5; color: #111111;">
              <span style="font-weight: bold;">${handle}</span> ${post?.caption || ''}
            </div>
            ${scheduledLabel ? `<div style="padding: 0 12px 14px; font-size: 11px; color: #999999;">${scheduledLabel}</div>` : ''}
          </div>

          <div style="margin-top: 20px;">
            <a href="${DASHBOARD_URL}" style="display: inline-block; padding: 12px 28px; background-color: #2C1F0E; color: #EEEBE3; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">View it</a>
          </div>
        </div>
      `
      const assigneeText = `${who} ${actionVerb}.\n\nView it: ${DASHBOARD_URL}`

      const { data: sendData, error: sendError } = await resend.emails.send({
        from: FROM_EMAIL,
        to: assignee.email,
        subject: assigneeSubject,
        html: assigneeHtml,
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
      text = `${who} submitted a request: "${record.title}"${record.description ? '\n\n' + record.description : ''}\n\nView in dashboard: ${DASHBOARD_URL}`
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
