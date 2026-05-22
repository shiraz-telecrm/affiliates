module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      TELECRM_ENTERPRISE_ID: !!process.env.TELECRM_ENTERPRISE_ID,
      TELECRM_SYNC_TOKEN:    !!process.env.TELECRM_SYNC_TOKEN,
    },
  });
};
