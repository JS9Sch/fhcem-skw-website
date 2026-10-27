import { authenticated } from './auth.js';

function googleURL(value, embed = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) throw new Error('Invalid source');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['docs.google.com', 'drive.google.com'].includes(url.hostname)) throw new Error('Invalid source');
  if (embed && (url.hostname !== 'docs.google.com' ||
      !/^\/spreadsheets\/d\/[A-Za-z0-9_-]+\/pub(?:html(?:\/sheet)?)?$/.test(url.pathname))) throw new Error('Invalid embed');
  return url.href;
}

function sources(raw) {
  if (typeof raw !== 'string' || raw.length > 32000) throw new Error('Missing sources');
  const config = JSON.parse(raw), sermon = config.sermons;
  if (!Array.isArray(sermon?.tabs) || !sermon.tabs.length || sermon.tabs.length > 50) throw new Error('Invalid tabs');
  return {
    sermons: {
      url: googleURL(sermon.url), embedUrl: googleURL(sermon.embedUrl, true),
      tabs: sermon.tabs.map(tab => {
        if (!/^(?:\d{4}|講座)$/.test(tab.label)) throw new Error('Invalid label');
        return { label: tab.label, url: googleURL(tab.url, true) };
      })
    },
    weekly: { url: googleURL(config.weekly?.url) },
    monthly: { url: googleURL(config.monthly?.url) },
    photos: { url: googleURL(config.photos?.url) }
  };
}

export async function memberResources(request, env) {
  const reply = (value, status) => new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
  if (!await authenticated(request, env)) return reply({ error: 'authentication_required' }, 401);
  let data;
  try { data = sources(env.MEMBER_RESOURCES); }
  catch { return reply({ error: 'resources_unavailable' }, 503); }
  return reply(data, 200);
}
