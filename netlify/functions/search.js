const Parser = require("rss-parser");

const parser = new Parser();

// Start small with reliable public RSS feeds. You can expand these later.
const SOURCES = [
  // Remote-first sources that are parseable with free RSS tooling.
  // Add more RSS feeds as you find sources that work (and are legally accessible).
  { name: "RemoteOK (Dev)", url: "https://remoteok.com/remote-dev-jobs.rss" },
  { name: "RemoteOK (All)", url: "https://remoteok.com/remote-jobs.rss" },
];

// Cache raw RSS items to avoid repeated fetch/parse on every search.
let rssCache = { fetchedAtMs: 0, items: [] };
const RSS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "from",
  "is",
  "are",
  "be",
  "as",
  "that",
  "this",
  "it",
  "will",
  "your",
  "you",
  "we",
  "our",
  "their",
  "company",
  "role",
  "job",
  "jobs",
  "required",
  "requirements",
]);

const FRESHER_KEYWORDS = [
  "fresher",
  "freshers",
  "entry level",
  "entry-level",
  "0-1 years",
  "0-2 years",
  "0 to 1 years",
  "0 to 2 years",
  "0-1 yr",
  "0-2 yr",
  "new grad",
  "new graduate",
  "recent graduate",
  "graduate trainee",
  "trainee",
  "intern",
  "internship",
  "junior",
];

const SENIOR_PENALTY_KEYWORDS = [
  "senior",
  "lead",
  "staff",
  "principal",
  "manager",
  "director",
  "experienced",
  "5+",
  "5 years",
  "6+",
  "6 years",
  "7+",
  "7 years",
  "8+",
  "8 years",
  "9+",
  "9 years",
  "10+",
  "10 years",
  "3+",
  "4+",
];

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^a-z0-9\s\-+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s) {
  const norm = normalizeText(s);
  if (!norm) return [];
  return norm
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t && t.length >= 2 && !STOPWORDS.has(t));
}

function uniq(arr) {
  return [...new Set(arr)];
}

function scoreJaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / A.size;
}

function containsAny(haystack, needles) {
  const h = normalizeText(haystack);
  for (const n of needles) {
    if (!n) continue;
    const nn = normalizeText(n);
    if (nn && h.includes(nn)) return true;
  }
  return false;
}

function countAny(haystack, needles) {
  const h = normalizeText(haystack);
  let c = 0;
  for (const n of needles) {
    const nn = normalizeText(n);
    if (nn && h.includes(nn)) c++;
  }
  return c;
}

function inferWorkMode(text) {
  const t = normalizeText(text);
  const isRemote =
    /\bremote\b/.test(t) ||
    /\bwork from home\b/.test(t) ||
    /\bwfh\b/.test(t) ||
    /\bdistributed\b/.test(t);
  const isOnsite = /\bon[-\s]?site\b/.test(t) || /\bon site\b/.test(t) || /\bonsite\b/.test(t);
  if (isRemote && isOnsite) return "Hybrid";
  if (isRemote) return "Remote";
  if (isOnsite) return "Onsite";
  return "";
}

function inferLocation(text) {
  const t = normalizeText(text);
  if (!t) return "";
  if (t.includes("remote")) return "Remote";
  if (t.includes("india")) return "India";

  const cityPatterns = [
    ["bengaluru", ["bengaluru", "bangalore"]],
    ["mumbai", ["mumbai"]],
    ["delhi", ["delhi", "new delhi"]],
    ["hyderabad", ["hyderabad"]],
    ["pune", ["pune"]],
    ["chennai", ["chennai"]],
    ["kolkata", ["kolkata"]],
  ];
  for (const [label, variants] of cityPatterns) {
    for (const v of variants) {
      if (t.includes(v)) return label;
    }
  }
  return "";
}

function expandRoleTokens(role) {
  const r = normalizeText(role);
  const tokens = tokenize(r);

  // Light synonym expansion for common “broad category” queries.
  const synonyms = [];
  if (r.includes("software")) synonyms.push("software engineer", "developer", "engineer");
  if (r.includes("frontend") || r.includes("front end")) synonyms.push("react", "frontend", "web");
  if (r.includes("backend")) synonyms.push("backend", "node", "api");
  if (r.includes("fullstack") || r.includes("full stack"))
    synonyms.push("fullstack", "full-stack", "frontend", "backend");
  if (r.includes("data analyst") || r.includes("analytics")) synonyms.push("sql", "dashboard", "analyst");
  if (r.includes("data scientist")) synonyms.push("ml", "machine learning", "python");
  if (r.includes("devops")) synonyms.push("devops", "aws", "kubernetes", "ci/cd");
  if (r.includes("qa") || r.includes("test")) synonyms.push("qa", "testing", "automation");
  if (r.includes("mobile") || r.includes("android")) synonyms.push("android", "mobile");

  return uniq(tokens).concat(synonyms.flatMap(tokenize));
}

