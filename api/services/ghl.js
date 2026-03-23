const config = require('../config');

const GHL_HEADERS = {
  Authorization: `Bearer ${config.ghl.apiKey}`,
  'Content-Type': 'application/json',
  Version: config.ghl.apiVersion,
  Accept: 'application/json',
};

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Upsert a contact by email — creates if new, updates if existing.
 * Returns the contact object.
 */
async function upsertContact(email, extraData = {}) {
  const body = {
    locationId: config.ghl.locationId,
    email,
    ...extraData,
  };

  const res = await fetch(`${config.ghl.baseUrl}/contacts/upsert`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL upsert contact failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  // The upsert endpoint returns { contact: {...}, new: true/false }
  return data.contact;
}

/**
 * Add tags to an existing contact (merges with current tags).
 */
async function addTags(contactId, newTags = []) {
  // First, get the contact to read existing tags
  const getRes = await fetch(`${config.ghl.baseUrl}/contacts/${contactId}`, {
    method: 'GET',
    headers: GHL_HEADERS,
  });

  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`GHL get contact failed (${getRes.status}): ${text}`);
  }

  const { contact } = await getRes.json();
  const currentTags = contact.tags || [];
  const mergedTags = [...new Set([...currentTags, ...newTags])];

  // Update only if there are new tags to add
  if (mergedTags.length === currentTags.length) {
    return contact;
  }

  const updateRes = await fetch(`${config.ghl.baseUrl}/contacts/${contactId}`, {
    method: 'PUT',
    headers: GHL_HEADERS,
    body: JSON.stringify({ tags: mergedTags }),
  });

  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error(`GHL update tags failed (${updateRes.status}): ${text}`);
  }

  return updateRes.json();
}

// ---------------------------------------------------------------------------
// Opportunities (Pipeline)
// ---------------------------------------------------------------------------

/**
 * Search for an existing opportunity for a contact in the target pipeline.
 * @param {string} contactId
 * @param {object} pipeline - Pipeline config object with id, name, stages
 */
async function getContactOpportunity(contactId, pipeline) {
  const url = new URL(`${config.ghl.baseUrl}/opportunities/search`);
  url.searchParams.set('location_id', config.ghl.locationId);
  url.searchParams.set('contact_id', contactId);
  url.searchParams.set('pipeline_id', pipeline.id);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: GHL_HEADERS,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL search opportunities failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const opportunities = data.opportunities || [];

  // Return the first matching opportunity (there should be at most one per pipeline)
  return opportunities.length > 0 ? opportunities[0] : null;
}

/**
 * Create a new opportunity at a given stage.
 */
async function createOpportunity(contactId, stageKey, contactEmail, pipeline) {
  const stage = pipeline.stages[stageKey];
  if (!stage) throw new Error(`Unknown stage key: ${stageKey}`);

  const body = {
    pipelineId: pipeline.id,
    locationId: config.ghl.locationId,
    pipelineStageId: stage.id,
    contactId,
    name: `${contactEmail} — ${pipeline.name}`,
    status: 'open',
  };

  const res = await fetch(`${config.ghl.baseUrl}/opportunities/`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL create opportunity failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Move an existing opportunity to a new stage.
 */
async function moveOpportunity(opportunityId, stageKey, pipeline) {
  const stage = pipeline.stages[stageKey];
  if (!stage) throw new Error(`Unknown stage key: ${stageKey}`);

  const res = await fetch(`${config.ghl.baseUrl}/opportunities/${opportunityId}`, {
    method: 'PUT',
    headers: GHL_HEADERS,
    body: JSON.stringify({ pipelineStageId: stage.id }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL move opportunity failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Core logic: Create or move opportunity forward through the pipeline.
 * Never moves backward — if the contact is at a higher stage, the update is skipped.
 *
 * @param {string} contactId
 * @param {string} targetStageKey - Stage key (opened, linkClicked, replied)
 * @param {string} contactEmail
 * @param {object} pipeline - Pipeline config object with id, name, stages
 * Returns { action: 'created' | 'moved' | 'skipped', stage: string, pipeline: string }
 */
async function createOrMoveOpportunity(contactId, targetStageKey, contactEmail, pipeline) {
  const targetStage = pipeline.stages[targetStageKey];
  if (!targetStage) throw new Error(`Unknown stage key: ${targetStageKey}`);

  const existingOpp = await getContactOpportunity(contactId, pipeline);

  if (!existingOpp) {
    // No opportunity yet — create one
    await createOpportunity(contactId, targetStageKey, contactEmail, pipeline);
    return { action: 'created', stage: targetStage.name, pipeline: pipeline.name };
  }

  // Find current stage position
  const currentStageId = existingOpp.pipelineStageId;
  const allStages = pipeline.stages;
  let currentPosition = -1;

  for (const key of Object.keys(allStages)) {
    if (allStages[key].id === currentStageId) {
      currentPosition = allStages[key].position;
      break;
    }
  }

  if (targetStage.position > currentPosition) {
    // Move forward
    await moveOpportunity(existingOpp.id, targetStageKey, pipeline);
    return { action: 'moved', stage: targetStage.name, pipeline: pipeline.name };
  }

  // Already at same or higher stage — skip
  return { action: 'skipped', stage: targetStage.name, pipeline: pipeline.name };
}

// ---------------------------------------------------------------------------
// Email (via Conversations API)
// ---------------------------------------------------------------------------

/**
 * Send an email through GHL. Requires a GHL-connected email address as sender.
 */
async function sendEmail({ contactId, emailTo, emailCc, emailFrom, subject, html }) {
  const body = {
    type: 'Email',
    contactId,
    emailTo,
    subject,
    html,
  };

  if (emailFrom) body.emailFrom = emailFrom;
  if (emailCc && emailCc.length > 0) body.emailCc = emailCc;

  const res = await fetch(`${config.ghl.baseUrl}/conversations/messages`, {
    method: 'POST',
    headers: GHL_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL send email failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Send the daily report email to each sales team member.
 * Uses a direct SMTP-style send (not tied to a contact conversation).
 */
async function sendReportEmail(subject, htmlBody) {
  // Use the GHL email send endpoint (v1) for non-contact emails
  const results = [];

  for (const recipient of config.salesTeamEmails) {
    try {
      const res = await fetch(`${config.ghl.baseUrl}/conversations/messages`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({
          type: 'Email',
          contactId: null,  // Will create/use internal contact
          emailTo: recipient,
          subject,
          html: htmlBody,
          locationId: config.ghl.locationId,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Failed to send report to ${recipient}: ${text}`);
        results.push({ recipient, success: false, error: text });
      } else {
        results.push({ recipient, success: true });
      }
    } catch (err) {
      console.error(`Error sending report to ${recipient}:`, err.message);
      results.push({ recipient, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = {
  upsertContact,
  addTags,
  getContactOpportunity,
  createOpportunity,
  moveOpportunity,
  createOrMoveOpportunity,
  sendEmail,
  sendReportEmail,
};
