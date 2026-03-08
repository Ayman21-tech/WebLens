
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8787);
const projectRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(projectRoot, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const stopwords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he", "in", "is", "it",
  "its", "of", "on", "that", "the", "to", "was", "were", "will", "with", "you", "your", "this", "we",
  "our", "or", "us", "about", "into", "can", "all", "not", "more", "new", "get", "use", "using", "how"
]);

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (req.method === "POST" && pathname === "/api/analyze") {
      const payload = await parseJson(req);
      const inputUrl = payload?.url;

      if (!inputUrl || typeof inputUrl !== "string") {
        sendJson(res, 400, { ok: false, error: "Please provide a valid URL." });
        return;
      }

      const normalizedUrl = normalizeUrl(inputUrl);
      const scrape = await scrapeWebsite(normalizedUrl);
      const heuristic = generateHeuristicAnalysis(scrape);
      const aiAnalysis = await generateAiAnalysis(scrape, heuristic);
      const analysis = mergeAnalysis(heuristic, aiAnalysis?.analysis || {});
      const blueprint = mergeBlueprint(heuristic.blueprint, aiAnalysis?.blueprint || {});

      sendJson(res, 200, {
        ok: true,
        data: {
          source: scrape.source,
          url: scrape.url,
          domain: scrape.domain,
          screenshotUrl: buildScreenshotUrl(scrape.url),
          scraped: {
            title: scrape.title,
            description: scrape.description,
            headings: scrape.headings,
            textPreview: scrape.textPreview,
            textWordCount: scrape.wordCount,
            images: scrape.images,
            links: scrape.links,
            internalLinks: scrape.internalLinks,
            externalLinks: scrape.externalLinks,
            keywords: scrape.keywords,
            seoSignals: scrape.seoSignals
          },
          analysis,
          blueprint
        }
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/ask") {
      const payload = await parseJson(req);
      const question = typeof payload?.question === "string" ? payload.question.trim() : "";
      const context = payload?.context || {};

      if (!question) {
        sendJson(res, 400, { ok: false, error: "Question cannot be empty." });
        return;
      }

      const answer = await answerFollowUp(question, context);
      sendJson(res, 200, { ok: true, data: { answer } });
      return;
    }

    if (req.method === "GET") {
      if (pathname === "/") {
        serveFile(res, join(publicRoot, "index.html"));
        return;
      }

      if (pathname === "/analyze") {
        serveFile(res, join(publicRoot, "analyze.html"));
        return;
      }

      if (pathname === "/about") {
        serveFile(res, join(publicRoot, "about.html"));
        return;
      }

      if (pathname === "/docs") {
        serveFile(res, join(publicRoot, "docs.html"));
        return;
      }

      const safePath = normalize(pathname)
        .replace(/^([.][.][/\\])+/, "")
        .replace(/^[/\\]+/, "");
      const filePath = join(publicRoot, safePath);
      if (filePath.startsWith(publicRoot) && existsSync(filePath) && !statSync(filePath).isDirectory()) {
        serveFile(res, filePath);
        return;
      }
    }

    sendJson(res, 404, { ok: false, error: "Not Found" });
  } catch (error) {
    const status = error?.statusCode || 500;
    const message = error?.message || "Unexpected error";
    sendJson(res, status, { ok: false, error: message });
  }
}).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WebLens running at http://localhost:${port}`);
});

function serveFile(res, filePath) {
  const contentType = mime[extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function parseJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON payload.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeUrl(value) {
  const raw = value.trim();
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    const error = new Error("Invalid URL format.");
    error.statusCode = 400;
    throw error;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("Only HTTP(S) URLs are supported.");
    error.statusCode = 400;
    throw error;
  }

  if (isPrivateOrLocal(parsed.hostname)) {
    const error = new Error("Local or private network URLs are blocked for security.");
    error.statusCode = 400;
    throw error;
  }

  return parsed.href;
}

function isPrivateOrLocal(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") {
    return true;
  }

  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }

  const match172 = /^172\.(\d+)\./.exec(host);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (/^(0|169\.254)\./.test(host)) {
    return true;
  }

  return false;
}

