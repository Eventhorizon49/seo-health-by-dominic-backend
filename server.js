const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const BRAND = {
  product: "SEO Health by Dominic",
  service: "SEO Health by Dominic API",
  version: "2.1.0"
};

app.get("/", (req, res) => {
  res.json({
    success: true,
    product: BRAND.product,
    service: BRAND.service,
    version: BRAND.version,
    message: "SEO Health by Dominic API is running."
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    service: BRAND.service,
    version: BRAND.version
  });
});

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "test.html"));
});

function normalizeUrl(input) {
  let url = String(input || "").trim();
  if (!url) throw new Error("Website URL is required.");
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }
  return parsed.href;
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(arr) {
  return [...new Set(arr)];
}

function sameSite(a, b) {
  const aa = a.replace(/^www\./i, "").toLowerCase();
  const bb = b.replace(/^www\./i, "").toLowerCase();
  return aa === bb;
}

function makeCheck({
  id, title, category, status, severity,
  found, recommended, why, fix, weight, deduction = 0
}) {
  return {
    id, title, category, status, severity,
    found, recommended, why, fix, weight, deduction
  };
}

function grade(score) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 65) return "Needs Improvement";
  if (score >= 45) return "Poor";
  return "Critical";
}

async function fetchPage(url, timeout = 18000) {
  const started = Date.now();

  const response = await axios.get(url, {
    timeout,
    maxRedirects: 10,
    responseType: "text",
    decompress: true,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SEOHealthByDominic/2.0; Website SEO Auditor)",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    }
  });

  const finalUrl =
    response.request?.res?.responseUrl ||
    response.request?._redirectable?._currentUrl ||
    url;

  return {
    response,
    finalUrl,
    elapsedMs: Date.now() - started
  };
}

async function fetchOptional(url, timeout = 10000) {
  try {
    const started = Date.now();

    const response = await axios.get(url, {
      timeout,
      maxRedirects: 8,
      responseType: "text",
      decompress: true,
      validateStatus: () => true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SEOHealthByDominic/2.0; Website SEO Auditor)",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    return {
      reachable: true,
      status: response.status,
      data:
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data),
      headers: response.headers,
      finalUrl:
        response.request?.res?.responseUrl ||
        response.request?._redirectable?._currentUrl ||
        url,
      elapsedMs: Date.now() - started
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      data: "",
      headers: {},
      finalUrl: url,
      elapsedMs: null,
      error: error.message
    };
  }
}

async function checkLink(url) {
  try {
    let response = await axios.head(url, {
      timeout: 7000,
      maxRedirects: 6,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SEOHealthByDominic/2.0)"
      }
    });

    if ([403, 405].includes(response.status)) {
      response = await axios.get(url, {
        timeout: 7000,
        maxRedirects: 6,
        responseType: "text",
        validateStatus: () => true,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SEOHealthByDominic/2.0)"
        }
      });
    }

    return {
      url,
      status: response.status,
      broken: response.status >= 400
    };
  } catch (error) {
    return {
      url,
      status: null,
      broken: true,
      error: error.message
    };
  }
}

async function limitedMap(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, run)
  );

  return results;
}

function collectHeadings($) {
  const hierarchy = [];

  $("h1,h2,h3,h4,h5,h6").each((i, el) => {
    const tag = String(el.tagName || "").toLowerCase();
    const level = Number(tag.replace("h", ""));

    hierarchy.push({
      tag,
      level,
      text: normalizeText($(el).text())
    });
  });

  let jumps = 0;
  let previous = null;

  for (const item of hierarchy) {
    if (previous !== null && item.level > previous + 1) jumps++;
    previous = item.level;
  }

  return {
    counts: {
      h1: $("h1").length,
      h2: $("h2").length,
      h3: $("h3").length,
      h4: $("h4").length,
      h5: $("h5").length,
      h6: $("h6").length
    },
    h1Text: $("h1")
      .map((i, el) => normalizeText($(el).text()))
      .get()
      .filter(Boolean),
    hierarchy,
    jumps
  };
}

function collectImages($, finalUrl) {
  let missingAlt = 0;
  let emptyAlt = 0;
  let informativeAlt = 0;
  let lazyLoaded = 0;

  const images = $("img").map((i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    const hasAlt = $(el).is("[alt]");
    const alt = normalizeText($(el).attr("alt") || "");
    const loading = String($(el).attr("loading") || "").toLowerCase();

    if (!hasAlt) missingAlt++;
    else if (!alt) emptyAlt++;
    else informativeAlt++;

    if (loading === "lazy") lazyLoaded++;

    return {
      src: absoluteUrl(src, finalUrl),
      alt,
      hasAlt,
      loading
    };
  }).get();

  return {
    total: images.length,
    missingAlt,
    emptyAlt,
    informativeAlt,
    lazyLoaded,
    images
  };
}

function collectLinks($, finalUrl) {
  const base = new URL(finalUrl);
  const internal = [];
  const external = [];

  $("a[href]").each((i, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;

    const full = absoluteUrl(raw, finalUrl);
    if (!full) return;

    try {
      const parsed = new URL(full);
      if (!["http:", "https:"].includes(parsed.protocol)) return;

      const item = {
        url: full,
        text: normalizeText($(el).text()),
        nofollow: String($(el).attr("rel") || "")
          .toLowerCase()
          .split(/\s+/)
          .includes("nofollow")
      };

      if (sameSite(parsed.hostname, base.hostname)) {
        internal.push(item);
      } else {
        external.push(item);
      }
    } catch {}
  });

  const dedupe = list => {
    const seen = new Map();
    for (const item of list) {
      if (!seen.has(item.url)) seen.set(item.url, item);
    }
    return [...seen.values()];
  };

  return {
    internal: dedupe(internal),
    external: dedupe(external)
  };
}

