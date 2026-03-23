const express = require('express');
const config = require('../config');
const ghl = require('../services/ghl');
const instantly = require('../services/instantly');
const eventStore = require('../services/eventStore');

const router = express.Router();

// Supported Instantly.ai event types
const SUPPORTED_EVENTS = new Set([
  'email_opened',
  'email_link_clicked',
  'reply_received',
]);

/**
 * POST /api/webhook/instantly
 *
 * Receives webhook payloads from Instantly.ai when a campaign email is
 * opened, a link is clicked, or a reply is received.
 *
 * Payload shape (from Instantly docs):
 * {
 *   "event_type": "email_opened" | "email_link_clicked" | "reply_received",
 *   "timestamp": "2026-03-23T18:00:00Z",
 *   "lead_email": "john@company.com",
 *   "campaign_id": "abc123",
 *   "workspace": "...",
 *   "email_account": "sender@celeritech.biz",
 *   // For replies:
 *   "reply_text_snippet": "...",
 *   "reply_subject": "...",
 *   "reply_text": "...",
 *   "reply_html": "..."
 * }
 */
router.post('/instantly', async (req, res) => {
  const startTime = Date.now();

  try {
    const payload = req.body;

    // ── Validate ──────────────────────────────────────────────
    const eventType = payload.event_type;
    const leadEmail = payload.lead_email;

    if (!eventType || !leadEmail) {
      console.warn('[webhook] Missing event_type or lead_email:', JSON.stringify(payload).slice(0, 200));
      return res.status(400).json({ error: 'Missing event_type or lead_email' });
    }

    if (!SUPPORTED_EVENTS.has(eventType)) {
      console.log(`[webhook] Ignoring unsupported event: ${eventType}`);
      return res.status(200).json({ status: 'ignored', reason: `Unsupported event: ${eventType}` });
    }

    console.log(`[webhook] Processing ${eventType} for ${leadEmail}`);

    // ── 1. Fetch full lead details from Instantly CRM ──────────
    let leadData = null;
    try {
      leadData = await instantly.getLeadByEmail(leadEmail);
      if (leadData) {
        console.log(`[webhook] Instantly lead found: ${leadData.firstName || ''} ${leadData.lastName || ''} (${leadData.companyName || 'no company'})`);
      }
    } catch (err) {
      console.warn(`[webhook] Instantly lead lookup failed, continuing with email only:`, err.message);
    }

    // ── 2. Upsert contact in GHL with full details ────────────
    const contactData = {
      source: 'Instantly.ai',
    };

    // Populate from Instantly CRM data (primary source)
    if (leadData) {
      if (leadData.firstName) contactData.firstName = leadData.firstName;
      if (leadData.lastName) contactData.lastName = leadData.lastName;
      if (leadData.companyName) contactData.companyName = leadData.companyName;
      if (leadData.phone) contactData.phone = leadData.phone;
    }

    // Fallback: also check webhook payload in case it has data
    if (!contactData.firstName && payload.first_name) contactData.firstName = payload.first_name;
    if (!contactData.lastName && payload.last_name) contactData.lastName = payload.last_name;
    if (!contactData.companyName && (payload.company_name || payload.company)) contactData.companyName = payload.company_name || payload.company;
    if (!contactData.phone && (payload.phone || payload.phone_number)) contactData.phone = payload.phone || payload.phone_number;

    const contact = await ghl.upsertContact(leadEmail, contactData);

    const contactId = contact.id;
    console.log(`[webhook] Contact upserted: ${contactId} (${leadEmail})`);

    // ── 2. Add event-specific tag ─────────────────────────────
    const tag = config.eventToTag[eventType];
    if (tag) {
      await ghl.addTags(contactId, [tag, 'instantly-campaign']);
      console.log(`[webhook] Tags added: ${tag}, instantly-campaign`);
    }

    // ── 3. Resolve pipeline from campaign ID ──────────────────
    const campaignId = payload.campaign_id;
    const pipelineKey = config.campaignToPipeline[campaignId] || config.defaultPipeline;
    const pipeline = config.ghl.pipelines[pipelineKey];
    console.log(`[webhook] Campaign ${campaignId} → pipeline: ${pipeline.name}`);

    // ── 4. Create or move opportunity (forward-only) ──────────
    const stageKey = config.eventToStage[eventType];
    const pipelineResult = await ghl.createOrMoveOpportunity(contactId, stageKey, leadEmail, pipeline);
    console.log(`[webhook] Pipeline: ${pipelineResult.action} → ${pipelineResult.stage} (${pipeline.name})`);

    // ── 5. Log event for daily report ─────────────────────────
    eventStore.logEvent({
      eventType,
      email: leadEmail,
      campaignId,
      timestamp: payload.timestamp,
      contactId,
      pipelineAction: pipelineResult.action,
      stageName: pipelineResult.stage,
      pipelineName: pipeline.name,
    });

    const duration = Date.now() - startTime;
    console.log(`[webhook] Done in ${duration}ms`);

    return res.status(200).json({
      status: 'ok',
      contactId,
      pipeline: pipelineResult,
      duration: `${duration}ms`,
    });
  } catch (err) {
    console.error('[webhook] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
