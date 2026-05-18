// functions/_lib.js
// ─────────────────────────────────────────────────────────────────────────────
// Helpers communs aux Cloudflare Pages Functions :
//   - getSupabaseConfig(env)      : URL + clé anon depuis env vars (avec fallback)
//   - sbFetch(env, path, opts)    : fetch authentifie vers Supabase REST
//   - escapeHtml / escapeXml      : escape pour injection HTML/XML
//   - isBotUA(userAgent)          : detecte les bots de partage (FB, WhatsApp, Twitter, etc.)
// ─────────────────────────────────────────────────────────────────────────────

export function getSupabaseConfig(env) {
  return {
    url: env.SUPABASE_URL || 'https://qxhhnrnworwrnwmqekmb.supabase.co',
    key: env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aGhucm53b3J3cm53bXFla21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTExMzYsImV4cCI6MjA5NDA4NzEzNn0.l_7-Eg06UFnXvSw1BQiuNw0yU94jillHNycx-jvP1Aw',
  };
}

export async function sbFetch(env, path, opts = {}) {
  const { url, key } = getSupabaseConfig(env);
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase REST ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Bots qui scrapent les og: tags sans executer JS.
// On les sert HTML server-side avec les vrais meta tags.
// (Pour Googlebot on laisse aussi passer car ca rend l'indexation plus fiable.)
const BOT_REGEX = /facebookexternalhit|whatsapp|twitterbot|linkedinbot|telegrambot|slackbot|discordbot|googlebot|bingbot|applebot|duckduckbot|baiduspider|yandex/i;

export function isBotUA(userAgent) {
  return BOT_REGEX.test(userAgent || '');
}

// Construit un fragment HTML <head> avec les meta tags og:/twitter:/title/description.
// Reutilise par les functions /product/[id] et /pharmacy/[id].
export function buildMetaTags({ title, description, image, url, type = 'website' }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  const u = escapeHtml(url);
  return `
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${u}" />
  <meta property="og:site_name" content="YARAM" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:image" content="${i}" />
  <meta property="og:url" content="${u}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:locale" content="fr_SN" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${i}" />
  `.trim();
}

// Remplace les meta tags par defaut dans le index.html par les nouveaux.
// Strategie : on retire les balises og:/twitter:/title/description/canonical existantes,
// puis on injecte les nouvelles juste avant </head>.
export function injectMetaTags(html, metaHtml) {
  let out = html;
  // Remove existing tags (best-effort — pas de DOM parser dans Workers runtime)
  out = out
    .replace(/<title>[^<]*<\/title>/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+(?:property|name)=["'](?:og|twitter):[^"']*["'][^>]*>/gi, '');
  // Inject new ones just before </head>
  out = out.replace('</head>', metaHtml + '\n</head>');
  return out;
}
