// Vercel serverless function: GET /api/turn -> { iceServers: [...] }
// Hands the game short-lived Cloudflare TURN credentials, so players whose routers block direct (peer-to-peer)
// connections can still join through Cloudflare's relay. The Cloudflare key never ships in the game file:
// set CF_TURN_KEY_ID and CF_TURN_API_TOKEN in the Vercel project's environment variables.
// Copied into release/public/api/turn.mjs by `release.mjs publish`.
let cache = null;   // { at, body } reused briefly per warm instance

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');          // downloaded copies run from disk (origin "null")
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return res.status(200).json({ iceServers: [], note: 'TURN not configured' });
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return res.status(200).json(cache.body);
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 6 * 3600 }),
    });
    if (!r.ok) return res.status(502).json({ iceServers: [], error: 'cloudflare ' + r.status });
    const j = await r.json();
    // Cloudflare returns { iceServers: {urls,username,credential} } or an array of them
    const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    // browsers slow down on more than ~4 URLs: keep UDP 3478 (normal), TCP 80 and TLS 443 (strict firewalls / school / work
    // networks). The game already has STUN servers of its own, so Cloudflare's STUN entry is dropped.
    const keep = u => /^turn:.*:3478\?transport=udp$/.test(u) || /^turn:.*:80\?transport=tcp$/.test(u) || /^turns:.*:443\?transport=tcp$/.test(u);
    const body = { iceServers: list.map(s => ({ ...s, urls: [].concat(s.urls).filter(keep) })).filter(s => s.urls.length && s.username) };
    cache = { at: Date.now(), body };
    return res.status(200).json(body);
  } catch (e) {
    return res.status(502).json({ iceServers: [], error: String(e && e.message || e) });
  }
}