function parseSchemaTypes($) {
  const types = [];

  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const parsed = JSON.parse($(el).html());

      const walk = value => {
        if (!value) return;

        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }

        if (typeof value !== "object") return;

        if (value["@type"]) {
          const t = value["@type"];
          if (Array.isArray(t)) t.forEach(x => types.push(String(x)));
          else types.push(String(t));
        }

        if (value["@graph"]) walk(value["@graph"]);
      };

      walk(parsed);
    } catch {}
  });

  return unique(types);
}

function canonicalState(canonical, finalUrl) {
  if (!canonical) return "missing";

  try {
    const c = new URL(canonical, finalUrl);
    const f = new URL(finalUrl);

    const clean = u =>
      u.origin +
      u.pathname.replace(/\/+$/, "") +
      (u.search || "");

    return clean(c) === clean(f) ? "self" : "different";
  } catch {
    return "invalid";
  }
}

async function inspectRobotsAndSitemap(finalUrl) {
  const origin = new URL(finalUrl).origin;
  const robotsUrl = origin + "/robots.txt";
  const robots = await fetchOptional(robotsUrl);

  const robotsText = robots.data || "";
  const looksHtml =
    /^\s*<!doctype html/i.test(robotsText) ||
    /^\s*<html/i.test(robotsText);

  const valid =
    robots.status === 200 &&
    !looksHtml &&
    /user-agent:/i.test(robotsText);

  const blocksAll =
    valid &&
    /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(?:\r?\n|$)/i.test(
      robotsText
    );

  const sitemapReferences = [];

  if (valid) {
    const matches = robotsText.matchAll(/^\s*sitemap:\s*(.+)$/gim);
    for (const match of matches) {
      sitemapReferences.push(match[1].trim());
    }
  }

  const candidates = unique([
    ...sitemapReferences,
    origin + "/sitemap.xml",
    origin + "/sitemap_index.xml"
  ]);

  let sitemap = {
    found: false,
    url: null,
    status: null,
    type: null,
    locationCount: 0,
    sampleLocations: []
  };

  for (const candidate of candidates) {
    const check = await fetchOptional(candidate);

    if (
      check.status === 200 &&
      /<(urlset|sitemapindex)\b/i.test(check.data)
    ) {
      const locations = [
        ...check.data.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gim)
      ].map(m => m[1].trim());

      sitemap = {
        found: true,
        url: candidate,
        status: check.status,
        type: /<sitemapindex\b/i.test(check.data)
          ? "sitemap-index"
          : "urlset",
        locationCount: locations.length,
        sampleLocations: locations.slice(0, 20)
      };

      break;
    }
  }

  return {
    robots: {
      url: robotsUrl,
      found: valid,
      status: robots.status,
      blocksAll,
      sitemapReferences
    },
    sitemap
  };
}

