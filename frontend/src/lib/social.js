/** Host list stays aligned with core/github_enrich.py. */
import { githubProfileUrl } from './source';

const SOCIAL_HOSTS = [
  ['discord', ['discord.gg', 'discord.com', 'discordapp.com']],
  ['telegram', ['t.me', 'telegram.me', 'telegram.org']],
  ['whatsapp', ['wa.me', 'whatsapp.com', 'wa.link']],
  ['linkedin', ['linkedin.com']],
  ['x', ['x.com', 'twitter.com']],
  ['github', ['github.com']],
  ['facebook', ['facebook.com', 'fb.com', 'fb.me']],
  ['instagram', ['instagram.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['reddit', ['reddit.com']],
  ['twitch', ['twitch.tv']],
  ['stackoverflow', ['stackoverflow.com', 'stackexchange.com']],
  ['bluesky', ['bsky.app', 'bsky.social']],
  ['mastodon', ['mastodon.social', 'mastodon.online']],
  ['threads', ['threads.net', 'threads.com']],
  ['tiktok', ['tiktok.com']],
  ['medium', ['medium.com']],
  ['devto', ['dev.to']],
  ['gitlab', ['gitlab.com']],
  ['leetcode', ['leetcode.com', 'leetcode.cn']],
  ['codepen', ['codepen.io']],
  ['huggingface', ['huggingface.co']],
  ['npm', ['npmjs.com']],
  ['behance', ['behance.net']],
  ['dribbble', ['dribbble.com']],
  ['kaggle', ['kaggle.com']],
  ['hackerrank', ['hackerrank.com']],
  ['patreon', ['patreon.com']],
  ['substack', ['substack.com']],
  ['hashnode', ['hashnode.com', 'hashnode.dev']],
  ['orcid', ['orcid.org']],
  ['linktree', ['linktr.ee']],
  ['codeberg', ['codeberg.org']],
  ['scholar', ['scholar.google.com']],
  ['buymeacoffee', ['buymeacoffee.com']],
  ['kofi', ['ko-fi.com']],
  ['upwork', ['upwork.com']],
  ['fiverr', ['fiverr.com']],
  ['freelancer', ['freelancer.com']],
  ['guru', ['guru.com']],
  ['peopleperhour', ['peopleperhour.com']],
  ['toptal', ['toptal.com']],
  ['contra', ['contra.com']],
  ['malt', ['malt.com', 'malt.fr', 'malt.de', 'malt.es']],
  ['workana', ['workana.com']],
  ['credly', ['credly.com']],
  ['vk', ['vk.com']],
  ['xing', ['xing.com']],
  ['keybase', ['keybase.io']],
  ['matrix', ['matrix.to']],
  ['steam', ['steamcommunity.com']],
  ['researchgate', ['researchgate.net']],
  ['gdev', ['g.dev']],
  ['weibo', ['weibo.com']],
  ['zhihu', ['zhihu.com']],
  ['bilibili', ['bilibili.com']],
  ['spotify', ['open.spotify.com', 'spotify.com']],
  ['figma', ['figma.com']],
  ['codewars', ['codewars.com']],
  ['goodreads', ['goodreads.com']],
  ['farcaster', ['warpcast.com', 'farcaster.xyz']],
];

const hostMatches = (host, names) => names.some((name) => host === name || host.endsWith(`.${name}`));

export const recognizeProvider = (provider, url) => {
  const raw = String(provider || '').trim().toLowerCase();
  let host = '';
  try {
    host = new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    host = '';
  }
  if (raw === 'twitter' || raw === 'x' || hostMatches(host, ['x.com', 'twitter.com'])) return 'x';
  let named = '';
  for (const [id, hosts] of SOCIAL_HOSTS) {
    if (host && hostMatches(host, hosts)) return id;
    if (raw === id && !named) named = id;
  }
  if (named) return named;
  return raw && raw !== 'generic' ? raw : 'generic';
};

export const SOCIAL_ACCOUNT_FILTERS = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'x', label: 'X' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'bluesky', label: 'Bluesky' },
  { id: 'mastodon', label: 'Mastodon' },
  { id: 'threads', label: 'Threads' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'medium', label: 'Medium' },
  { id: 'stackoverflow', label: 'Stack Overflow' },
  { id: 'leetcode', label: 'LeetCode' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'npm', label: 'npm' },
  { id: 'huggingface', label: 'Hugging Face' },
  { id: 'upwork', label: 'Upwork' },
  { id: 'fiverr', label: 'Fiverr' },
  { id: 'freelancer', label: 'Freelancer' },
  { id: 'guru', label: 'Guru' },
  { id: 'peopleperhour', label: 'PeoplePerHour' },
  { id: 'toptal', label: 'Toptal' },
  { id: 'contra', label: 'Contra' },
  { id: 'malt', label: 'Malt' },
  { id: 'workana', label: 'Workana' },
  { id: 'other', label: 'Other' },
];