function computeRoleMatch(queryTokens, jobTitleTokens, jobDescTokens) {
  // Prefer title match over description match.
  const titleOverlap = scoreJaccard(queryTokens, jobTitleTokens);
  const descOverlap = scoreJaccard(queryTokens, jobDescTokens);
  return 0.65 * titleOverlap + 0.35 * descOverlap;
}

function computeFresherScore(text) {
  const t = normalizeText(text);
  const pos = countAny(t, FRESHER_KEYWORDS);
  const neg = countAny(t, SENIOR_PENALTY_KEYWORDS);

  const years = extractMaxYears(t);
  // If years is explicitly mentioned, use it as a strong signal.
  if (years !== null) {
    if (years <= 2) return 0.9;
    if (years <= 3) return 0.35;
    return 0;
  }

  // If years aren't specified, we still want fresher-only searches to return
  // enough results, but we rank them lower unless fresher keywords exist.
  if (neg > 0 && pos === 0) return 0;
  if (pos > 0) return Math.max(0.35, Math.min(0.85, pos * 0.28));

  // Map to [0..1] with a soft ramp.
  const raw = pos * 0.22 - neg * 0.18;
  // If we reach here, pos and neg are likely both 0 -> return a small prior.
  const prior = raw <= 0 ? 0.12 : raw;
  return Math.max(0, Math.min(1, prior));
}

function computeRemoteScore(text, workMode) {
  if (!workMode || workMode === "both") return 0.5; // neutral influence
  const t = normalizeText(text);
  const isRemote = inferWorkMode(t) === "Remote" || t.includes("remote") || t.includes("work from home");
  const isOnsite = inferWorkMode(t) === "Onsite" || t.includes("onsite") || t.includes("on-site");
  if (workMode === "remote") return isRemote ? 1 : isOnsite ? 0 : 0.35;
  if (workMode === "onsite") return isOnsite ? 1 : isRemote ? 0 : 0.35;
  return 0.5;
}

function filterByMarket(text, market) {
  // If market is "global", we just don't hard-filter; RSS sources are usually global anyway.
  if (!market || market === "any") return true;
  const t = normalizeText(text);
  if (market === "india") {
    // For remote jobs, description might not mention India explicitly; allow remote jobs to pass.
    const isRemote = inferWorkMode(t) === "Remote" || t.includes("remote");
    if (isRemote) return true;
    return t.includes("india");
  }
  if (market === "global") {
    // If it clearly says India, exclude (best-effort).
    if (t.includes("india") && !t.includes("remote")) return false;
    return true;
  }
  if (market === "any") return true;
  return true;
}

function extractMaxYears(text) {
  // Attempts to capture patterns like:
  // - "0-2 years", "1-3 yrs", "5+ years", "3 years"
  const t = normalizeText(text);
  const rangeRe = /(\d+)\s*[-–]\s*(\d+)\s*\+?\s*(?:years|yrs)/gi;
  const singleRe = /(\d+)\s*\+?\s*(?:years|yrs)/gi;

  let max = null;
  for (const m of t.matchAll(rangeRe)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const localMax = Math.max(a, b);
    if (max === null || localMax > max) max = localMax;
  }
  if (max === null) {
    for (const m of t.matchAll(singleRe)) {
      const n = Number(m[1]);
      if (max === null || n > max) max = n;
    }
  }
  return max;
}

async function parseRssWithTimeout(url, ms) {
  const parsePromise = parser.parseURL(url);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`RSS parse timeout after ${ms}ms`)), ms)
  );
  return await Promise.race([parsePromise, timeout]);
}

