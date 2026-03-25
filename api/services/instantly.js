const config = require('../config');

/**
 * Look up a lead in Instantly's CRM by email address.
 * Uses POST /api/v2/leads/list with the `contacts` filter.
 *
 * Returns { firstName, lastName, companyName, phone, website } or null.
 */
async function getLeadByEmail(email) {
  try {
    const res = await fetch('https://api.instantly.ai/api/v2/leads/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.instantly.apiKey}`,
      },
      body: JSON.stringify({
        contacts: [email],
        limit: 1,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[instantly] leads/list failed (${res.status}):`, text.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const leads = data.items || [];

    if (leads.length === 0) {
      console.log(`[instantly] No lead found for ${email}`);
      return null;
    }

    const lead = leads[0];

    return {
      firstName: lead.first_name || null,
      lastName: lead.last_name || null,
      companyName: lead.company_name || null,
      phone: lead.phone || null,
      website: lead.website || null,
    };
  } catch (err) {
    console.warn(`[instantly] Lead lookup error for ${email}:`, err.message);
    return null;
  }
}

module.exports = {
  getLeadByEmail,
  getCampaignLeadsWithActivity,
};

/**
 * Fetch all leads from a campaign that have engagement activity
 * (opened, clicked, or replied) within the last 24 hours.
 *
 * Uses POST /api/v2/leads/list with campaign filter, paginates through all results,
 * and filters client-side for leads whose last open/click/reply timestamp is within 24h.
 *
 * @param {string} campaignId
 * @returns {Array} Leads with activity in the last 24h, each containing:
 *   email, first_name, last_name, company_name, email_open_count,
 *   email_reply_count, email_click_count, timestamp_last_open/reply/click, events[]
 */
async function getCampaignLeadsWithActivity(campaignId) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const engagedLeads = [];
  let startingAfter = null;
  let hasMore = true;

  while (hasMore) {
    const body = {
      campaign: campaignId,
      limit: 100,
    };
    if (startingAfter) body.starting_after = startingAfter;

    try {
      const res = await fetch('https://api.instantly.ai/api/v2/leads/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.instantly.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(`[instantly] leads/list failed (${res.status}):`, text.slice(0, 200));
        break;
      }

      const data = await res.json();
      const leads = data.items || [];

      for (const lead of leads) {
        const openCount = lead.email_open_count || 0;
        const replyCount = lead.email_reply_count || 0;
        const clickCount = lead.email_click_count || 0;

        // Skip leads with zero engagement
        if (openCount === 0 && replyCount === 0 && clickCount === 0) continue;

        // Check if any activity is within the last 24h
        const events = [];

        if (replyCount > 0 && lead.timestamp_last_reply && lead.timestamp_last_reply >= cutoff) {
          events.push({
            type: 'reply_received',
            label: '💬 Replied',
            timestamp: lead.timestamp_last_reply,
          });
        }

        if (clickCount > 0 && lead.timestamp_last_click && lead.timestamp_last_click >= cutoff) {
          events.push({
            type: 'email_link_clicked',
            label: '🔗 Clicked',
            timestamp: lead.timestamp_last_click,
          });
        }

        if (openCount > 0 && lead.timestamp_last_open && lead.timestamp_last_open >= cutoff) {
          events.push({
            type: 'email_opened',
            label: '📬 Opened',
            timestamp: lead.timestamp_last_open,
          });
        }

        if (events.length > 0) {
          engagedLeads.push({
            email: lead.email,
            firstName: lead.first_name || null,
            lastName: lead.last_name || null,
            companyName: lead.company_name || null,
            openCount,
            replyCount,
            clickCount,
            events,
          });
        }
      }

      // Pagination
      if (leads.length < 100 || !data.next_starting_after) {
        hasMore = false;
      } else {
        startingAfter = data.next_starting_after;
      }
    } catch (err) {
      console.warn(`[instantly] leads/list error for campaign ${campaignId}:`, err.message);
      break;
    }
  }

  return engagedLeads;
}