async function scrapeWebsite(targetUrl) {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    try {
      return await scrapeWithFirecrawl(targetUrl, firecrawlKey);
    } catch {
      // Fall through to native scraper if Firecrawl is unavailable or quota-limited.
    }
  }

  return scrapeNatively(targetUrl);
}

async function scrapeWithFirecrawl(url, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url,
      formats: ["html"]
    })
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error("Firecrawl scraping failed.");
  }

  const payload = await response.json();
  const html = payload?.data?.html;
  if (!html || typeof html !== "string") {
    throw new Error("Firecrawl returned empty HTML.");
  }

  const finalUrl = payload?.data?.metadata?.sourceURL || url;
  return extractPageData(html, finalUrl, response.headers, "firecrawl");
}

async function scrapeNatively(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "User-Agent": "WebLensBot/1.0 (+https://weblens.local)",
      Accept: "text/html,application/xhtml+xml"
    }
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const error = new Error(`Failed to fetch website (HTTP ${response.status}).`);
    error.statusCode = 400;
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    const error = new Error("URL did not return HTML content.");
    error.statusCode = 400;
    throw error;
  }

  const html = await response.text();
  return extractPageData(html, response.url || url, response.headers, "native");
}

function extractPageData(html, finalUrl, headers, source) {
  const title = decodeHtmlEntities(captureFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || "").trim();
  const description = decodeHtmlEntities(captureFirst(html, /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i)
    || captureFirst(html, /<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i)
    || "").trim();

  const headings = extractHeadings(html);
  const images = extractImages(html, finalUrl);
  const links = extractLinks(html, finalUrl);
  const text = extractTextContent(html);
  const keywords = extractTopKeywords(text, 12);
  const technologies = detectTechnologies(html, headers);
  const seoSignals = extractSeoSignals(html, title, description, headings, links, text, keywords);

  return {
    source,
    url: finalUrl,
    domain: new URL(finalUrl).hostname,
    html,
    title,
    description,
    headings,
    images,
    links: links.items,
    internalLinks: links.internalCount,
    externalLinks: links.externalCount,
    textPreview: text.slice(0, 1500),
    wordCount: countWords(text),
    keywords,
    technologies,
    seoSignals
  };
}

function extractHeadings(html) {
  const results = [];
  const regex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;

  while ((match = regex.exec(html)) && results.length < 40) {
    const text = cleanInlineText(match[2]);
    if (text) {
      results.push({ level: `h${match[1]}`, text });
    }
  }

  return results;
}

function extractImages(html, baseUrl) {
  const results = [];
  const seen = new Set();
  const regex = /<img\b[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) && results.length < 30) {
    const tag = match[0];
    const src = getAttr(tag, "src") || getAttr(tag, "data-src") || getAttr(tag, "data-lazy-src");
    if (!src) {
      continue;
    }

    const absoluteSrc = resolveMaybeRelative(src, baseUrl);
    if (!absoluteSrc || seen.has(absoluteSrc)) {
      continue;
    }

    seen.add(absoluteSrc);
    results.push({
      src: absoluteSrc,
      alt: cleanInlineText(getAttr(tag, "alt") || "")
    });
  }

  return results;
}

function extractLinks(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const regex = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let internalCount = 0;
  let externalCount = 0;
  const pageHost = new URL(baseUrl).hostname;

  while ((match = regex.exec(html)) && items.length < 80) {
    const hrefRaw = match[1] || match[2] || match[3] || "";
    if (!hrefRaw || hrefRaw.startsWith("#") || hrefRaw.startsWith("javascript:") || hrefRaw.startsWith("mailto:") || hrefRaw.startsWith("tel:")) {
      continue;
    }

    const href = resolveMaybeRelative(hrefRaw, baseUrl);
    if (!href || seen.has(href)) {
      continue;
    }

    seen.add(href);

    const host = safeHostname(href);
    if (host && host === pageHost) {
      internalCount += 1;
    } else {
      externalCount += 1;
    }

    items.push({
      href,
      text: cleanInlineText(match[4]).slice(0, 120)
    });
  }

  return { items, internalCount, externalCount };
}

