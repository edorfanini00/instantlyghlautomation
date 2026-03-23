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
};
