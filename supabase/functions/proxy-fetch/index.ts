import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/proxy-fetch`;

function browserHeaders(referer?: string) {
  const h: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (X11; CrOS x86_64 14816.131.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Sec-CH-UA": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Platform": '"Chrome OS"',
    "Sec-CH-UA-Mobile": "?0",
    "Upgrade-Insecure-Requests": "1",
  };
  if (referer) h["Referer"] = referer;
  return h;
}

function px(targetUrl: string): string {
  return `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

function absUrl(url: string): string {
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

// ── HTML Rewriter ──────────────────────────────────────────────
function rewriteHtml(html: string, baseUrl: string): string {
  // Strip security headers that block iframe embedding
  html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?X-Frame-Options["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*name\s*=\s*["']?referrer["']?[^>]*>/gi, "");

  // Inject base + referrer policy early in <head>
  const headPayload = `<meta name="referrer" content="no-referrer"><base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, `$&${headPayload}`);
  } else {
    html = headPayload + html;
  }

  // Rewrite absolute src on media / script / iframe elements
  html = html.replace(
    /(<(?:img|script|iframe|source|video|audio|embed|input)\b[^>]*?\s)src\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (_m, pre, q, url) => (url.startsWith("data:") ? _m : `${pre}src=${q}${px(absUrl(url))}${q}`)
  );

  // Rewrite srcset
  html = html.replace(
    /srcset\s*=\s*(["'])(.*?)\1/gi,
    (_m, q, val) => {
      const rewritten = val.replace(/((?:https?:)?\/\/[^\s,]+)/gi, (u: string) => px(absUrl(u)));
      return `srcset=${q}${rewritten}${q}`;
    }
  );

  // Rewrite poster attribute
  html = html.replace(
    /poster\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\1/gi,
    (_m, q, url) => `poster=${q}${px(absUrl(url))}${q}`
  );

  // Rewrite link[stylesheet] href (rel before href)
  html = html.replace(
    /(<link\b[^>]*?rel\s*=\s*["']stylesheet["'][^>]*?)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (_m, pre, q, url) => `${pre}href=${q}${px(absUrl(url))}${q}`
  );
  // href before rel
  html = html.replace(
    /(<link\b[^>]*?)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2([^>]*?rel\s*=\s*["']stylesheet["'])/gi,
    (_m, pre, q, url, suf) => `${pre}href=${q}${px(absUrl(url))}${q}${suf}`
  );

  // Rewrite link[preload/preconnect/icon] href
  html = html.replace(
    /(<link\b[^>]*?rel\s*=\s*["'](?:preload|prefetch|icon|shortcut icon|apple-touch-icon)["'][^>]*?)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (_m, pre, q, url) => `${pre}href=${q}${px(absUrl(url))}${q}`
  );

  // Rewrite inline style url()
  html = html.replace(
    /url\(\s*(["']?)((?:https?:)?\/\/[^"')]+)\1\s*\)/gi,
    (_m, q, url) => `url(${q}${px(absUrl(url))}${q})`
  );

  // ── Injected runtime script ──
  const script = `
<script>
(function(){
  var P="${PROXY_BASE}";
  var BASE="${baseUrl}";

  function pxUrl(u){
    if(!u||u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('javascript:'))return u;
    try{var a=new URL(u,BASE);if(a.protocol==='http:'||a.protocol==='https:')return P+'?url='+encodeURIComponent(a.href)}catch(e){}
    return u;
  }
  function realUrl(href){
    try{
      var u=new URL(href);
      if(u.hostname.includes('duckduckgo.com')&&u.pathname==='/l/'){var d=u.searchParams.get('uddg');if(d)return d}
      if(u.hostname.includes('google.com')&&u.pathname==='/url'){var q=u.searchParams.get('q')||u.searchParams.get('url');if(q)return q}
    }catch(e){}
    return href;
  }

  // Intercept fetch
  var _fetch=window.fetch;
  window.fetch=function(input,init){
    if(typeof input==='string'){input=pxUrl(input)}
    else if(input instanceof Request){input=new Request(pxUrl(input.url),input)}
    return _fetch.call(this,input,init);
  };

  // Intercept XMLHttpRequest
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    arguments[1]=pxUrl(url);
    return _open.apply(this,arguments);
  };

  // Intercept link clicks
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');
    if(!a||!a.href)return;
    var h=a.href;
    if(h.startsWith('javascript:')||h.startsWith('#')||h.startsWith('data:'))return;
    e.preventDefault();e.stopPropagation();
    h=realUrl(h);
    // If already a proxy URL, extract the target
    if(h.includes('/functions/v1/proxy-fetch')){
      try{var pu=new URL(h);var t=pu.searchParams.get('url');if(t)h=t;}catch(e){}
    }
    window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(h),targetUrl:h},'*');
  },true);

  // Intercept form submissions
  document.addEventListener('submit',function(e){
    var f=e.target;if(!f)return;
    e.preventDefault();
    var fd=new FormData(f);
    var p=new URLSearchParams(fd).toString();
    var act=f.action||BASE;
    if(!f.method||f.method.toUpperCase()==='GET'){
      var sep=act.includes('?')?'&':'?';
      var t=act+sep+p;
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(t),targetUrl:t},'*');
    }
  },true);

  // Intercept window.open
  var _wopen=window.open;
  window.open=function(url){
    if(url){
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(url),targetUrl:url},'*');
    }
    return null;
  };

  // MutationObserver to rewrite dynamically added elements
  var observer=new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        // Rewrite src
        if(n.src&&(n.src.startsWith('http://')||n.src.startsWith('https://'))&&!n.src.includes('/functions/v1/proxy-fetch')){
          n.src=pxUrl(n.src);
        }
        // Rewrite child elements with src
        if(n.querySelectorAll){
          n.querySelectorAll('[src]').forEach(function(el){
            if(el.src&&(el.src.startsWith('http://')||el.src.startsWith('https://'))&&!el.src.includes('/functions/v1/proxy-fetch')){
              el.src=pxUrl(el.src);
            }
          });
        }
      });
    });
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

  if (/<\/head>/i.test(html)) {
    // Inject early so fetch/XHR is intercepted before page scripts run
    html = html.replace(/<\/head>/i, script + '</head>');
  } else {
    html = script + html;
  }

  return html;
}

