// Centralized configuration — all from environment variables
const config = {
  // Instantly.ai
  instantly: {
    apiKey: process.env.INSTANTLY_API_KEY || '',
  },

  // GoHighLevel
  ghl: {
    apiKey: process.env.GHL_API_KEY || '',
    locationId: process.env.GHL_LOCATION_ID || 't64wu6C9FCzSRv4xNW9p',
    baseUrl: 'https://services.leadconnectorhq.com',
    apiVersion: '2021-07-28',

    // Pipeline: "Food man email"
    pipeline: {
      id: 'acxMFaKegN6CAWIj8YAD',
      name: 'Food man email',
      stages: {
        opened:      { id: 'f300cd21-a23b-40ee-95ec-299ac95f7d50', position: 0, name: 'Opened' },
        linkClicked: { id: '83edd12a-a91b-4919-b8fa-ac7222430622', position: 1, name: 'Link clicked' },
        replied:     { id: 'bc2ac752-268b-4da6-8567-98940b5c5776', position: 2, name: 'Replied' },
      },
    },
  },

  // Instantly event → stage mapping
  eventToStage: {
    email_opened:       'opened',
    email_link_clicked: 'linkClicked',
    reply_received:     'replied',
  },

  // Instantly event → tag mapping
  eventToTag: {
    email_opened:       'instantly-opened',
    email_link_clicked: 'instantly-clicked',
    reply_received:     'instantly-replied',
  },

  // Sales team for daily report
  salesTeamEmails: [
    'edoardo.orfanini@celeritech.biz',
    'claudia.ochoa@celeritech.biz',
    'natalie.arana@celeritech.biz',
  ],

  // Vercel cron secret for securing the daily report endpoint
  cronSecret: process.env.CRON_SECRET || '',

  // Local dev
  port: process.env.PORT || 3000,
};

module.exports = config;
