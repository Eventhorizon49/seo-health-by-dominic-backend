const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;

const BRAND = {
  product: "SEO Health by Dominic",
  service: "SEO Health by Dominic API",
  version: "1.0.0"
};

/* ---------------------------------
   BASIC ROUTES
---------------------------------- */

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
    service: BRAND.service
  });
});

/* ---------------------------------
   HELPERS
---------------------------------- */

function normalizeUrl(input) {
  let url = String(input || "").trim();

  if (!url) {
    throw new Error("Website URL is required.");
  }

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  const parsed = new URL(url);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  return parsed.href;
}

async function fetchPage(url) {
  return axios.get(url, {
    timeout: 15000,
    maxRedirects: 10,
    responseType: "text",

    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SEOHealthByDominic/1.0; Website SEO Auditor)",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },

    validateStatus: () => true
  });
}

async function fetchOptional(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SEOHealthByDominic/1.0; Website SEO Auditor)"
      },
      validateStatus: () => true
    });

    return {
      reachable: true,
      status: response.status,
      data:
        typeof response.data === "string"
          ? response.data
          : JSON.stringify(response.data)
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      data: "",
      error: error.message
    };
  }
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/* ---------------------------------
   MAIN SEO AUDIT
---------------------------------- */

app.post("/audit", async (req, res) => {
  const started = Date.now();

  try {
    const requestedUrl = normalizeUrl(req.body.url);

    const response = await fetchPage(requestedUrl);

    if (!response.data || typeof response.data !== "string") {
      throw new Error("The website did not return readable HTML.");
    }

    const finalUrl =
      response.request?.res?.responseUrl ||
      requestedUrl;

    const $ = cheerio.load(response.data);

    /* ---------- PAGE BASICS ---------- */

    const title = $("title").first().text().trim();

    const metaDescription =
      $('meta[name="description"]')
        .attr("content")
        ?.trim() || "";

    const canonical =
      $('link[rel="canonical"]')
        .attr("href") || "";

    const metaRobots =
      $('meta[name="robots"]')
        .attr("content") || "";

    const viewport =
      $('meta[name="viewport"]')
        .attr("content") || "";

    const language =
      $("html").attr("lang") || "";

    /* ---------- HEADINGS ---------- */

    const headings = {
      h1: $("h1").length,
      h2: $("h2").length,
      h3: $("h3").length,
      h4: $("h4").length,
      h5: $("h5").length,
      h6: $("h6").length
    };

    const h1Text = $("h1")
      .map((i, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    /* ---------- CONTENT ---------- */

    $("script, style, noscript").remove();

    const visibleText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const wordCount = visibleText
      ? visibleText.split(/\s+/).length
      : 0;

    /* ---------- IMAGES ---------- */

    let missingAlt = 0;
    let emptyAlt = 0;

    const images = $("img")
      .map((i, el) => {
        const src = $(el).attr("src") || "";
        const hasAlt = $(el).is("[alt]");
        const alt = $(el).attr("alt") || "";

        if (!hasAlt) missingAlt++;
        else if (!alt.trim()) emptyAlt++;

        return {
          src: absoluteUrl(src, finalUrl),
          alt: alt,
          hasAlt: hasAlt
        };
      })
      .get();

    /* ---------- LINKS ---------- */

    const internalLinks = [];
    const externalLinks = [];

    const siteHost = new URL(finalUrl).hostname;

    $("a[href]").each((i, el) => {
      const href = $(el).attr("href");
      const full = absoluteUrl(href, finalUrl);

      if (!full) return;

      try {
        const parsed = new URL(full);

        if (!["http:", "https:"].includes(parsed.protocol)) {
          return;
        }

        const link = {
          url: full,
          text: $(el).text().trim(),
          nofollow:
            ($(el).attr("rel") || "")
              .toLowerCase()
              .includes("nofollow")
        };

        if (parsed.hostname === siteHost) {
          internalLinks.push(link);
        } else {
          externalLinks.push(link);
        }
      } catch {}
    });

    /* ---------- SCHEMA ---------- */

    const schemas = [];

    $('script[type="application/ld+json"]').each(
      (i, el) => {
        try {
          const parsed = JSON.parse($(el).html());

          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (item?.["@type"]) {
                schemas.push(item["@type"]);
              }
            });
          } else if (parsed?.["@type"]) {
            schemas.push(parsed["@type"]);
          } else if (parsed?.["@graph"]) {
            parsed["@graph"].forEach(item => {
              if (item?.["@type"]) {
                schemas.push(item["@type"]);
              }
            });
          }
        } catch {}
      }
    );

    /* ---------- SOCIAL SEO ---------- */

    const social = {
      ogTitle:
        $('meta[property="og:title"]')
          .attr("content") || "",

      ogDescription:
        $('meta[property="og:description"]')
          .attr("content") || "",

      ogImage:
        $('meta[property="og:image"]')
          .attr("content") || "",

      twitterCard:
        $('meta[name="twitter:card"]')
          .attr("content") || ""
    };

    /* ---------- SITE FILES ---------- */

    const origin = new URL(finalUrl).origin;

    const robotsUrl = origin + "/robots.txt";

    const robots = await fetchOptional(robotsUrl);

    const robotsValid =
      robots.status === 200 &&
      /user-agent:/i.test(robots.data);

    const robotsBlocksAll =
      robotsValid &&
      /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(?:\r?\n|$)/i.test(
        robots.data
      );

    const sitemapReferences = [];

    if (robotsValid) {
      const matches =
        robots.data.matchAll(
          /^\s*sitemap:\s*(.+)$/gim
        );

      for (const match of matches) {
        sitemapReferences.push(
          match[1].trim()
        );
      }
    }

    /* ---------- SITEMAP ---------- */

    const sitemapCandidates = [
      ...sitemapReferences,
      origin + "/sitemap.xml",
      origin + "/sitemap_index.xml"
    ];

    let sitemap = {
      found: false,
      url: null,
      status: null,
      type: null,
      urlCount: 0
    };

    for (const candidate of [
      ...new Set(sitemapCandidates)
    ]) {
      const check =
        await fetchOptional(candidate);

      if (
        check.status === 200 &&
        /<(urlset|sitemapindex)\b/i.test(
          check.data
        )
      ) {
        sitemap.found = true;
        sitemap.url = candidate;
        sitemap.status = check.status;

        sitemap.type =
          /<sitemapindex\b/i.test(check.data)
            ? "sitemap-index"
            : "urlset";

        sitemap.urlCount =
          (
            check.data.match(/<loc>/gi) || []
          ).length;

        break;
      }
    }

    /* ---------- INDEXABILITY ---------- */

    const noindex =
      /noindex/i.test(metaRobots);

    const indexability = {
      indexable:
        response.status >= 200 &&
        response.status < 400 &&
        !noindex &&
        !robotsBlocksAll,

      metaRobots:
        metaRobots || "Not specified",

      robotsBlocksAll
    };

    /* ---------- RESPONSE HEADERS ---------- */

    const headers = {
      contentType:
        response.headers["content-type"] || "",

      contentEncoding:
        response.headers["content-encoding"] || "",

      cacheControl:
        response.headers["cache-control"] || "",

      server:
        response.headers["server"] || ""
    };

    /* ---------- SIMPLE DIAGNOSIS ---------- */

    const issues = [];

    if (!title) {
      issues.push({
        severity: "critical",
        issue: "Missing page title",
        found: "0 characters",
        recommended: "30–60 characters"
      });
    } else if (
      title.length < 30 ||
      title.length > 60
    ) {
      issues.push({
        severity: "warning",
        issue: "Page title length",
        found: `${title.length} characters`,
        recommended: "30–60 characters"
      });
    }

    if (!metaDescription) {
      issues.push({
        severity: "critical",
        issue: "Missing meta description",
        found: "0 characters",
        recommended: "70–160 characters"
      });
    } else if (
      metaDescription.length < 70 ||
      metaDescription.length > 160
    ) {
      issues.push({
        severity: "warning",
        issue: "Meta description length",
        found:
          `${metaDescription.length} characters`,
        recommended: "70–160 characters"
      });
    }

    if (headings.h1 === 0) {
      issues.push({
        severity: "warning",
        issue: "Missing H1",
        found: "0 H1 headings",
        recommended: "1 clear page-level H1"
      });
    }

    if (headings.h1 > 1) {
      issues.push({
        severity: "warning",
        issue: "Multiple H1 headings",
        found: `${headings.h1} H1 headings`,
        recommended: "1 clear page-level H1"
      });
    }

    if (missingAlt > 0) {
      issues.push({
        severity: "warning",
        issue: "Images missing ALT attributes",
        found: `${missingAlt} images`,
        recommended:
          "Descriptive ALT text for meaningful images"
      });
    }

    if (!canonical) {
      issues.push({
        severity: "warning",
        issue: "Canonical tag missing",
        found: "Missing",
        recommended:
          "Valid canonical URL where appropriate"
      });
    }

    if (noindex) {
      issues.push({
        severity: "critical",
        issue: "Page marked noindex",
        found: metaRobots,
        recommended:
          "Index unless intentionally excluded"
      });
    }

    if (robotsBlocksAll) {
      issues.push({
        severity: "critical",
        issue: "robots.txt blocks all crawling",
        found: "Disallow: /",
        recommended:
          "Do not block the entire public site"
      });
    }

    if (!sitemap.found) {
      issues.push({
        severity: "warning",
        issue: "XML sitemap not confirmed",
        found: "Not found",
        recommended:
          "Accessible XML sitemap"
      });
    }

    if (!viewport) {
      issues.push({
        severity: "warning",
        issue: "Viewport meta tag missing",
        found: "Missing",
        recommended:
          "Mobile-friendly viewport declaration"
      });
    }

    if (!language) {
      issues.push({
        severity: "warning",
        issue: "HTML language missing",
        found: "Missing",
        recommended:
          "Valid lang attribute"
      });
    }

    /* ---------- SCORE ---------- */

    let score = 100;

    for (const issue of issues) {
      if (issue.severity === "critical") {
        score -= 10;
      } else {
        score -= 4;
      }
    }

    score = Math.max(0, score);

    /* ---------- RESULT ---------- */

    res.json({
      success: true,

      generatedBy:
        "SEO Health by Dominic",

      auditVersion: "1.0",

      website: {
        requestedUrl,
        finalUrl,
        statusCode: response.status,
        https:
          finalUrl.startsWith("https://")
      },

      score,

      page: {
        title,
        titleLength: title.length,

        metaDescription,
        metaDescriptionLength:
          metaDescription.length,

        canonical:
          canonical
            ? absoluteUrl(
                canonical,
                finalUrl
              )
            : null,

        language:
          language || null,

        viewport:
          viewport || null,

        wordCount
      },

      headings: {
        ...headings,
        h1Text
      },

      images: {
        total: images.length,
        missingAlt,
        emptyAlt
      },

      links: {
        internal:
          internalLinks.length,

        external:
          externalLinks.length,

        internalLinks,
        externalLinks
      },

      indexability,

      robots: {
        url: robotsUrl,
        found: robotsValid,
        status: robots.status,
        blocksAll:
          robotsBlocksAll,
        sitemapReferences
      },

      sitemap,

      schema: {
        count: schemas.length,
        types: [
          ...new Set(
            schemas.flat()
          )
        ]
      },

      social,

      headers,

      issues,

      timing: {
        auditMilliseconds:
          Date.now() - started
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      generatedBy:
        "SEO Health by Dominic",
      error:
        error.message ||
        "Website audit failed."
    });
  }
});

/* ---------------------------------
   START SERVER
---------------------------------- */

app.listen(PORT, () => {
  console.log(
    `SEO Health by Dominic API running on port ${PORT}`
  );
});