function addChecks(data) {
  const {
    finalUrl,
    statusCode,
    title,
    metaDescription,
    canonical,
    canonicalStatus,
    metaRobots,
    viewport,
    language,
    headings,
    images,
    links,
    schemaTypes,
    social,
    robots,
    sitemap,
    wordCount,
    brokenInternal,
    brokenExternal,
    responseTimeMs,
    htmlSizeKB,
    headers
  } = data;

  const checks = [];

  const push = c => checks.push(makeCheck(c));

  if (!title) {
    push({
      id: "title",
      title: "Page title",
      category: "onPage",
      status: "fail",
      severity: "critical",
      found: "0 characters",
      recommended: "30–60 characters",
      why: "The title is a primary signal describing the page in search results.",
      fix: "Add one unique, descriptive title.",
      weight: 8,
      deduction: 8
    });
  } else if (title.length < 30 || title.length > 60) {
    push({
      id: "title",
      title: "Page title",
      category: "onPage",
      status: "warn",
      severity: "warning",
      found: `${title.length} characters`,
      recommended: "30–60 characters",
      why: "Very short titles may be vague; long titles may be truncated or rewritten.",
      fix: "Rewrite the title into the target range while keeping it descriptive.",
      weight: 8,
      deduction: 4
    });
  } else {
    push({
      id: "title",
      title: "Page title",
      category: "onPage",
      status: "pass",
      severity: "passed",
      found: `${title.length} characters`,
      recommended: "30–60 characters",
      why: "The title is within our practical target range.",
      fix: "No action required.",
      weight: 8
    });
  }

  if (!metaDescription) {
    push({
      id: "meta-description",
      title: "Meta description",
      category: "onPage",
      status: "fail",
      severity: "critical",
      found: "0 characters",
      recommended: "70–160 characters",
      why: "A useful meta description can improve search-result presentation.",
      fix: "Add a concise description that accurately summarizes the page.",
      weight: 7,
      deduction: 7
    });
  } else if (
    metaDescription.length < 70 ||
    metaDescription.length > 160
  ) {
    push({
      id: "meta-description",
      title: "Meta description",
      category: "onPage",
      status: "warn",
      severity: "warning",
      found: `${metaDescription.length} characters`,
      recommended: "70–160 characters",
      why: "Very short descriptions may be unhelpful; very long ones are often truncated or rewritten.",
      fix: "Rewrite the description into the target range without keyword stuffing.",
      weight: 7,
      deduction: 4
    });
  } else {
    push({
      id: "meta-description",
      title: "Meta description",
      category: "onPage",
      status: "pass",
      severity: "passed",
      found: `${metaDescription.length} characters`,
      recommended: "70–160 characters",
      why: "The meta description is within our practical target range.",
      fix: "No action required.",
      weight: 7
    });
  }

  if (headings.counts.h1 === 0) {
    push({
      id: "h1",
      title: "Main H1 heading",
      category: "content",
      status: "warn",
      severity: "warning",
      found: "0 H1 headings",
      recommended: "1 clear page-level H1",
      why: "A clear H1 helps users and search engines understand the page topic.",
      fix: "Add one descriptive H1 near the main content.",
      weight: 6,
      deduction: 4
    });
  } else if (headings.counts.h1 > 1) {
    push({
      id: "h1",
      title: "Main H1 heading",
      category: "content",
      status: "warn",
      severity: "warning",
      found: `${headings.counts.h1} H1 headings`,
      recommended: "1 clear page-level H1",
      why: "Multiple H1s can be valid, but one obvious page-level heading is easier to interpret.",
      fix: "Keep one primary H1 and use H2/H3 for subsections.",
      weight: 6,
      deduction: 2
    });
  } else {
    push({
      id: "h1",
      title: "Main H1 heading",
      category: "content",
      status: "pass",
      severity: "passed",
      found: "1 H1 heading",
      recommended: "1 clear page-level H1",
      why: "The page has one clear H1.",
      fix: "No action required.",
      weight: 6
    });
  }

  push({
    id: "heading-hierarchy",
    title: "Heading hierarchy",
    category: "content",
    status: headings.jumps > 2 ? "warn" : "pass",
    severity: headings.jumps > 2 ? "warning" : "passed",
    found: `${headings.jumps} hierarchy jump${headings.jumps === 1 ? "" : "s"}`,
    recommended: "Avoid unnecessary skipped heading levels",
    why: "Logical heading structure improves readability and document structure.",
    fix:
      headings.jumps > 2
        ? "Review headings and avoid unnecessary H2→H4/H5 jumps."
        : "No action required.",
    weight: 3,
    deduction: headings.jumps > 2 ? 2 : 0
  });

  push({
    id: "content-depth",
    title: "Visible content",
    category: "content",
    status: wordCount < 150 ? "warn" : "pass",
    severity: wordCount < 150 ? "warning" : "passed",
    found: `${wordCount} words`,
    recommended: "Review if under 150 words",
    why: "There is no universal SEO word minimum, but very short pages may not fully satisfy search intent.",
    fix:
      wordCount < 150
        ? "Confirm the page fully answers its purpose and add useful content only where needed."
        : "No action required.",
    weight: 4,
    deduction: wordCount < 150 ? 2 : 0
  });

  const missingRatio =
    images.total > 0 ? images.missingAlt / images.total : 0;

  push({
    id: "image-alt",
    title: "Image ALT attributes",
    category: "content",
    status:
      images.missingAlt === 0
        ? "pass"
        : missingRatio > 0.25
        ? "fail"
        : "warn",
    severity:
      images.missingAlt === 0
        ? "passed"
        : missingRatio > 0.25
        ? "critical"
        : "warning",
    found: `${images.missingAlt} of ${images.total} images missing ALT attributes`,
    recommended: "ALT attributes on meaningful images",
    why: "ALT text improves accessibility and helps search engines understand informative images.",
    fix:
      images.missingAlt === 0
        ? "No action required."
        : "Add descriptive ALT text to informative images. Decorative images can use alt=\"\".",
    weight: 6,
    deduction:
      images.missingAlt === 0
        ? 0
        : missingRatio > 0.25
        ? 6
        : 3
  });

  if (images.total > 5 && images.emptyAlt / images.total > 0.7) {
    push({
      id: "empty-alt",
      title: "ALT text quality",
      category: "content",
      status: "warn",
      severity: "warning",
      found: `${images.emptyAlt} of ${images.total} images use empty ALT text`,
      recommended: "Empty ALT only for decorative images",
      why: "A high proportion of empty ALT values may mean informative images are not described.",
      fix: "Review the images and add descriptive ALT text where appropriate.",
      weight: 3,
      deduction: 2
    });
  }

  push({
    id: "status",
    title: "HTTP status",
    category: "technical",
    status: statusCode >= 200 && statusCode < 300 ? "pass" : "fail",
    severity:
      statusCode >= 200 && statusCode < 300 ? "passed" : "critical",
    found: `HTTP ${statusCode}`,
    recommended: "200-level response for normal indexable pages",
    why: "Error responses and unexpected redirects can interfere with crawling and indexing.",
    fix:
      statusCode >= 200 && statusCode < 300
        ? "No action required."
        : "Review the server response and redirect configuration.",
    weight: 8,
    deduction: statusCode >= 200 && statusCode < 300 ? 0 : 8
  });

  push({
    id: "https",
    title: "HTTPS",
    category: "technical",
    status: finalUrl.startsWith("https://") ? "pass" : "fail",
    severity: finalUrl.startsWith("https://") ? "passed" : "critical",
    found: finalUrl.startsWith("https://") ? "HTTPS enabled" : "HTTP",
    recommended: "HTTPS",
    why: "HTTPS is the standard for secure modern websites.",
    fix:
      finalUrl.startsWith("https://")
        ? "No action required."
        : "Enable HTTPS and redirect HTTP to HTTPS.",
    weight: 5,
    deduction: finalUrl.startsWith("https://") ? 0 : 5
  });

  if (!canonical) {
    push({
      id: "canonical",
      title: "Canonical URL",
      category: "technical",
      status: "warn",
      severity: "warning",
      found: "Missing",
      recommended: "Valid canonical where appropriate",
      why: "Canonical tags help consolidate duplicate or near-duplicate URL signals.",
      fix: "Add a self-referencing canonical if appropriate.",
      weight: 5,
      deduction: 3
    });
  } else if (canonicalStatus === "invalid") {
    push({
      id: "canonical",
      title: "Canonical URL",
      category: "technical",
      status: "fail",
      severity: "critical",
      found: canonical,
      recommended: "Valid canonical URL",
      why: "Invalid canonicals may be ignored.",
      fix: "Correct the canonical URL.",
      weight: 5,
      deduction: 5
    });
  } else if (canonicalStatus === "different") {
    push({
      id: "canonical",
      title: "Canonical URL",
      category: "technical",
      status: "warn",
      severity: "warning",
      found: canonical,
      recommended: finalUrl,
      why: "The canonical points somewhere else. That may be intentional, but it should be reviewed.",
      fix: "Confirm the canonical target is the preferred version of this content.",
      weight: 5,
      deduction: 2
    });
  } else {
    push({
      id: "canonical",
      title: "Canonical URL",
      category: "technical",
      status: "pass",
      severity: "passed",
      found: canonical,
      recommended: "Self-referencing or intentionally preferred canonical",
      why: "A valid canonical is present.",
      fix: "No action required.",
      weight: 5
    });
  }

  const noindex = /(^|,|\s)noindex($|,|\s)/i.test(metaRobots);

  push({
    id: "indexability",
    title: "Indexability",
    category: "technical",
    status: noindex || robots.blocksAll ? "fail" : "pass",
    severity: noindex || robots.blocksAll ? "critical" : "passed",
    found: noindex
      ? `Meta robots: ${metaRobots}`
      : robots.blocksAll
      ? "robots.txt blocks all crawling"
      : "No obvious indexing block found",
    recommended: "Indexable unless intentionally excluded",
    why: "noindex and global robots blocks can prevent search visibility.",
    fix:
      noindex
        ? "Remove noindex if this page should appear in search."
        : robots.blocksAll
        ? "Remove the full-site robots block if unintended."
        : "No action required.",
    weight: 10,
    deduction: noindex || robots.blocksAll ? 10 : 0
  });

  push({
    id: "viewport",
    title: "Mobile viewport",
    category: "technical",
    status: viewport ? "pass" : "warn",
    severity: viewport ? "passed" : "warning",
    found: viewport || "Missing",
    recommended: "Responsive viewport meta tag",
    why: "The viewport tag helps pages scale correctly on mobile devices.",
    fix: viewport
      ? "No action required."
      : "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">.",
    weight: 4,
    deduction: viewport ? 0 : 4
  });

  push({
    id: "language",
    title: "Page language",
    category: "technical",
    status: language ? "pass" : "warn",
    severity: language ? "passed" : "warning",
    found: language || "Missing",
    recommended: "Valid lang attribute",
    why: "The language declaration helps browsers, accessibility tools and search engines.",
    fix: language ? "No action required." : "Add a valid lang attribute to <html>.",
    weight: 2,
    deduction: language ? 0 : 2
  });

  push({
    id: "robots",
    title: "robots.txt",
    category: "technical",
    status: robots.found && !robots.blocksAll ? "pass" : robots.blocksAll ? "fail" : "warn",
    severity: robots.found && !robots.blocksAll ? "passed" : robots.blocksAll ? "critical" : "warning",
    found: robots.blocksAll
      ? "Found, but blocks all crawling"
      : robots.found
      ? `Found at ${robots.url}`
      : "Not confirmed",
    recommended: "Accessible and not unintentionally blocking the public site",
    why: "robots.txt controls crawler access and often advertises sitemap locations.",
    fix: robots.blocksAll
      ? "Remove Disallow: / for User-agent: * if unintended."
      : robots.found
      ? "No action required."
      : "Create a valid /robots.txt if crawl directives are needed.",
    weight: 6,
    deduction: robots.blocksAll ? 6 : robots.found ? 0 : 3
  });

  push({
    id: "sitemap",
    title: "XML sitemap",
    category: "technical",
    status: sitemap.found ? "pass" : "warn",
    severity: sitemap.found ? "passed" : "warning",
    found: sitemap.found
      ? `${sitemap.type}, ${sitemap.locationCount} location entries`
      : "Not confirmed",
    recommended: "Valid XML sitemap or sitemap index",
    why: "Sitemaps help search engines discover important URLs.",
    fix: sitemap.found
      ? "No action required."
      : "Create a sitemap and reference it in robots.txt or Search Console.",
    weight: 6,
    deduction: sitemap.found ? 0 : 3
  });

  push({
    id: "internal-links",
    title: "Internal links",
    category: "links",
    status: links.internal.length ? "pass" : "warn",
    severity: links.internal.length ? "passed" : "warning",
    found: `${links.internal.length} unique internal links`,
    recommended: "At least 1 useful internal link where appropriate",
    why: "Internal links help users and crawlers discover related pages.",
    fix: links.internal.length
      ? "No action required."
      : "Add relevant internal links where useful.",
    weight: 4,
    deduction: links.internal.length ? 0 : 3
  });

  push({
    id: "broken-internal",
    title: "Broken internal links",
    category: "links",
    status: brokenInternal.length ? "fail" : "pass",
    severity: brokenInternal.length ? "critical" : "passed",
    found: brokenInternal.length
      ? `${brokenInternal.length} broken internal links found in sample`
      : "0 broken internal links in tested sample",
    recommended: "0 broken internal links",
    why: "Broken internal links waste crawl paths and create poor user experience.",
    fix: brokenInternal.length
      ? "Update or remove the broken internal links."
      : "No action required.",
    weight: 8,
    deduction: brokenInternal.length
      ? Math.min(8, 3 + brokenInternal.length)
      : 0
  });

  push({
    id: "broken-external",
    title: "Broken external links",
    category: "links",
    status: brokenExternal.length ? "warn" : "pass",
    severity: brokenExternal.length ? "warning" : "passed",
    found: brokenExternal.length
      ? `${brokenExternal.length} broken external links found in sample`
      : "0 broken external links in tested sample",
    recommended: "0 broken external links",
    why: "Broken outbound links reduce usefulness and trust.",
    fix: brokenExternal.length
      ? "Update or remove broken external links."
      : "No action required.",
    weight: 4,
    deduction: brokenExternal.length
      ? Math.min(4, 2 + brokenExternal.length)
      : 0
  });

  const ogCount = [
    social.ogTitle,
    social.ogDescription,
    social.ogImage
  ].filter(Boolean).length;

  push({
    id: "open-graph",
    title: "Open Graph metadata",
    category: "social",
    status: ogCount >= 2 ? "pass" : "warn",
    severity: ogCount >= 2 ? "passed" : "warning",
    found: `${ogCount}/3 key Open Graph fields found`,
    recommended: "og:title, og:description and og:image",
    why: "Open Graph controls how links can appear when shared socially.",
    fix: ogCount >= 2
      ? "No major action required."
      : "Add the missing Open Graph title, description and image fields.",
    weight: 4,
    deduction: ogCount >= 2 ? 0 : 2
  });

  push({
    id: "twitter-card",
    title: "Twitter/X card",
    category: "social",
    status: social.twitterCard ? "pass" : "warn",
    severity: social.twitterCard ? "passed" : "warning",
    found: social.twitterCard || "Missing",
    recommended: "twitter:card when X sharing matters",
    why: "Twitter/X card metadata can improve link previews.",
    fix: social.twitterCard
      ? "No action required."
      : "Add twitter:card if X sharing is important.",
    weight: 2,
    deduction: social.twitterCard ? 0 : 1
  });

  push({
    id: "schema",
    title: "Structured data",
    category: "structuredData",
    status: schemaTypes.length ? "pass" : "warn",
    severity: schemaTypes.length ? "passed" : "warning",
    found: schemaTypes.length
      ? schemaTypes.join(", ")
      : "No JSON-LD types detected",
    recommended: "Relevant schema where applicable",
    why: "Structured data can help search engines understand entities and page content.",
    fix: schemaTypes.length
      ? "Validate relevant schema with Google's Rich Results Test."
      : "Add only schema types that accurately match the page.",
    weight: 4,
    deduction: schemaTypes.length ? 0 : 1
  });

  push({
    id: "response-time",
    title: "Server response time",
    category: "performance",
    status:
      responseTimeMs <= 800
        ? "pass"
        : responseTimeMs <= 1800
        ? "warn"
        : "fail",
    severity:
      responseTimeMs <= 800
        ? "passed"
        : responseTimeMs <= 1800
        ? "warning"
        : "critical",
    found: `${responseTimeMs} ms`,
    recommended: "≤ 800 ms for this basic server-response test",
    why: "Slow server response delays the start of page rendering.",
    fix:
      responseTimeMs <= 800
        ? "No action required."
        : "Review hosting, caching, backend processing and CDN configuration.",
    weight: 5,
    deduction:
      responseTimeMs <= 800
        ? 0
        : responseTimeMs <= 1800
        ? 2
        : 5
  });

  push({
    id: "page-size",
    title: "HTML document size",
    category: "performance",
    status: htmlSizeKB > 500 ? "warn" : "pass",
    severity: htmlSizeKB > 500 ? "warning" : "passed",
    found: `${htmlSizeKB} KB`,
    recommended: "Review if HTML exceeds ~500 KB",
    why: "Large HTML documents take longer to transfer and parse.",
    fix: htmlSizeKB > 500
      ? "Reduce unnecessary markup and oversized server-rendered payload."
      : "No action required.",
    weight: 3,
    deduction: htmlSizeKB > 500 ? 2 : 0
  });

  push({
    id: "compression",
    title: "Response compression",
    category: "performance",
    status: headers.contentEncoding ? "pass" : "warn",
    severity: headers.contentEncoding ? "passed" : "warning",
    found: headers.contentEncoding || "No content-encoding header detected",
    recommended: "gzip or br where supported",
    why: "Compression can reduce transfer size.",
    fix: headers.contentEncoding
      ? "No action required."
      : "Enable Brotli or gzip compression if supported.",
    weight: 3,
    deduction: headers.contentEncoding ? 0 : 1
  });

  push({
    id: "security-headers",
    title: "Basic security headers",
    category: "technical",
    status: headers.securityCount >= 3 ? "pass" : "warn",
    severity: headers.securityCount >= 3 ? "passed" : "warning",
    found: `${headers.securityCount}/5 common security headers detected`,
    recommended: "Use appropriate security headers",
    why: "Security headers improve browser-side protection and trust.",
    fix:
      headers.securityCount >= 3
        ? "Review policies periodically."
        : "Consider HSTS, CSP, X-Content-Type-Options, Referrer-Policy and frame protection.",
    weight: 3,
    deduction: headers.securityCount >= 3 ? 0 : 1
  });

  return checks;
}

