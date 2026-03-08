import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/proxy-fetch`;

function getHeaders(isNavigate = true) {
  return {
    "User-Agent":
      "Mozilla/5.0 (X11; CrOS x86_64 14816.131.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: isNavigate
      ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
      : "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-CH-UA": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Platform": '"Chrome OS"',
    "Sec-CH-UA-Mobile": "?0",
  };
}

// Build a proxy URL for a given target URL
function proxyUrl(targetUrl: string): string {
  return `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

// Resolve a potentially relative URL against a base
function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// Rewrite URLs in HTML to go through the proxy
function rewriteHtml(html: string, baseUrl: string): string {
  // Remove CSP and X-Frame-Options
  html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*name=["']?referrer["']?[^>]*>/gi, "");

  // Inject base tag and referrer policy
  const headInsert = `<meta name="referrer" content="no-referrer"><base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, `$&${headInsert}`);
  } else {
    html = headInsert + html;
  }

  // Rewrite src attributes on media/script/iframe elements to proxy
  html = html.replace(
    /(<(?:img|script|iframe|source|video|audio|embed)\b[^>]*?\s)src\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (match, prefix, quote, url) => {
      if (url.startsWith("data:")) return match;
      const abs = url.startsWith("//") ? "https:" + url : url;
      return `${prefix}src=${quote}${proxyUrl(abs)}${quote}`;
    }
  );

  // Rewrite link[stylesheet] href
  html = html.replace(
    /(<link\b[^>]*?rel\s*=\s*["']stylesheet["'][^>]*?\s)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (match, prefix, quote, url) => {
      const abs = url.startsWith("//") ? "https:" + url : url;
      return `${prefix}href=${quote}${proxyUrl(abs)}${quote}`;
    }
  );
  // Also handle href before rel
  html = html.replace(
    /(<link\b[^>]*?)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2([^>]*?rel\s*=\s*["']stylesheet["'])/gi,
    (match, prefix, quote, url, suffix) => {
      const abs = url.startsWith("//") ? "https:" + url : url;
      return `${prefix}href=${quote}${proxyUrl(abs)}${quote}${suffix}`;
    }
  );

  // Rewrite CSS url() references
  html = html.replace(
    /url\(\s*(["']?)((?:https?:)?\/\/[^"')]+)\1\s*\)/gi,
    (match, quote, url) => {
      const abs = url.startsWith("//") ? "https:" + url : url;
      return `url(${quote}${proxyUrl(abs)}${quote})`;
    }
  );

  // Inject script to intercept link clicks and form submissions, rewriting through proxy
  const interceptScript = `
<script>
(function() {
  var PROXY = "${PROXY_BASE}";
  
  function postNav(proxyUrl, targetUrl) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'proxy-navigate', url: proxyUrl, targetUrl: targetUrl }, '*');
    }
  }
  
  // Intercept link clicks
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a');
    if (!link || !link.href) return;
    var href = link.href;
    if (href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('data:')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Extract real URL from DDG redirects
    try {
      var u = new URL(href);
      if (u.hostname.includes('duckduckgo.com') && u.pathname === '/l/') {
        var uddg = u.searchParams.get('uddg');
        if (uddg) href = uddg;
      }
    } catch(ex) {}
    
    var pUrl = PROXY + '?url=' + encodeURIComponent(href);
    postNav(pUrl, href);
  }, true);
  
  // Intercept form submissions  
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form) return;
    
    e.preventDefault();
    var formData = new FormData(form);
    var params = new URLSearchParams(formData).toString();
    var action = form.action || window.location.href;
    
    if (!form.method || form.method.toUpperCase() === 'GET') {
      var sep = action.includes('?') ? '&' : '?';
      var targetUrl = action + sep + params;
      var pUrl = PROXY + '?url=' + encodeURIComponent(targetUrl);
      postNav(pUrl, targetUrl);
    }
  }, true);
})();
</script>`;

  html = html.replace(/<\/body>/i, interceptScript + '</body>');

  return html;
}

// Rewrite CSS content to proxy url() references
function rewriteCss(css: string, baseUrl: string): string {
  return css.replace(
    /url\(\s*(["']?)((?:https?:)?\/\/[^"')]+)\1\s*\)/gi,
    (match, quote, url) => {
      const abs = url.startsWith("//") ? "https:" + url : url;
      return `url(${quote}${proxyUrl(abs)}${quote})`;
    }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");

    // === GET mode: Direct proxy (for iframe src, assets) ===
    if (targetUrl) {
      let resolvedUrl = targetUrl;
      if (!resolvedUrl.startsWith("http://") && !resolvedUrl.startsWith("https://")) {
        resolvedUrl = "https://" + resolvedUrl;
      }

      console.log(`Proxying: ${resolvedUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(resolvedUrl, {
        headers: getHeaders(true),
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const contentType = response.headers.get("content-type") || "";
      const finalUrl = response.url;

      // HTML content - rewrite and serve directly
      if (contentType.includes("text/html")) {
        let html = await response.text();
        html = rewriteHtml(html, finalUrl);

        return new Response(html, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "X-Proxy-Final-URL": finalUrl,
          },
        });
      }

      // CSS content - rewrite url() references
      if (contentType.includes("text/css")) {
        let css = await response.text();
        css = rewriteCss(css, finalUrl);
        return new Response(css, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
          },
        });
      }

      // Everything else (JS, images, fonts, etc.) - pass through directly
      const body = await response.arrayBuffer();
      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // === POST mode: JSON API (for initial search/URL from the app) ===
    const { url: inputUrl } = await req.json();

    if (!inputUrl) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let finalTarget = inputUrl.trim();
    if (!finalTarget.startsWith("http://") && !finalTarget.startsWith("https://")) {
      finalTarget = "https://" + finalTarget;
    }

    // Return the proxy URL for the iframe to load
    const iframeUrl = proxyUrl(finalTarget);

    return new Response(
      JSON.stringify({ proxyUrl: iframeUrl, targetUrl: finalTarget }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Proxy error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to fetch the URL" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