export const emptySocialFilters = () =>
  Object.fromEntries(SOCIAL_ACCOUNT_FILTERS.map((item) => [item.id, false]));

const SOCIAL_PLATFORM_LABELS = {
  x: 'x.com',
  telegram: 'Telegram',
  linkedin: 'Linkedin',
  whatsapp: 'Whatsapp',
  discord: 'Discord',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  reddit: 'Reddit',
  twitch: 'Twitch',
  mastodon: 'Mastodon',
  stackoverflow: 'Stack Overflow',
  bluesky: 'Bluesky',
  threads: 'Threads',
  tiktok: 'TikTok',
  medium: 'Medium',
  devto: 'dev.to',
  gitlab: 'GitLab',
  leetcode: 'LeetCode',
  codepen: 'CodePen',
  huggingface: 'Hugging Face',
  npm: 'npm',
  behance: 'Behance',
  dribbble: 'Dribbble',
  kaggle: 'Kaggle',
  hackerrank: 'HackerRank',
  patreon: 'Patreon',
  substack: 'Substack',
  hashnode: 'Hashnode',
  orcid: 'ORCID',
  linktree: 'Linktree',
  codeberg: 'Codeberg',
  scholar: 'Google Scholar',
  buymeacoffee: 'Buy Me a Coffee',
  kofi: 'Ko-fi',
  upwork: 'Upwork',
  fiverr: 'Fiverr',
  freelancer: 'Freelancer',
  guru: 'Guru',
  peopleperhour: 'PeoplePerHour',
  toptal: 'Toptal',
  contra: 'Contra',
  malt: 'Malt',
  workana: 'Workana',
  other: 'Other',
  credly: 'Credly',
  vk: 'VK',
  xing: 'Xing',
  keybase: 'Keybase',
  matrix: 'Matrix',
  steam: 'Steam',
  researchgate: 'ResearchGate',
  gdev: 'Google Dev',
  weibo: 'Weibo',
  zhihu: 'Zhihu',
  bilibili: 'Bilibili',
  spotify: 'Spotify',
  figma: 'Figma',
  codewars: 'Codewars',
  goodreads: 'Goodreads',
  farcaster: 'Farcaster',
  generic: 'Website',
};

export const socialProviderLabel = (provider) => {
  const name = String(provider || '').toLowerCase();
  return SOCIAL_PLATFORM_LABELS[name] || name || 'Social';
};

export const contactTone = (status) => {
  const value = String(status || 'not_sent').toLowerCase();
  if (value === 'sent') return 'sent';
  if (value === 'failed') return 'failed';
  return 'neutral';
};

export const socialCopyValue = (provider, url) => {
  const href = String(url || '').trim();
  let path = '';
  try {
    path = new URL(href).pathname.split('/').filter(Boolean).pop() || '';
  } catch {
    path = '';
  }
  if (provider === 'whatsapp') {
    const digits = href.replace(/\D/g, '');
    return { kind: 'phone', label: 'Phone', value: digits || href };
  }
  if (provider === 'telegram' || provider === 'x' || provider === 'instagram' || provider === 'tiktok' || provider === 'threads' || provider === 'bluesky' || provider === 'mastodon' || provider === 'reddit' || provider === 'npm') {
    return { kind: 'username', label: 'Username', value: path.replace(/^[@~]/, '') || href };
  }
  return { kind: 'link', label: 'Link', value: href };
};

export const telegramHandleFromSocial = (provider, url) => {
  if (String(provider || '').toLowerCase() === 'telegram') return '';
  const copy = socialCopyValue(provider, url);
  if (copy.kind !== 'username') return '';
  const handle = String(copy.value || '').trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9_]{1,32}$/.test(handle)) return '';
  return handle;
};

export const userHasTelegram = (user) =>
  socialItemsForUser(user).some((item) => item.provider === 'telegram');

export const socialItemsForUser = (user) => {
  const items = [];
  const seen = new Set();
  const sourceKeys = new Set();
  const rememberSource = (url) => {
    const key = String(url || '').trim().toLowerCase().replace(/\/$/, '');
    if (key) sourceKeys.add(key);
  };
  rememberSource(user.link);
  rememberSource(githubProfileUrl(user.github));
  const add = (provider, url, status) => {
    const name = recognizeProvider(provider, url);
    if (name === 'github' || name === 'devto') return;
    const href = String(url || '').trim();
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;
    const key = href.toLowerCase().replace(/\/$/, '');
    if (sourceKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    const tone = String(status || '').toLowerCase();
    items.push({
      provider: name,
      url: href,
      status: tone === 'sent' || tone === 'failed' ? tone : 'not_sent',
    });
  };
  for (const link of Array.isArray(user.socials) ? user.socials : []) {
    add(link?.provider, link?.url, link?.status);
  }
  return items;
};