function extractTextContent(html) {
  const body = captureFirst(html, /<body[^>]*>([\s\S]*?)<\/body>/i) || html;
  const withoutScripts = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ");

  return cleanInlineText(withoutScripts.replace(/<[^>]+>/g, " "));
}

function extractTopKeywords(text, limit = 10) {
  const counts = new Map();

  for (const token of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (!token || token.length < 4 || stopwords.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}
function detectTechnologies(html, headers) {
  const haystack = html.toLowerCase();
  const headerValues = [
    headers.get?.("x-powered-by"),
    headers.get?.("server"),
    headers.get?.("cf-cache-status")
  ].filter(Boolean).join(" ").toLowerCase();

  const signals = [
    ["WordPress", /wp-content|wp-includes|wordpress/i],
    ["Shopify", /cdn\.shopify\.com|shopify-payment-button|shopify-section/i],
    ["Wix", /wixstatic\.com|wix\.com/i],
    ["Webflow", /webflow\.js|webflow\.com/i],
    ["Squarespace", /squarespace\.com|static\.squarespace\.com/i],
    ["Next.js", /_next\/static|__next_data__|id=\"__next\"/i],
    ["Nuxt", /_nuxt\//i],
    ["React", /react(?:\.production)?(?:\.min)?\.js|data-reactroot/i],
    ["Vue", /vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js|id=\"__nuxt\"/i],
    ["Angular", /ng-version|angular(?:\.min)?\.js/i],
    ["Bootstrap", /bootstrap(?:\.min)?\.(?:css|js)/i],
    ["Tailwind CSS", /tailwindcss|cdn\.tailwindcss\.com/i],
    ["jQuery", /jquery(?:-[\d.]+)?(?:\.min)?\.js/i],
    ["Cloudflare", /cloudflare|cf-ray/i],
    ["Google Analytics", /googletagmanager\.com|gtag\(/i],
    ["Hotjar", /hotjar/i],
    ["Stripe", /stripe\.com\/v3|js\.stripe\.com/i],
    ["Vercel", /x-vercel-id|vercel/i]
  ];

  const detected = [];
  for (const [name, pattern] of signals) {
    if (pattern.test(haystack) || pattern.test(headerValues)) {
      detected.push(name);
    }
  }

  if (!detected.length) {
    detected.push("Custom/Undetermined stack");
  }

  return detected;
}

function extractSeoSignals(html, title, description, headings, links, text, keywords) {
  const canonical = captureFirst(html, /<link\s+rel=[\"']canonical[\"']\s+href=[\"']([^\"']+)[\"']/i)
    || captureFirst(html, /<link\s+href=[\"']([^\"']+)[\"']\s+rel=[\"']canonical[\"']/i)
    || null;
  const openGraphCount = (html.match(/<meta\s+property=[\"']og:/gi) || []).length;
  const twitterCardCount = (html.match(/<meta\s+name=[\"']twitter:/gi) || []).length;
  const ldJsonCount = (html.match(/application\/ld\+json/gi) || []).length;
  const h1Count = headings.filter((h) => h.level === "h1").length;
  const hasPricingPage = links.items.some((l) => /pricing|plans|subscribe/i.test(`${l.text} ${l.href}`));
  const hasBlog = links.items.some((l) => /blog|news|articles/i.test(`${l.text} ${l.href}`));
  const hasDocs = links.items.some((l) => /docs|documentation|api/i.test(`${l.text} ${l.href}`));

  return {
    titleLength: title.length,
    descriptionLength: description.length,
    h1Count,
    canonical,
    openGraphCount,
    twitterCardCount,
    ldJsonCount,
    hasPricingPage,
    hasBlog,
    hasDocs,
    topKeywords: keywords.slice(0, 8).map((entry) => entry.keyword),
    contentDepth: countWords(text)
  };
}

function generateHeuristicAnalysis(scrape) {
  const techGuess = scrape.technologies;
  const businessModel = inferBusinessModel(scrape);
  const likelyFeatures = inferLikelyFeatures(scrape);
  const targetAudience = inferTargetAudience(scrape);
  const improvementIdeas = inferImprovementIdeas(scrape, businessModel);
  const marketingIdeas = inferMarketingIdeas(scrape);
  const seoStrategy = inferSeoStrategy(scrape);
  const competitorIdeas = inferCompetitorIdeas(scrape);
  const trafficSources = estimateTrafficSources(scrape);
  const startupIdea = inferStartupIdea(scrape);

  return {
    purpose: inferPurpose(scrape),
    targetAudience,
    businessModel,
    likelyFeatures,
    techGuess,
    improvementIdeas,
    marketingIdeas,
    seoStrategy,
    competitorIdeas,
    startupIdea,
    trafficSources,
    blueprint: buildBlueprint(scrape, likelyFeatures, businessModel)
  };
}

function mergeAnalysis(base, incoming) {
  return {
    purpose: valueOr(base.purpose, incoming.purpose),
    targetAudience: mergeArray(base.targetAudience, incoming.targetAudience),
    businessModel: mergeArray(base.businessModel, incoming.businessModel),
    likelyFeatures: mergeArray(base.likelyFeatures, incoming.likelyFeatures),
    techGuess: mergeArray(base.techGuess, incoming.techGuess),
    improvementIdeas: mergeArray(base.improvementIdeas, incoming.improvementIdeas),
    marketingIdeas: mergeArray(base.marketingIdeas, incoming.marketingIdeas),
    seoStrategy: mergeArray(base.seoStrategy, incoming.seoStrategy),
    competitorIdeas: mergeArray(base.competitorIdeas, incoming.competitorIdeas),
    startupIdea: valueOr(base.startupIdea, incoming.startupIdea),
    trafficSources: mergeArray(base.trafficSources, incoming.trafficSources)
  };
}

function mergeBlueprint(base, incoming) {
  return {
    frontend: mergeArray(base.frontend, incoming.frontend),
    backend: mergeArray(base.backend, incoming.backend),
    monetization: mergeArray(base.monetization, incoming.monetization),
    architectureNotes: mergeArray(base.architectureNotes, incoming.architectureNotes)
  };
}

function valueOr(base, incoming) {
  if (typeof incoming === "string" && incoming.trim()) {
    return incoming.trim();
  }
  return base;
}

function mergeArray(base, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) {
    return base;
  }

  const normalized = incoming
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);

  return normalized.length ? normalized : base;
}
async function generateAiAnalysis(scrape, heuristic) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const prompt = [
    "Analyze this website and return JSON only.",
    `URL: ${scrape.url}`,
    `Title: ${scrape.title || "N/A"}`,
    `Description: ${scrape.description || "N/A"}`,
    `Top headings: ${scrape.headings.slice(0, 10).map((h) => `${h.level}: ${h.text}`).join(" | ")}`,
    `Keyword signals: ${scrape.keywords.map((k) => `${k.keyword} (${k.count})`).join(", ")}`,
    `Detected technologies: ${scrape.technologies.join(", ")}`,
    `Link counts: internal ${scrape.internalLinks}, external ${scrape.externalLinks}`,
    `Text sample: ${scrape.textPreview.slice(0, 1200)}`,
    "Return keys: analysis (object), blueprint (object).",
    "analysis keys: purpose (string), targetAudience (string[]), businessModel (string[]), likelyFeatures (string[]), techGuess (string[]), improvementIdeas (string[]), marketingIdeas (string[]), seoStrategy (string[]), competitorIdeas (string[]), startupIdea (string), trafficSources (string[]).",
    "blueprint keys: frontend (string[]), backend (string[]), monetization (string[]), architectureNotes (string[]).",
    "Make output practical and concise. Do not use markdown."
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a startup analyst. Return strict JSON with no extra keys."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return null;
    }

    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      analysis: { ...heuristic, ...(parsed.analysis || {}) },
      blueprint: { ...heuristic.blueprint, ...(parsed.blueprint || {}) }
    };
  } catch {
    return null;
  }
}

async function answerFollowUp(question, context) {
  const apiKey = process.env.OPENAI_API_KEY;
  const contextSummary = JSON.stringify(context).slice(0, 9000);

  if (!apiKey) {
    return heuristicFollowUp(question, context);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "You answer follow-up questions about one website analysis. Be specific, practical, and concise."
          },
          {
            role: "user",
            content: `Context JSON: ${contextSummary}\n\nQuestion: ${question}`
          }
        ]
      })
    });

    if (!response.ok) {
      return heuristicFollowUp(question, context);
    }

    const payload = await response.json();
    const answer = payload?.choices?.[0]?.message?.content;
    if (!answer || typeof answer !== "string") {
      return heuristicFollowUp(question, context);
    }

    return answer.trim();
  } catch {
    return heuristicFollowUp(question, context);
  }
}

function heuristicFollowUp(question, context) {
  const q = question.toLowerCase();
  const analysis = context?.analysis || {};
  const blueprint = context?.blueprint || {};

  if (q.includes("money") || q.includes("revenue") || q.includes("monet")) {
    const models = (analysis.businessModel || []).join("; ");
    return models ? `Likely monetization paths: ${models}.` : "Likely monetization is not clear from this page, but subscription + ads + affiliate are common options.";
  }

  if (q.includes("tech") || q.includes("stack") || q.includes("built")) {
    const stack = (analysis.techGuess || []).join(", ");
    return stack ? `Most likely stack signals: ${stack}.` : "The visible signals are limited, so the stack is likely custom with common web tooling.";
  }

  if (q.includes("build") || q.includes("clone") || q.includes("competitor")) {
    const front = (blueprint.frontend || []).slice(0, 4).join("; ");
    const back = (blueprint.backend || []).slice(0, 4).join("; ");
    return `Build path: Frontend -> ${front}. Backend -> ${back}. Start with core workflow first, then add monetization.`;
  }

  return "Based on the extracted signals, focus on clear positioning, stronger conversion pages, and a measurable acquisition loop (SEO + content + email capture).";
}
function inferPurpose(scrape) {
  if (scrape.description) {
    return scrape.description;
  }

  if (scrape.headings.length) {
    return `The site appears focused on ${scrape.headings[0].text.toLowerCase()}.`;
  }

  return "The website appears to provide informational or commercial web content for a specific audience.";
}

function inferTargetAudience(scrape) {
  const text = `${scrape.title} ${scrape.description} ${scrape.textPreview}`.toLowerCase();
  const audience = [];

  if (/developer|api|sdk|docs|engineering/.test(text)) {
    audience.push("Developers and technical teams");
  }
  if (/business|enterprise|company|team|workflow|productivity/.test(text)) {
    audience.push("Business teams and decision-makers");
  }
  if (/shop|cart|checkout|buy|product|store/.test(text)) {
    audience.push("Online shoppers");
  }
  if (/learn|course|tutorial|academy|student/.test(text)) {
    audience.push("Learners and students");
  }
  if (/creator|community|video|blog|content/.test(text)) {
    audience.push("Creators and content consumers");
  }

  if (!audience.length) {
    audience.push("General internet users interested in this niche");
  }

  return audience;
}

function inferBusinessModel(scrape) {
  const text = `${scrape.title} ${scrape.description} ${scrape.textPreview}`.toLowerCase();
  const html = scrape.html.toLowerCase();
  const models = [];

  if (/adsbygoogle|doubleclick|googlesyndication|adservice/.test(html)) {
    models.push("Advertising (display ad network integration signals detected)");
  }
  if (/pricing|plan|subscription|subscribe|trial|monthly|yearly|billing/.test(text)) {
    models.push("Subscription SaaS (pricing/plan language present)");
  }
  if (/affiliate|referral|partner link|commission|amazon\./.test(text + html)) {
    models.push("Affiliate revenue (partner/referral language appears)");
  }
  if (/shop|checkout|buy now|cart|store|product/.test(text)) {
    models.push("Ecommerce sales (product and checkout style language)");
  }
  if (/book demo|contact sales|request demo|consulting/.test(text)) {
    models.push("Lead generation for services or enterprise sales");
  }
  if (/sponsor|sponsored|newsletter/.test(text)) {
    models.push("Media/content monetization (sponsorships/newsletter)");
  }

  if (!models.length) {
    models.push("Likely hybrid model: content + conversion funnel + premium upsell");
  }

  return models;
}

function inferLikelyFeatures(scrape) {
  const text = `${scrape.title} ${scrape.description} ${scrape.textPreview}`.toLowerCase();
  const links = scrape.links.map((item) => `${item.text} ${item.href}`.toLowerCase()).join(" ");
  const features = [];

  if (/login|sign in|account/.test(text + links)) {
    features.push("User authentication and account management");
  }
  if (/dashboard|workspace|portal/.test(text + links)) {
    features.push("Personalized dashboard/workspace");
  }
  if (/search/.test(text + links)) {
    features.push("Search and discovery");
  }
  if (/pricing|plans|billing/.test(text + links)) {
    features.push("Pricing and billing flow");
  }
  if (/blog|articles|news|resources/.test(text + links)) {
    features.push("Content publishing / resource center");
  }
  if (/comment|community|forum/.test(text + links)) {
    features.push("Community or engagement features");
  }
  if (/api|developer|docs/.test(text + links)) {
    features.push("Developer API/docs surface");
  }

  if (!features.length) {
    features.push("Core landing pages with lead capture");
    features.push("Navigation and conversion-focused CTA flow");
  }

  return features;
}

function inferImprovementIdeas(scrape, businessModel) {
  const ideas = [
    "Tighten the homepage value proposition so users understand the offer in under 5 seconds.",
    "Add a stronger call-to-action hierarchy (primary, secondary, and trust indicators)."
  ];

  if (!scrape.seoSignals.hasPricingPage && /subscription|saas/i.test(businessModel.join(" "))) {
    ideas.push("Publish a transparent pricing page with plan comparison and FAQ.");
  }

  if (!scrape.seoSignals.hasBlog) {
    ideas.push("Add a content hub to capture long-tail search traffic.");
  }

  if (scrape.seoSignals.h1Count !== 1) {
    ideas.push("Normalize H1 structure (one H1 per page) to improve clarity and SEO.");
  }

  return ideas.slice(0, 6);
}

function inferMarketingIdeas(scrape) {
  const ideas = [
    "Build a problem-based SEO cluster around high-intent keywords from this niche.",
    "Capture emails with a lead magnet tied to the core user job-to-be-done.",
    "Ship comparison pages (your-product-vs-competitor) for conversion intent."
  ];

  if (/video|youtube|stream/.test(scrape.textPreview.toLowerCase())) {
    ideas.push("Run short-form content distribution on YouTube Shorts, TikTok, and Reels.");
  }

  if (/developer|api|sdk/.test(scrape.textPreview.toLowerCase())) {
    ideas.push("Launch developer tutorials and integration case studies to reduce adoption friction.");
  }

  return ideas.slice(0, 6);
}

function inferSeoStrategy(scrape) {
  const signals = scrape.seoSignals;
  const strategy = [];

  strategy.push(`Title length: ${signals.titleLength} chars; description length: ${signals.descriptionLength} chars.`);

  if (!signals.canonical) {
    strategy.push("Add canonical tags to avoid duplicate-indexing issues.");
  }
  if (signals.openGraphCount === 0) {
    strategy.push("Add Open Graph tags for better link previews and CTR from social.");
  }
  if (signals.twitterCardCount === 0) {
    strategy.push("Add Twitter Card metadata for richer social distribution.");
  }
  if (signals.ldJsonCount === 0) {
    strategy.push("Add JSON-LD structured data to improve SERP understanding.");
  }

  strategy.push(`Keyword focus candidates: ${signals.topKeywords.slice(0, 5).join(", ") || "not enough visible content"}.`);

  return strategy.slice(0, 6);
}
function inferCompetitorIdeas(scrape) {
  const domain = scrape.domain;
  const ideas = [
    `Build a narrower niche variant of ${domain} with one specific user segment focus.`,
    "Offer a simpler onboarding path and faster time-to-value than broad competitors.",
    "Differentiate with transparent pricing and stronger use-case templates."
  ];

  if (/enterprise|business|team/.test(scrape.textPreview.toLowerCase())) {
    ideas.push("Create an SMB-focused version with self-serve onboarding and lower pricing.");
  }

  if (/creator|content|video|community/.test(scrape.textPreview.toLowerCase())) {
    ideas.push("Compete with creator-friendly analytics and monetization tooling.");
  }

  return ideas.slice(0, 6);
}

function inferStartupIdea(scrape) {
  const topKeyword = scrape.keywords[0]?.keyword || "workflow";
  return `Launch a micro-SaaS focused on \"${topKeyword}\" with AI-assisted setup, template-driven onboarding, and a weekly optimization report.`;
}

function estimateTrafficSources(scrape) {
  const signals = {
    seo: 30,
    direct: 20,
    social: 15,
    referrals: 15,
    email: 10,
    paid: 10
  };

  if (scrape.seoSignals.hasBlog) {
    signals.seo += 15;
  }
  if (scrape.links.some((l) => /twitter|x\.com|facebook|instagram|linkedin|youtube|tiktok/i.test(l.href))) {
    signals.social += 15;
  }
  if (scrape.textPreview.toLowerCase().includes("newsletter")) {
    signals.email += 10;
  }
  if (/googleads|doubleclick|adservice/.test(scrape.html.toLowerCase())) {
    signals.paid += 10;
  }

  const total = Object.values(signals).reduce((sum, value) => sum + value, 0);

  return Object.entries(signals)
    .map(([channel, score]) => {
      const pct = Math.round((score / total) * 100);
      return `${capitalize(channel)}: ${pct}% estimated`;
    })
    .sort((a, b) => Number(b.match(/(\d+)%/)?.[1] || 0) - Number(a.match(/(\d+)%/)?.[1] || 0));
}

function buildBlueprint(scrape, likelyFeatures, businessModel) {
  const mainFeature = likelyFeatures[0] || "Core user workflow";
  const modelSummary = businessModel[0] || "Subscription";

  return {
    frontend: [
      "Landing page with clear value proposition and URL analyzer form",
      "Pricing page with plan comparison and conversion-focused FAQs",
      "Dashboard page with cards for insights, SEO, and competitor opportunities",
      `Feature module for: ${mainFeature}`
    ],
    backend: [
      "Authentication (email/password + OAuth)",
      "Database for users, analyses history, and saved reports",
      "Scraping service (fetch + parser + queue for heavier pages)",
      "AI orchestration API for analysis + follow-up chat",
      "Usage limits and billing enforcement"
    ],
    monetization: [
      `Primary: ${modelSummary}`,
      "Pro tier: deeper analysis, export, and weekly monitoring",
      "Add-on: API access for agencies and growth teams",
      "Optional: affiliate partnerships with tools recommended in insights"
    ],
    architectureNotes: [
      "Use a job queue for long-running crawls and retries.",
      "Cache scrape snapshots to reduce repeated fetch costs.",
      "Store model prompts/outputs with versioning for auditability.",
      "Add observability for latency, failures, and token usage."
    ]
  };
}

function buildScreenshotUrl(url) {
  return `https://image.thum.io/get/width/1400/noanimate/${encodeURIComponent(url)}`;
}

function captureFirst(text, regex) {
  const match = text.match(regex);
  return match?.[1] || "";
}

function resolveMaybeRelative(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function cleanInlineText(text) {
  return decodeHtmlEntities(text)
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function decodeHtmlEntities(value) {
  if (!value) {
    return "";
  }

  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_full, num) => String.fromCharCode(Number(num)));
}

function getAttr(tag, attrName) {
  const regex = new RegExp(`${attrName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(regex);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function countWords(text) {
  return text ? text.split(/\s+/g).filter(Boolean).length : 0;
}

function capitalize(value) {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}