// ── CSS Rewriter ──────────────────────────────────────────────
function rewriteCss(css: string): string {
  return css.replace(
    /url\(\s*(["']?)((?:https?:)?\/\/[^"')]+)\1\s*\)/gi,
    (_m, q, url) => `url(${q}${px(absUrl(url))}${q})`
  );
}

// ── Main Handler ──────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");

    // ═══ GET mode: proxy any URL ═══
    if (targetUrl) {
      let resolved = targetUrl;
      if (!/^https?:\/\//i.test(resolved)) resolved = "https://" + resolved;

      console.log(`Proxy → ${resolved}`);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);

      const res = await fetch(resolved, {
        headers: browserHeaders(),
        redirect: "follow",
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      const ct = res.headers.get("content-type") || "";
      const finalUrl = res.url;

      // HTML → rewrite & serve
      if (ct.includes("text/html") || ct.includes("application/xhtml")) {
        let html = await res.text();
        html = rewriteHtml(html, finalUrl);
        return new Response(html, {
          status: res.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "X-Final-URL": finalUrl,
          },
        });
      }

      // CSS → rewrite url()
      if (ct.includes("text/css")) {
        let css = await res.text();
        css = rewriteCss(css);
        return new Response(css, {
          headers: { ...corsHeaders, "Content-Type": ct, "Cache-Control": "public, max-age=3600" },
        });
      }

      // JavaScript → pass through but add CORS
      if (ct.includes("javascript") || ct.includes("ecmascript")) {
        const body = await res.arrayBuffer();
        return new Response(body, {
          headers: { ...corsHeaders, "Content-Type": ct, "Cache-Control": "public, max-age=3600" },
        });
      }

      // Everything else (images, fonts, wasm, etc.) → stream through
      const body = await res.arrayBuffer();
      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": ct || "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ═══ POST mode: JSON API for the frontend ═══
    const { url: inputUrl } = await req.json();
    if (!inputUrl) {
      return new Response(JSON.stringify({ error: "URL is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let target = inputUrl.trim();
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;

    return new Response(JSON.stringify({ proxyUrl: px(target), targetUrl: target }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Proxy error:", err);

    // Return a nice error page for GET requests
    const requestUrl = new URL(req.url);
    if (requestUrl.searchParams.get("url")) {
      const errorHtml = `<!DOCTYPE html><html><head><style>
        body{font-family:system-ui;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
        .box{text-align:center;padding:2rem;max-width:400px}
        h1{color:#ff4444;font-size:1.5rem}
        p{color:#888;font-size:0.9rem;line-height:1.6}
        code{background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:0.8rem}
      </style></head><body><div class="box">
        <h1>⚠ Failed to Load</h1>
        <p>${err.message || "The site couldn't be reached. It may be blocking proxy access or the connection timed out."}</p>
        <p>Try a different site or search for it instead.</p>
      </div></body></html>`;
      return new Response(errorHtml, {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ error: err.message || "Failed to fetch" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