function categoryScores(checks) {
  const groups = {};

  for (const c of checks) {
    if (!groups[c.category]) groups[c.category] = { max: 0, lost: 0 };
    groups[c.category].max += c.weight || 0;
    groups[c.category].lost += c.deduction || 0;
  }

  const result = {};

  for (const [category, data] of Object.entries(groups)) {
    result[category] = data.max
      ? Math.max(0, Math.round(100 - (data.lost / data.max) * 100))
      : 100;
  }

  return result;
}


// -----------------------------------------------------------------------------
// Google PageSpeed Insights / Lighthouse integration
// -----------------------------------------------------------------------------
// Works without a key for light use. For frequent automated use, an optional
// PAGESPEED_API_KEY can be added as a Render environment variable.
const PAGESPEED_CACHE_TTL_MS = 15 * 60 * 1000;
const PAGESPEED_CACHE_MAX = 100;
const pageSpeedCache = new Map();

function prunePageSpeedCache() {
  const now = Date.now();

  for (const [key, item] of pageSpeedCache.entries()) {
    if (!item || now - item.savedAt > PAGESPEED_CACHE_TTL_MS) {
      pageSpeedCache.delete(key);
    }
  }

  while (pageSpeedCache.size > PAGESPEED_CACHE_MAX) {
    const firstKey = pageSpeedCache.keys().next().value;
    pageSpeedCache.delete(firstKey);
  }
}

