const express = require('express');
const config = require('../config');
const ghl = require('../services/ghl');
const eventStore = require('../services/eventStore');

const router = express.Router();

/**
 * GET /api/cron/daily-report
 *
 * Triggered by Vercel Cron at 8 AM UTC daily.
 * Aggregates engagement events from the last 24 hours and emails
 * a summary report to the sales team.
 */
router.get('/daily-report', async (req, res) => {
  try {
    // ── Verify cron secret (Vercel sets this header) ──────────
    const authHeader = req.headers['authorization'];
    const cronSecret = config.cronSecret;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron] Unauthorized daily report request');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[cron] Generating daily engagement report...');

    // ── Gather events ─────────────────────────────────────────
    const events = eventStore.getEventsLast24h();

    if (events.length === 0) {
      console.log('[cron] No events in the last 24h, skipping report.');
      return res.status(200).json({ status: 'skipped', reason: 'No events in the last 24h' });
    }

    // ── Aggregate by type ─────────────────────────────────────
    const summary = {
      email_opened: [],
      email_link_clicked: [],
      reply_received: [],
    };

    for (const event of events) {
      if (summary[event.eventType]) {
        summary[event.eventType].push(event);
      }
    }

    // ── Build HTML email ──────────────────────────────────────
    const html = buildReportHtml(summary, events.length);

    // ── Send to each sales team member ────────────────────────
    const reportDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subject = `📊 Instantly Campaign Report — ${reportDate}`;

    // Send one email to the primary recipient, CC the rest
    const [primaryEmail, ...ccEmails] = config.salesTeamEmails;

    try {
      // Ensure the primary recipient exists as a contact in GHL
      const contact = await ghl.upsertContact(primaryEmail, {
        tags: ['internal-team'],
      });

      await ghl.sendEmail({
        contactId: contact.id,
        emailTo: primaryEmail,
        emailCc: ccEmails,
        subject,
        html,
      });

      console.log(`[cron] Report sent to ${primaryEmail}, CC: ${ccEmails.join(', ')}`);

      return res.status(200).json({
        status: 'ok',
        eventCount: events.length,
        to: primaryEmail,
        cc: ccEmails,
      });
    } catch (err) {
      console.error(`[cron] Failed to send report:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  } catch (err) {
    console.error('[cron] Error generating daily report:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Report HTML Builder
// ---------------------------------------------------------------------------

function buildReportHtml(summary, totalEvents) {
  const openedCount = summary.email_opened.length;
  const clickedCount = summary.email_link_clicked.length;
  const repliedCount = summary.reply_received.length;

  const eventRows = (events, label) =>
    events
      .map(
        (e) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${e.email}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${label}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${e.campaignId || '—'}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${new Date(e.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">
            <span style="padding: 2px 8px; border-radius: 4px; font-size: 12px; background: ${
              e.pipelineAction === 'created' ? '#e8f5e9' : e.pipelineAction === 'moved' ? '#fff3e0' : '#f5f5f5'
            }; color: ${
              e.pipelineAction === 'created' ? '#2e7d32' : e.pipelineAction === 'moved' ? '#e65100' : '#757575'
            };">${e.pipelineAction || '—'} → ${e.stageName || '—'}</span>
          </td>
        </tr>`
      )
      .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333;">

      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 24px; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0 0 4px 0; font-size: 22px;">📊 Daily Engagement Report</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 14px;">Instantly.ai → GoHighLevel • Last 24 Hours</p>
      </div>

      <!-- Summary Cards -->
      <div style="display: flex; gap: 12px; margin-bottom: 24px;">
        <div style="flex: 1; background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #1565c0;">${openedCount}</div>
          <div style="font-size: 13px; color: #1565c0; margin-top: 4px;">📬 Opened</div>
        </div>
        <div style="flex: 1; background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #e65100;">${clickedCount}</div>
          <div style="font-size: 13px; color: #e65100; margin-top: 4px;">🔗 Clicked</div>
        </div>
        <div style="flex: 1; background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #2e7d32;">${repliedCount}</div>
          <div style="font-size: 13px; color: #2e7d32; margin-top: 4px;">💬 Replied</div>
        </div>
      </div>

      <!-- Detail Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Email</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Event</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Campaign</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Time (ET)</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Pipeline</th>
          </tr>
        </thead>
        <tbody>
          ${eventRows(summary.reply_received, '💬 Replied')}
          ${eventRows(summary.email_link_clicked, '🔗 Clicked')}
          ${eventRows(summary.email_opened, '📬 Opened')}
        </tbody>
      </table>

      ${totalEvents === 0 ? '<p style="text-align: center; color: #999; padding: 20px;">No engagement events in the last 24 hours.</p>' : ''}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center;">
        Celeritech Automation • Instantly.ai → GoHighLevel • Pipeline: Food man email
      </div>

    </body>
    </html>
  `;
}

module.exports = router;
