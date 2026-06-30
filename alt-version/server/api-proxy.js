export function apiProxyPlugin() {
  return {
    name: 'local-api-proxy',
    configureServer(server) {
      server.middlewares.use('/api/chat/completions', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        try {
          const rawBody = await readBody(req);
          const { targetUrl, apiKey, payload } = JSON.parse(rawBody || '{}');

          if (!targetUrl || !apiKey || !payload) {
            res.statusCode = 400;
            res.end('Missing targetUrl, apiKey, or payload');
            return;
          }

          const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });

          const text = await upstream.text();
          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
          res.end(text);
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { message: error.message || 'Proxy request failed' } }));
        }
      });
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
