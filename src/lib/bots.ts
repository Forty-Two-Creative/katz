/**
 * Detects automated traffic so it isn't recorded as a click.
 *
 * Short links attract a lot of non-human traffic: every time someone pastes a
 * link into WhatsApp, Slack or Telegram, the platform fetches it to build a
 * preview. Those fetches inflate the analytics and, before clicks were
 * buffered, each one also woke the database.
 *
 * Note that bots are still redirected — link previews depend on it. They're
 * just not counted.
 */
const BOT_PATTERNS = [
  // Link preview / unfurling
  "facebookexternalhit",
  "whatsapp",
  "telegrambot",
  "twitterbot",
  "slackbot",
  "slack-imgproxy",
  "discordbot",
  "linkedinbot",
  "skypeuripreview",
  "embedly",
  "quora link preview",
  "pinterest",
  "redditbot",
  "vkshare",
  "viber",
  "line/",
  "googledocs",
  // Search engines
  "googlebot",
  "bingbot",
  "yandex",
  "duckduckbot",
  "baiduspider",
  "applebot",
  "petalbot",
  // SEO / marketing crawlers
  "ahrefsbot",
  "semrushbot",
  "mj12bot",
  "dotbot",
  "screaming frog",
  // Monitoring and previews
  "uptimerobot",
  "pingdom",
  "statuscake",
  "lighthouse",
  "headlesschrome",
  "vercel-screenshot",
  "vercelbot",
  // Generic HTTP clients
  "curl/",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "okhttp",
  "axios/",
  "node-fetch",
  "got (",
  "java/",
  "libwww-perl",
  "postmanruntime",
  // Catch-alls, kept last
  "bot",
  "crawler",
  "spider",
  "scraper",
] as const;

/** True when the user-agent looks automated rather than human. */
export function isBot(userAgent: string | null): boolean {
  // A missing UA is almost always a script or a scanner.
  if (!userAgent) return true;
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((p) => ua.includes(p));
}
