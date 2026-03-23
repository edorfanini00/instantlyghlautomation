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

    // All pipelines
    pipelines: {
      foodManEmail: {
        id: 'acxMFaKegN6CAWIj8YAD',
        name: 'Food man email',
        stages: {
          opened:      { id: 'f300cd21-a23b-40ee-95ec-299ac95f7d50', position: 0, name: 'Opened' },
          linkClicked: { id: '83edd12a-a91b-4919-b8fa-ac7222430622', position: 1, name: 'Link clicked' },
          replied:     { id: 'bc2ac752-268b-4da6-8567-98940b5c5776', position: 2, name: 'Replied' },
        },
      },
      enterpryzeEmail: {
        id: 'TTe6RuBZfxmpOl1TJpTr',
        name: 'enterpryze email',
        stages: {
          opened:      { id: '3a7b59fc-a3f5-4d77-85e9-d3da28327ec9', position: 0, name: 'Opened' },
          linkClicked: { id: '546419d0-1e95-4634-8274-c5f575fad1ea', position: 1, name: 'Link clicked' },
          replied:     { id: '2d1d953b-85d9-4540-8ba7-00d8ededf522', position: 2, name: 'Replied' },
        },
      },
    },
  },

  // Instantly campaign ID → pipeline key mapping
  campaignToPipeline: {
    'a6cafa42-cc9d-4806-b055-c5d17f3f3256': 'foodManEmail',       // Food man
    '73bb0368-902a-406b-a1e3-4273b76c6d34': 'enterpryzeEmail',     // Enterpryze
    '0dcb6b21-c54d-459d-b7f8-8de04aebd1c5': 'enterpryzeEmail',     // Qualified ERP Enterpryze
  },

  // Default pipeline if campaign ID not mapped
  defaultPipeline: 'foodManEmail',

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