function safeSnippet(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 600 ? t.slice(0, 600) : t;
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const role = String(qs.role || "").trim();
    const workMode = String(qs.workMode || "both");
    const market = String(qs.market || "any");
    const fresherOnly = String(qs.fresherOnly || "true") === "true";
    const skills = String(qs.skills || "").trim();

    if (!role) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ meta: { message: "Missing role query." }, jobs: [] }),
      };
    }

    const queryText = [role, skills].filter(Boolean).join(" ");
    const queryTokens = uniq(tokenize(queryText).concat(expandRoleTokens(queryText)));
    const fresherNeedles = fresherOnly ? FRESHER_KEYWORDS : [];

    const maxSources = 5;
    const maxItems = 120;

    let rawItems;
    const now = Date.now();
    if (now - rssCache.fetchedAtMs < RSS_CACHE_TTL_MS && Array.isArray(rssCache.items) && rssCache.items.length) {
      rawItems = rssCache.items;
    } else {
      rawItems = [];
      for (const source of SOURCES.slice(0, maxSources)) {
        let feed;
        try {
          feed = await parseRssWithTimeout(source.url, 9000);
        } catch (e) {
          // Skip broken/unreachable sources; don't fail the whole search.
          continue;
        }
        const items = Array.isArray(feed?.items) ? feed.items.slice(0, 60) : [];
        for (const item of items) {
          rawItems.push({ item, source });
        }
      }
      rssCache = { fetchedAtMs: now, items: rawItems };
    }

    const allJobs = [];
    for (const { item, source } of rawItems) {
        const title = String(item?.title || "").replace(/\s+/g, " ").trim();
        const link = String(item?.link || "");
        if (!title && !item?.contentSnippet) continue;

        const description =
          item?.contentSnippet ||
          item?.content ||
          item?.summary ||
          item?.description ||
          "";

        const jobText = `${title} ${description}`.replace(/\s+/g, " ").trim();
        if (!filterByMarket(jobText, market)) continue;

        const workModeInText = inferWorkMode(jobText);
        if (workMode !== "both") {
          const wantRemote = workMode === "remote";
          if (wantRemote && workModeInText && workModeInText !== "Remote") continue;
          const wantOnsite = workMode === "onsite";
          if (wantOnsite && workModeInText && workModeInText !== "Onsite") continue;
        }

        // Extract company + normalized job title best-effort.
        const parts = title.split(/\s[-–|]\s/);
        let company = "";
        let jobTitle = title;
        if (parts.length >= 2) {
          company = parts[0];
          jobTitle = parts.slice(1).join(" - ").trim();
        }

        const jobTitleTokens = uniq(tokenize(jobTitle));
        const jobDescTokens = uniq(tokenize(description));

        const roleMatch = computeRoleMatch(queryTokens, jobTitleTokens, jobDescTokens);
        const fresherScore = fresherOnly ? computeFresherScore(jobText) : 0.4; // neutral-ish
        const remoteScore = computeRemoteScore(jobText, workMode);

        if (fresherOnly) {
          // Hard reject likely senior/experienced postings (big precision boost).
          const hasSeniorSignal =
            containsAny(jobText, SENIOR_PENALTY_KEYWORDS) || extractMaxYears(jobText) >= 3;
          if (hasSeniorSignal) continue;

          const maxYears = extractMaxYears(jobText);
          const hasFresherSignal = containsAny(jobText, FRESHER_KEYWORDS);
          if (maxYears !== null) {
            if (maxYears <= 2) {
              // ok
            } else {
              continue;
            }
          } else {
            // If we can't extract years, keep the job as long as it doesn't look senior.
            // (Rank lower unless we find fresher keywords.)
            if (!hasFresherSignal) {
              // Keep, but no special filter. Score will reflect lack of fresher signals.
            }
          }
        }

        const finalScore =
          0.68 * roleMatch +
          0.22 * fresherScore +
          0.10 * remoteScore;

        const matchedOn = [];
        if (containsAny(jobText, [role])) matchedOn.push("role-phrase");
        if (containsAny(jobText, queryTokens.slice(0, 8))) matchedOn.push("query-tokens");
        if (fresherOnly && containsAny(jobText, FRESHER_KEYWORDS)) matchedOn.push("fresher-signal");
        if (workMode !== "both" && inferWorkMode(jobText)) matchedOn.push(`work-mode:${inferWorkMode(jobText)}`);

        allJobs.push({
          id: link || `${jobTitle}::${company}`.slice(0, 120),
          title: jobTitle || title,
          company: company || "",
          location: inferLocation(jobText),
          // remoteok feed is remote-first; if the text doesn't include "remote",
          // still treat as remote.
          workMode: inferWorkMode(jobText) || (source?.name?.includes("RemoteOK") ? "Remote" : ""),
          link: link || "",
          score: finalScore,
          snippet: safeSnippet(description),
          source: source.name,
          matchedOn,
        });
    }

    // Dedupe by link (best-effort).
    const dedup = [];
    const seen = new Set();
    for (const j of allJobs) {
      const key = j.link || j.id;
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(j);
    }

    dedup.sort((a, b) => (b.score || 0) - (a.score || 0));
    const jobs = dedup.slice(0, maxItems);

    const freshnessNote =
      fresherOnly && jobs.length <= 3
        ? "Few results matched `Fresher-only` from the current free RSS sources. Try disabling `Fresher-only` or using a broader role."
        : "";

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        meta: {
          message: freshnessNote ? freshnessNote : `Found ${jobs.length} matching jobs`,
          role,
          workMode,
          market,
          fresherOnly,
          sourcesUsed: SOURCES.map((s) => s.name),
        },
        jobs,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        meta: { message: "Search failed." },
        jobs: [],
        error: String(err?.message || err),
      }),
    };
  }
};

