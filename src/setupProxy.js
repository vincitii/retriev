const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api/anthropic',
    createProxyMiddleware({
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      pathRewrite: { '^/api/anthropic': '/v1/complete' },
      secure: true,
      onProxyReq(proxyReq, req, res) {
        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.REACT_APP_ANTHROPIC_API_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.end('Anthropic API key is missing on the proxy server. Set ANTHROPIC_API_KEY in your .env.');
          return;
        }
        proxyReq.setHeader('X-API-Key', apiKey);
      },
    })
  );
};