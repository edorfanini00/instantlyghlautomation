/**
 * One-time bulk import script.
 * Reads historical Instantly campaign activity, enriches from Instantly CRM,
 * and upserts contacts into GHL at their highest pipeline stage.
 *
 * Usage: node scripts/bulk-import.js
 */

// Load .env first
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...val] = trimmed.split('=');
      process.env[key.trim()] = val.join('=').trim();
    }
  }
}

const config = require('../api/config');
const ghl = require('../api/services/ghl');
const instantly = require('../api/services/instantly');

// ── Raw activity data from the screenshot ─────────────────
const rawActivity = [
  { email: 'a.miranda@arevalos.com', event: 'Opened', timestamp: '2026-03-23T13:42:56.313Z' },
  { email: 'a.miranda@arevalos.com', event: 'Opened', timestamp: '2026-03-20T14:00:28.122Z' },
  { email: 'a.miranda@arevalos.com', event: 'Opened', timestamp: '2026-03-20T14:00:28.115Z' },
  { email: 'aalfonso@ulmapackaging.com', event: 'Opened', timestamp: '2026-03-20T13:59:34.047Z' },
  { email: 'a.teklu@corbion.com', event: 'Opened', timestamp: '2026-03-20T13:58:05.294Z' },
  { email: 'a.teklu@corbion.com', event: 'Opened', timestamp: '2026-03-20T13:53:06.083Z' },
  { email: 'a.teklu@corbion.com', event: 'Link Clicked', timestamp: '2026-03-20T13:48:26.015Z' },
  { email: 'a.teklu@corbion.com', event: 'Opened', timestamp: '2026-03-20T13:47:56.532Z' },
  { email: 'alrann.mohammed@tnasolutions.com', event: 'Auto Reply', timestamp: '2026-03-18T14:21:56.482Z' },
  { email: 'agovea@bcwilliams.com', event: 'Opened', timestamp: '2026-03-18T13:34:07.002Z' },
  { email: 'a.miranda@arevalos.com', event: 'Opened', timestamp: '2026-03-17T13:26:18.496Z' },
  { email: 'a.miranda@arevalos.com', event: 'Opened', timestamp: '2026-03-17T13:26:18.483Z' },
  { email: 'zac.maodus@cerebelly.com', event: 'Opened', timestamp: '2026-03-11T13:08:46.082Z' },
  { email: 'zac.maodus@cerebelly.com', event: 'Link Clicked', timestamp: '2026-03-11T13:06:23.731Z' },
  { email: 'zac.maodus@cerebelly.com', event: 'Opened', timestamp: '2026-03-11T13:05:38.397Z' },
  { email: 'ray@cheeseplus.com', event: 'Opened', timestamp: '2026-03-11T00:06:48.833Z' },
  { email: 'ray@cheeseplus.com', event: 'Opened', timestamp: '2026-03-10T16:26:55.749Z' },
  { email: 'ray@cheeseplus.com', event: 'Opened', timestamp: '2026-03-10T16:18:34.396Z' },
  { email: 'george@dogdogcat.com', event: 'Opened', timestamp: '2026-03-10T15:16:49.987Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Link Clicked', timestamp: '2026-03-10T14:43:25.048Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Link Clicked', timestamp: '2026-03-10T14:43:18.480Z' },
  { email: 'george@dogdogcat.com', event: 'Opened', timestamp: '2026-03-10T14:40:15.463Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Link Clicked', timestamp: '2026-03-10T13:59:08.056Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Link Clicked', timestamp: '2026-03-10T14:12:52.220Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Opened', timestamp: '2026-03-10T14:12:32.972Z' },
  { email: 'luke.papendick@cerebelly.com', event: 'Opened', timestamp: '2026-03-10T14:00:57.046Z' },
  { email: 'paul.verdu@us-asahi.com', event: 'Opened', timestamp: '2026-03-10T14:00:57.046Z' },
];

// ── Event priority (higher = further in pipeline) ──────────
const EVENT_PRIORITY = {
  'Opened': 0,
  'Link Clicked': 1,
  'Auto Reply': 2,
};

const EVENT_TO_STAGE = {
  'Opened': 'opened',
  'Link Clicked': 'linkClicked',
  'Auto Reply': 'replied',
};

const EVENT_TO_TAGS = {
  'Opened': ['instantly-opened', 'instantly-campaign', 'bulk-import'],
  'Link Clicked': ['instantly-opened', 'instantly-clicked', 'instantly-campaign', 'bulk-import'],
  'Auto Reply': ['instantly-opened', 'instantly-replied', 'instantly-campaign', 'bulk-import'],
};

// ── Deduplicate: keep highest event per email ──────────────
function deduplicateContacts(activity) {
  const contactMap = new Map();

  for (const entry of activity) {
    const existing = contactMap.get(entry.email);
    const priority = EVENT_PRIORITY[entry.event] ?? -1;

    if (!existing || priority > existing.priority) {
      contactMap.set(entry.email, {
        email: entry.email,
        event: entry.event,
        priority,
        timestamp: entry.timestamp,
      });
    }
  }

  return Array.from(contactMap.values());
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  const contacts = deduplicateContacts(rawActivity);

  console.log(`\n📋 Bulk Import: ${contacts.length} unique contacts\n`);
  console.log('Contacts to import:');
  for (const c of contacts) {
    console.log(`  ${c.email} → ${c.event}`);
  }
  console.log('');

  let success = 0;
  let failed = 0;

  for (const contact of contacts) {
    try {
      console.log(`── Processing ${contact.email} ──`);

      // 1. Enrich from Instantly CRM
      const leadData = await instantly.getLeadByEmail(contact.email);
      if (leadData) {
        console.log(`   Instantly: ${leadData.firstName || '?'} ${leadData.lastName || '?'} (${leadData.companyName || 'no company'})`);
      } else {
        console.log(`   Instantly: no enrichment data found`);
      }

      // 2. Upsert contact in GHL
      const contactData = { source: 'Instantly.ai' };
      if (leadData) {
        if (leadData.firstName) contactData.firstName = leadData.firstName;
        if (leadData.lastName) contactData.lastName = leadData.lastName;
        if (leadData.companyName) contactData.companyName = leadData.companyName;
        if (leadData.phone) contactData.phone = leadData.phone;
      }

      const ghlContact = await ghl.upsertContact(contact.email, contactData);
      console.log(`   GHL contact: ${ghlContact.id}`);

      // 3. Add tags
      const tags = EVENT_TO_TAGS[contact.event] || ['instantly-campaign', 'bulk-import'];
      await ghl.addTags(ghlContact.id, tags);
      console.log(`   Tags: ${tags.join(', ')}`);

      // 4. Create/move opportunity (forward-only)
      const stageKey = EVENT_TO_STAGE[contact.event];
      const result = await ghl.createOrMoveOpportunity(ghlContact.id, stageKey, contact.email);
      console.log(`   Pipeline: ${result.action} → ${result.stage}`);

      success++;
      console.log(`   ✅ Done\n`);

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n🏁 Bulk Import Complete: ${success} success, ${failed} failed\n`);
}

main().catch(console.error);
