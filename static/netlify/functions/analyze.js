// netlify/functions/analyze.js
// Proxies requests from the web page to the Anthropic API.
// The API key lives in the Netlify environment variable ANTHROPIC_API_KEY
// and is never exposed to the browser.

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOKENS_CAP = 1500;

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not set on the server' });
  }

  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body || '{}';
    payload = JSON.parse(raw);
  } catch (e) {
    return json(400, { error: 'Invalid JSON body' });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json(400, { error: 'messages is required' });
  }

  const body = {
    model: MODEL, // model is chosen on the server; any model sent by the browser is ignored
    max_tokens: Math.min(Number(payload.max_tokens) || 1000, MAX_TOKENS_CAP),
    messages: payload.messages,
  };
  if (typeof payload.system === 'string' && payload.system.trim()) {
    body.system = payload.system;
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    return json(502, { error: 'Upstream request failed: ' + e.message });
  }
};
