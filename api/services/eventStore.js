const fs = require('fs');
const path = require('path');

const EVENTS_FILE = path.join('/tmp', 'instantly-ghl-events.json');
const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

// In-memory cache (loaded from file on startup)
let events = [];

/**
 * Load events from the /tmp file (survives across warm invocations on Vercel).
 */
function loadEvents() {
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      const raw = fs.readFileSync(EVENTS_FILE, 'utf-8');
      events = JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load events file:', err.message);
    events = [];
  }
}

/**
 * Persist current events array to /tmp.
 */
function saveEvents() {
  try {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save events file:', err.message);
  }
}

/**
 * Log a new engagement event.
 */
function logEvent({ eventType, email, campaignId, timestamp, contactId, pipelineAction, stageName }) {
  loadEvents(); // Refresh from disk

  events.push({
    eventType,
    email,
    campaignId: campaignId || 'unknown',
    contactId: contactId || null,
    pipelineAction: pipelineAction || null,
    stageName: stageName || null,
    timestamp: timestamp || new Date().toISOString(),
    loggedAt: new Date().toISOString(),
  });

  // Prune anything older than 48h
  const cutoff = Date.now() - MAX_AGE_MS;
  events = events.filter((e) => new Date(e.loggedAt).getTime() > cutoff);

  saveEvents();
}

/**
 * Get all events logged within the last 24 hours.
 */
function getEventsLast24h() {
  loadEvents();

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return events.filter((e) => new Date(e.loggedAt).getTime() > cutoff);
}

/**
 * Clear all stored events (used after sending daily report).
 */
function clearEvents() {
  events = [];
  saveEvents();
}

// Load on module init
loadEvents();

module.exports = {
  logEvent,
  getEventsLast24h,
  clearEvents,
};
