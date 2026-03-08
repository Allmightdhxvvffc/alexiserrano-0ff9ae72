import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

function getHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (X11; CrOS x86_64 14816.131.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Sec-CH-UA": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Platform": '"Chrome OS"',
    "Sec-CH-UA-Mobile": "?0",
  };
}

function rewriteUrls(html: string, baseUrl: string): string {
  const proxyBase = `${SUPABASE_URL}/functions/v1/proxy-fetch`;

  // Rewrite image src, link href (CSS), script src to go through proxy-asset
  // We'll rewrite absolute URLs in src/href attributes to proxy them
  html = html.replace(
    /(src|href|action)=(["'])((?:https?:)?\/\/[^"']+)\2/gi,
    (match, attr, quote, url) => {
      // Don't proxy data: URIs, anchors, or javascript:
      if (url.startsWith("data:") || url.startsWith("javascript:") || url.startsWith("#")) {
        return match;
      }
      // Make protocol-relative URLs absolute
      let absoluteUrl = url;
      if (url.startsWith("//")) {
        absoluteUrl = "https:" + url;
      }
      // For CSS/JS/images, use the asset proxy endpoint
      return `${attr}=${quote}${proxyBase}?asset=${encodeURIComponent(absoluteUrl)}${quote}`;
    }
  );

  // Rewrite CSS url() references
  html = html.replace(
    /url\((["']?)((?:https?:)?\/\/[^"')]+)\1\)/gi,
    (match, quote, url) => {
      let absoluteUrl = url.startsWith("//") ? "https:" + url : url;
      return `url(${quote}${proxyBase}?asset=${encodeURIComponent(absoluteUrl)}${quote})`;
    }
  );

  return html;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const assetUrl = url.searchParams.get("asset");

    // Asset proxy mode - for images, CSS, JS etc.
    if (assetUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(assetUrl, {
          headers: getHeaders(),
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const body = await response.arrayBuffer();

        return new Response(body, {
          headers: {
            ...corsHeaders,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (e) {
        clearTimeout(timeout);
        return new Response("", {
          status: 502,
          headers: corsHeaders,
        });
      }
    }

    // Main HTML proxy mode
    const { url: targetInput } = await req.json();

    if (!targetInput) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let targetUrl = targetInput.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    console.log(`Proxying request to: ${targetUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(targetUrl, {
      headers: getHeaders(),
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") || "";
    const finalUrl = response.url;

    if (contentType.includes("text/html")) {
      let html = await response.text();

      // Inject <base> tag for relative URL resolution
      const baseTag = `<base href="${finalUrl}" target="_self">`;
      if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, `<head>${baseTag}`);
      } else {
        html = baseTag + html;
      }

      // Remove Content-Security-Policy meta tags
      html = html.replace(/<meta[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");
      // Remove X-Frame-Options meta
      html = html.replace(/<meta[^>]*http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "");
      // Remove existing referrer policy
      html = html.replace(/<meta[^>]*name=["']?referrer["']?[^>]*>/gi, "");
      // Inject no-referrer policy
      html = html.replace(/<head[^>]*>/i, `$&<meta name="referrer" content="no-referrer">`);

      // Rewrite asset URLs to go through the proxy
      html = rewriteUrls(html, finalUrl);

      return new Response(
        JSON.stringify({ html, finalUrl, contentType: "text/html" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For non-HTML, return info
    const body = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(body).slice(0, 50000)));

    return new Response(
      JSON.stringify({ finalUrl, contentType, size: body.byteLength, base64Preview: base64 }),
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