function getPageSpeedCache(key) {
  prunePageSpeedCache();
  const item = pageSpeedCache.get(key);
  if (!item) return null;
  if (Date.now() - item.savedAt > PAGESPEED_CACHE_TTL_MS) {
    pageSpeedCache.delete(key);
    return null;
  }
  return item.data;
}

function setPageSpeedCache(key, data) {
  pageSpeedCache.set(key, {
    savedAt: Date.now(),
    data
  });
  prunePageSpeedCache();
}

function lighthouseMetric(audits, id) {
  const audit = audits?.[id];
  if (!audit) return null;

  return {
    id,
    title: audit.title || id,
    numericValue:
      typeof audit.numericValue === "number" ? audit.numericValue : null,
    numericUnit: audit.numericUnit || null,
    displayValue: audit.displayValue || null,
    score:
      typeof audit.score === "number" ? audit.score : null
  };
}

function findCruxMetric(experience, possibleKeys) {
  const metrics = experience?.metrics || {};

  for (const key of possibleKeys) {
    if (metrics[key]) {
      return {
        key,
        percentile:
          typeof metrics[key].percentile === "number"
            ? metrics[key].percentile
            : null,
        category: metrics[key].category || null
      };
    }
  }

  return null;
}

function opportunityRows(audits) {
  if (!audits) return [];

  const preferredIds = new Set([
    "render-blocking-resources",
    "unused-javascript",
    "unused-css-rules",
    "modern-image-formats",
    "uses-optimized-images",
    "uses-responsive-images",
    "offscreen-images",
    "uses-text-compression",
    "uses-long-cache-ttl",
    "server-response-time",
    "total-byte-weight",
    "unminified-css",
    "unminified-javascript",
    "efficient-animated-content",
    "third-party-summary",
    "mainthread-work-breakdown",
    "bootup-time"
  ]);

  const rows = [];

  for (const [id, audit] of Object.entries(audits)) {
    if (!preferredIds.has(id)) continue;
    if (!audit) continue;

    const details = audit.details || {};
    const savingsMs =
      typeof details.overallSavingsMs === "number"
        ? details.overallSavingsMs
        : 0;

    const savingsBytes =
      typeof details.overallSavingsBytes === "number"
        ? details.overallSavingsBytes
        : 0;

    const score =
      typeof audit.score === "number" ? audit.score : null;

    // Keep failed / improvable diagnostics, plus key payload diagnostics.
    const shouldKeep =
      score === null ||
      score < 0.9 ||
      savingsMs > 0 ||
      savingsBytes > 0 ||
      ["total-byte-weight", "server-response-time", "third-party-summary",
       "mainthread-work-breakdown", "bootup-time"].includes(id);

    if (!shouldKeep) continue;

    rows.push({
      id,
      title: audit.title || id,
      description: audit.description || "",
      displayValue: audit.displayValue || null,
      score,
      savingsMs: Math.round(savingsMs),
      savingsBytes: Math.round(savingsBytes),
      numericValue:
        typeof audit.numericValue === "number"
          ? audit.numericValue
          : null,
      numericUnit: audit.numericUnit || null
    });
  }

  rows.sort((a, b) => {
    const aImpact = (a.savingsMs || 0) + (a.savingsBytes || 0) / 1000;
    const bImpact = (b.savingsMs || 0) + (b.savingsBytes || 0) / 1000;

    if (bImpact !== aImpact) return bImpact - aImpact;

    const aScore = a.score === null ? 1 : a.score;
    const bScore = b.score === null ? 1 : b.score;
    return aScore - bScore;
  });

  return rows.slice(0, 10);
}

