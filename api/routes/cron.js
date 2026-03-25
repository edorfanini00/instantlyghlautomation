const express = require('express');
const config = require('../config');
const ghl = require('../services/ghl');
const instantly = require('../services/instantly');

const router = express.Router();

/**
 * GET /api/cron/daily-report
 *
 * Triggered by Vercel Cron at 2 PM ET daily.
 *
 * For each campaign:
 * 1. Scans Instantly for leads who opened/clicked/replied in the last 24h
 * 2. Upserts each lead into GHL (with name/company enrichment from Instantly)
 * 3. Creates or moves their opportunity in the corresponding GHL pipeline (forward-only)
 * 4. Sends a line-by-line report showing the action taken per lead
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

    console.log('[cron] Scanning Instantly → syncing GHL pipelines → sending reports...');

    const reportDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const [primaryEmail, ...ccEmails] = config.salesTeamEmails;
    const results = [];

    // ── Per-campaign: scan → sync → report ────────────────────
    for (const [campaignId, pipelineKey] of Object.entries(config.campaignToPipeline)) {
      const pipeline = config.ghl.pipelines[pipelineKey];
      const pipelineName = pipeline ? pipeline.name : pipelineKey;

      try {
        console.log(`\n[cron] ── ${pipelineName} ──`);

        // 1. Scan Instantly for engaged leads
        const engagedLeads = await instantly.getCampaignLeadsWithActivity(campaignId);

        if (engagedLeads.length === 0) {
          console.log(`[cron] No engaged leads, skipping.`);
          results.push({ pipeline: pipelineName, leads: 0, sent: false, reason: 'No engaged leads' });
          continue;
        }

        console.log(`[cron] ${engagedLeads.length} lead(s) with activity in last 24h`);

        // 2. Sync each lead into GHL + build report rows
        const reportRows = [];

        for (const lead of engagedLeads) {
          try {
            // Determine the highest event for this lead (replied > clicked > opened)
            const highestEvent = lead.events[0]; // Already sorted: replied, clicked, opened
            const stageKey = config.eventToStage[highestEvent.type];
            const tag = config.eventToTag[highestEvent.type];

            // Upsert contact with enrichment from Instantly
            const contactData = { source: 'Instantly.ai' };
            if (lead.firstName) contactData.firstName = lead.firstName;
            if (lead.lastName) contactData.lastName = lead.lastName;
            if (lead.companyName) contactData.companyName = lead.companyName;

            const contact = await ghl.upsertContact(lead.email, contactData);
            const contactId = contact.id;

            // Add tags
            if (tag) {
              await ghl.addTags(contactId, [tag, 'instantly-campaign']);
            }

            // Create or move opportunity (forward-only)
            const pipelineResult = await ghl.createOrMoveOpportunity(
              contactId,
              stageKey,
              lead.email,
              pipeline
            );

            console.log(`[cron]   ${lead.email}: ${pipelineResult.action} → ${pipelineResult.stage}`);

            // Build report row per event
            const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—';

            for (const event of lead.events) {
              reportRows.push({
                email: lead.email,
                name,
                company: lead.companyName || '—',
                eventLabel: event.label,
                eventType: event.type,
                timestamp: event.timestamp,
                pipelineAction: pipelineResult.action,
                pipelineStage: pipelineResult.stage,
              });
            }
          } catch (err) {
            console.error(`[cron]   ❌ ${lead.email}: ${err.message}`);
            const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—';
            for (const event of lead.events) {
              reportRows.push({
                email: lead.email,
                name,
                company: lead.companyName || '—',
                eventLabel: event.label,
                eventType: event.type,
                timestamp: event.timestamp,
                pipelineAction: 'error',
                pipelineStage: '—',
              });
            }
          }
        }

        // Sort: replies first, then clicks, then opens
        const eventOrder = { '💬 Replied': 0, '🔗 Clicked': 1, '📬 Opened': 2 };
        reportRows.sort((a, b) => (eventOrder[a.eventLabel] || 99) - (eventOrder[b.eventLabel] || 99));

        // Summary counts
        const summary = {
          opened: reportRows.filter(r => r.eventType === 'email_opened').length,
          clicked: reportRows.filter(r => r.eventType === 'email_link_clicked').length,
          replied: reportRows.filter(r => r.eventType === 'reply_received').length,
        };

        // 3. Send report email
        const html = buildReportHtml(reportRows, summary, pipelineName);
        const subject = `📊 ${pipelineName} Report — ${reportDate}`;

        const reportContact = await ghl.upsertContact(primaryEmail, { tags: ['internal-team'] });
        await ghl.sendEmail({
          contactId: reportContact.id,
          emailTo: primaryEmail,
          emailCc: ccEmails,
          subject,
          html,
        });

        console.log(`[cron] ✅ ${pipelineName}: ${reportRows.length} events, ${engagedLeads.length} leads synced & reported`);
        results.push({ pipeline: pipelineName, leads: engagedLeads.length, events: reportRows.length, summary, sent: true });
      } catch (err) {
        console.error(`[cron] ❌ Failed ${pipelineName}:`, err.message);
        results.push({ pipeline: pipelineName, sent: false, error: err.message });
      }
    }

    return res.status(200).json({
      status: 'ok',
      to: primaryEmail,
      cc: ccEmails,
      reports: results,
    });
  } catch (err) {
    console.error('[cron] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Report HTML Builder — Line-by-line with GHL pipeline action
// ---------------------------------------------------------------------------

function buildReportHtml(rows, summary, pipelineName) {
  const actionBadge = (action, stage) => {
    const colors = {
      created:  { bg: '#e8f5e9', fg: '#2e7d32' },
      moved:    { bg: '#fff3e0', fg: '#e65100' },
      skipped:  { bg: '#f5f5f5', fg: '#757575' },
      error:    { bg: '#ffebee', fg: '#c62828' },
    };
    const c = colors[action] || colors.skipped;
    const label = action === 'created' ? `✨ New → ${stage}`
               : action === 'moved'   ? `⬆️ Moved → ${stage}`
               : action === 'skipped' ? `✓ Already at ${stage}`
               : `⚠️ Error`;
    return `<span style="padding: 2px 8px; border-radius: 4px; font-size: 12px; background: ${c.bg}; color: ${c.fg};">${label}</span>`;
  };

  const tableRows = rows
    .map(
      (r) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${r.email}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${r.name}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${r.eventLabel}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${new Date(r.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #eee;">${actionBadge(r.pipelineAction, r.pipelineStage)}</td>
        </tr>`)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333;">

      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 24px; color: white; margin-bottom: 24px;">
        <h1 style="margin: 0 0 4px 0; font-size: 22px;">📊 ${pipelineName} — Daily Report</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 14px;">Instantly.ai → GoHighLevel Pipeline Sync • Last 24 Hours</p>
      </div>

      <!-- Summary Cards -->
      <div style="display: flex; gap: 12px; margin-bottom: 24px;">
        <div style="flex: 1; background: #e3f2fd; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #1565c0;">${summary.opened}</div>
          <div style="font-size: 13px; color: #1565c0; margin-top: 4px;">📬 Opened</div>
        </div>
        <div style="flex: 1; background: #fff3e0; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #e65100;">${summary.clicked}</div>
          <div style="font-size: 13px; color: #e65100; margin-top: 4px;">🔗 Clicked</div>
        </div>
        <div style="flex: 1; background: #e8f5e9; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: 700; color: #2e7d32;">${summary.replied}</div>
          <div style="font-size: 13px; color: #2e7d32; margin-top: 4px;">💬 Replied</div>
        </div>
      </div>

      <!-- Detail Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Email</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Name</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Event</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">Time (ET)</th>
            <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #ddd;">GHL Pipeline</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      ${rows.length === 0 ? '<p style="text-align: center; color: #999; padding: 20px;">No engagement events in the last 24 hours.</p>' : ''}

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center;">
        Celeritech Automation • Instantly.ai → GoHighLevel • Pipeline: ${pipelineName}
      </div>

    </body>
    </html>
  `;
}

module.exports = router;