async function fetchPageSpeed(url, strategy = "mobile") {
  const normalized = normalizeUrl(url);
  const safeStrategy = strategy === "desktop" ? "desktop" : "mobile";
  const cacheKey = `${safeStrategy}:${normalized}`;
  const cached = getPageSpeedCache(cacheKey);

  if (cached) {
    return {
      ...cached,
      cached: true
    };
  }

  const endpoint =
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

  const params = {
    url: normalized,
    strategy: safeStrategy,
    category: "performance",
    locale: "en"
  };

  if (process.env.PAGESPEED_API_KEY) {
    params.key = process.env.PAGESPEED_API_KEY;
  }

  const started = Date.now();

  const response = await axios.get(endpoint, {
    params,
    timeout: 55000,
    validateStatus: () => true,
    headers: {
      "User-Agent": "SEOHealthByDominic/2.1.0"
    }
  });

  if (response.status < 200 || response.status >= 300) {
    const googleMessage =
      response.data?.error?.message ||
      response.data?.message ||
      `Google PageSpeed returned HTTP ${response.status}.`;

    const err = new Error(googleMessage);
    err.status = response.status;
    throw err;
  }

  const raw = response.data || {};
  const lighthouse = raw.lighthouseResult || {};
  const audits = lighthouse.audits || {};
  const performanceScore =
    typeof lighthouse.categories?.performance?.score === "number"
      ? Math.round(lighthouse.categories.performance.score * 100)
      : null;

  const lab = {
    fcp: lighthouseMetric(audits, "first-contentful-paint"),
    lcp: lighthouseMetric(audits, "largest-contentful-paint"),
    cls: lighthouseMetric(audits, "cumulative-layout-shift"),
    tbt: lighthouseMetric(audits, "total-blocking-time"),
    speedIndex: lighthouseMetric(audits, "speed-index"),
    interactive: lighthouseMetric(audits, "interactive")
  };

  const pageExperience = raw.loadingExperience || null;
  const originExperience = raw.originLoadingExperience || null;

  const field = {
    source:
      pageExperience && Object.keys(pageExperience.metrics || {}).length
        ? "url"
        : originExperience && Object.keys(originExperience.metrics || {}).length
        ? "origin"
        : null,

    lcp:
      findCruxMetric(pageExperience, [
        "LARGEST_CONTENTFUL_PAINT_MS"
      ]) ||
      findCruxMetric(originExperience, [
        "LARGEST_CONTENTFUL_PAINT_MS"
      ]),

    inp:
      findCruxMetric(pageExperience, [
        "INTERACTION_TO_NEXT_PAINT",
        "INTERACTION_TO_NEXT_PAINT_MS"
      ]) ||
      findCruxMetric(originExperience, [
        "INTERACTION_TO_NEXT_PAINT",
        "INTERACTION_TO_NEXT_PAINT_MS"
      ]),

    cls:
      findCruxMetric(pageExperience, [
        "CUMULATIVE_LAYOUT_SHIFT_SCORE"
      ]) ||
      findCruxMetric(originExperience, [
        "CUMULATIVE_LAYOUT_SHIFT_SCORE"
      ]),

    fcp:
      findCruxMetric(pageExperience, [
        "FIRST_CONTENTFUL_PAINT_MS"
      ]) ||
      findCruxMetric(originExperience, [
        "FIRST_CONTENTFUL_PAINT_MS"
      ]),

    ttfb:
      findCruxMetric(pageExperience, [
        "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
        "TIME_TO_FIRST_BYTE_MS"
      ]) ||
      findCruxMetric(originExperience, [
        "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
        "TIME_TO_FIRST_BYTE_MS"
      ])
  };

  const result = {
    success: true,
    source: "Google PageSpeed Insights / Lighthouse",
    strategy: safeStrategy,
    testedUrl: normalized,
    finalUrl: raw.id || lighthouse.finalDisplayedUrl || normalized,
    performanceScore,
    lighthouseVersion: lighthouse.lighthouseVersion || null,
    analysisUTCTimestamp: raw.analysisUTCTimestamp || null,
    lab,
    field,
    opportunities: opportunityRows(audits),
    testMilliseconds: Date.now() - started,
    cached: false,
    fieldDataNote:
      field.source
        ? "Real-user field data is available for this URL or origin."
        : "Google did not provide enough real-user field data for this URL/origin. Missing field metrics are not guessed."
  };

  setPageSpeedCache(cacheKey, result);
  return result;
}

app.post("/pagespeed", async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const strategy =
      req.body?.strategy === "desktop" ? "desktop" : "mobile";

    const data = await fetchPageSpeed(url, strategy);

    res.json({
      success: true,
      generatedBy: "SEO Health by Dominic",
      product: BRAND.product,
      service: BRAND.service,
      apiVersion: BRAND.version,
      pageSpeed: data
    });
  } catch (error) {
    const status =
      error.status === 429 ? 429 :
      error.status >= 400 && error.status < 500 ? 400 : 502;

    res.status(status).json({
      success: false,
      generatedBy: "SEO Health by Dominic",
      product: BRAND.product,
      service: BRAND.service,
      apiVersion: BRAND.version,
      error:
        error.message ||
        "Google PageSpeed analysis could not be completed."
    });
  }
});

app.post("/audit", async (req, res) => {
  const auditStarted = Date.now();

  try {
    const requestedUrl = normalizeUrl(req.body.url);

    const { response, finalUrl, elapsedMs } =
      await fetchPage(requestedUrl);

    const html =
      typeof response.data === "string"
        ? response.data
        : String(response.data || "");

    if (!html) {
      throw new Error("The website did not return readable HTML.");
    }

    const statusCode = response.status;
    const htmlSizeBytes = Buffer.byteLength(html, "utf8");
    const htmlSizeKB = Math.round(htmlSizeBytes / 1024);

    const $ = cheerio.load(html);

    const title = normalizeText($("title").first().text());

    const metaDescription = normalizeText(
      $('meta[name="description"]').first().attr("content") || ""
    );

    const canonicalRaw =
      $('link[rel="canonical"]').first().attr("href") || "";

    const canonical = canonicalRaw
      ? absoluteUrl(canonicalRaw, finalUrl)
      : null;

    const canonicalStatus = canonicalState(canonical, finalUrl);

    const metaRobots = normalizeText(
      $('meta[name="robots"]').first().attr("content") || ""
    );

    const viewport = normalizeText(
      $('meta[name="viewport"]').first().attr("content") || ""
    );

    const language = normalizeText(
      $("html").attr("lang") || ""
    );

    const faviconRaw =
      $('link[rel~="icon"]').first().attr("href") || "";

    const favicon = faviconRaw
      ? absoluteUrl(faviconRaw, finalUrl)
      : null;

    const headings = collectHeadings($);
    const images = collectImages($, finalUrl);
    const links = collectLinks($, finalUrl);
    const schemaTypes = parseSchemaTypes($);

    const social = {
      ogTitle: normalizeText(
        $('meta[property="og:title"]').first().attr("content") || ""
      ),
      ogDescription: normalizeText(
        $('meta[property="og:description"]').first().attr("content") || ""
      ),
      ogImage:
        $('meta[property="og:image"]').first().attr("content") || "",
      twitterCard: normalizeText(
        $('meta[name="twitter:card"]').first().attr("content") || ""
      )
    };

    const textDoc = cheerio.load(html);
    textDoc("script,style,noscript,template").remove();

    const visibleText = normalizeText(textDoc("body").text());
    const wordCount = visibleText
      ? visibleText.split(/\s+/).filter(Boolean).length
      : 0;

    const { robots, sitemap } =
      await inspectRobotsAndSitemap(finalUrl);

    const checkedInternal = await limitedMap(
      links.internal.slice(0, 20),
      5,
      item => checkLink(item.url)
    );

    const checkedExternal = await limitedMap(
      links.external.slice(0, 10),
      4,
      item => checkLink(item.url)
    );

    const brokenInternal = checkedInternal.filter(x => x.broken);
    const brokenExternal = checkedExternal.filter(x => x.broken);

    const headers = {
      contentType: response.headers["content-type"] || "",
      contentEncoding: response.headers["content-encoding"] || "",
      cacheControl: response.headers["cache-control"] || "",
      server: response.headers["server"] || "",
      hsts: response.headers["strict-transport-security"] || "",
      csp: response.headers["content-security-policy"] || "",
      xContentTypeOptions:
        response.headers["x-content-type-options"] || "",
      referrerPolicy:
        response.headers["referrer-policy"] || "",
      frameProtection:
        response.headers["x-frame-options"] || ""
    };

    headers.securityCount = [
      headers.hsts,
      headers.csp,
      headers.xContentTypeOptions,
      headers.referrerPolicy,
      headers.frameProtection
    ].filter(Boolean).length;

    const checks = addChecks({
      finalUrl,
      statusCode,
      title,
      metaDescription,
      canonical,
      canonicalStatus,
      metaRobots,
      viewport,
      language,
      headings,
      images,
      links,
      schemaTypes,
      social,
      robots,
      sitemap,
      wordCount,
      brokenInternal,
      brokenExternal,
      responseTimeMs: elapsedMs,
      htmlSizeKB,
      headers
    });

    const totalWeight = checks.reduce(
      (sum, c) => sum + (c.weight || 0),
      0
    );

    const totalLost = checks.reduce(
      (sum, c) => sum + (c.deduction || 0),
      0
    );

    const score = Math.max(
      0,
      Math.round(100 - (totalLost / totalWeight) * 100)
    );

    const critical = checks.filter(c => c.status === "fail");
    const warnings = checks.filter(c => c.status === "warn");
    const passed = checks.filter(c => c.status === "pass");

    const priorities = [...critical, ...warnings].sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      return (b.deduction || 0) - (a.deduction || 0);
    });

    const noindex = /(^|,|\s)noindex($|,|\s)/i.test(metaRobots);

    res.json({
      success: true,
      generatedBy: "SEO Health by Dominic",
      product: BRAND.product,
      service: BRAND.service,
      auditVersion: BRAND.version,

      summary: {
        score,
        grade: grade(score),
        passed: passed.length,
        warnings: warnings.length,
        critical: critical.length,
        totalChecks: checks.length,
        categoryScores: categoryScores(checks),
        topPriorities: priorities.slice(0, 5).map(x => ({
          id: x.id,
          title: x.title,
          severity: x.severity,
          found: x.found,
          recommended: x.recommended,
          fix: x.fix
        }))
      },

      website: {
        requestedUrl,
        finalUrl,
        statusCode,
        https: finalUrl.startsWith("https://"),
        redirected: requestedUrl !== finalUrl,
        responseTimeMs: elapsedMs,
        htmlSizeBytes,
        htmlSizeKB
      },

      indexability: {
        indexable:
          statusCode >= 200 &&
          statusCode < 400 &&
          !noindex &&
          !robots.blocksAll,
        metaRobots: metaRobots || "Not specified",
        robotsBlocksAll: robots.blocksAll
      },

      page: {
        title,
        titleLength: title.length,
        metaDescription,
        metaDescriptionLength: metaDescription.length,
        canonical,
        canonicalStatus,
        language: language || null,
        viewport: viewport || null,
        favicon,
        wordCount
      },

      headings,

      images: {
        total: images.total,
        missingAlt: images.missingAlt,
        emptyAlt: images.emptyAlt,
        informativeAlt: images.informativeAlt,
        lazyLoaded: images.lazyLoaded,
        sample: images.images.slice(0, 20)
      },

      links: {
        internal: links.internal.length,
        external: links.external.length,
        internalSampleChecked: checkedInternal.length,
        externalSampleChecked: checkedExternal.length,
        brokenInternal,
        brokenExternal,
        internalLinks: links.internal.slice(0, 50),
        externalLinks: links.external.slice(0, 30)
      },

      robots,
      sitemap,

      schema: {
        count: schemaTypes.length,
        types: schemaTypes
      },

      social,
      headers,
      checks,

      timing: {
        auditMilliseconds: Date.now() - auditStarted
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      generatedBy: "SEO Health by Dominic",
      product: BRAND.product,
      service: BRAND.service,
      error: error.message || "Website audit failed."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `SEO Health by Dominic API v${BRAND.version} running on port ${PORT}`
  );
});
