import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const PROXY_BASE = `${SUPABASE_URL}/functions/v1/proxy-fetch`;
const BROWSERLESS_API_KEY = Deno.env.get("BROWSERLESS_API_KEY") || "";

// ── Cookie jar (in-memory, per-isolate) ──
const cookieJar = new Map<string, string>();

function domainKey(url: string): string {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}

function storeCookies(url: string, headers: Headers) {
  const domain = domainKey(url);
  const existing = cookieJar.get(domain) || "";
  const newCookies: string[] = [];
  headers.forEach((v, k) => {
    if (k.toLowerCase() === "set-cookie") {
      const val = v.split(";")[0]?.trim();
      if (val) newCookies.push(val);
    }
  });
  if (newCookies.length) {
    const merged = new Map<string, string>();
    existing.split("; ").filter(Boolean).forEach(c => {
      const [n] = c.split("=");
      if (n) merged.set(n, c);
    });
    newCookies.forEach(c => {
      const [n] = c.split("=");
      if (n) merged.set(n, c);
    });
    cookieJar.set(domain, [...merged.values()].join("; "));
  }
}

function getCookies(url: string): string {
  return cookieJar.get(domainKey(url)) || "";
}

function browserHeaders(targetUrl: string, referer?: string) {
  const h: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
  if (referer) h["Referer"] = referer;
  const cookies = getCookies(targetUrl);
  if (cookies) h["Cookie"] = cookies;
  return h;
}

function px(targetUrl: string): string {
  return `${PROXY_BASE}?url=${encodeURIComponent(targetUrl)}`;
}

function absUrl(url: string): string {
  if (url.startsWith("//")) return "https:" + url;
  return url;
}

// ── Cloudflare / bot-protection detection ──
function isCloudflareChallenge(html: string, status: number): boolean {
  if (status === 403 || status === 503) {
    const markers = [
      "cf-browser-verification",
      "cf_chl_opt",
      "challenge-platform",
      "Just a moment",
      "Checking your browser",
      "cf-turnstile",
      "Attention Required! | Cloudflare",
      "_cf_chl_tk",
      "ray ID",
    ];
    const lower = html.toLowerCase();
    return markers.some(m => lower.includes(m.toLowerCase()));
  }
  // Some sites return 200 but with a challenge page
  if (html.includes("cf_chl_opt") || html.includes("challenge-platform")) return true;
  return false;
}

// ── Browserless.io headless Chrome fetch ──
async function fetchWithBrowserless(url: string): Promise<{ html: string; finalUrl: string }> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error("Browserless API key not configured");
  }

  console.log(`Browserless → ${url}`);

  // Use Browserless /content API to get fully rendered HTML
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);

  const res = await fetch(`https://chrome.browserless.io/content?token=${BROWSERLESS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      waitForSelector: { selector: "body", timeout: 15000 },
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 30000,
      },
      // Block unnecessary resources to speed things up
      rejectResourceTypes: ["font"],
      bestAttempt: true,
    }),
    signal: ctrl.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Browserless error ${res.status}: ${errText}`);
    throw new Error(`Browserless returned ${res.status}`);
  }

  const html = await res.text();
  return { html, finalUrl: url };
}

// ── HTML Rewriter ──
function rewriteHtml(html: string, baseUrl: string): string {
  // Strip security meta tags
  html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?X-Frame-Options["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]*name\s*=\s*["']?referrer["']?[^>]*>/gi, "");

  // Rewrite meta refresh redirects
  html = html.replace(
    /(<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']\d+;\s*url=)(https?:\/\/[^"'>\s]+)/gi,
    (_m, pre, url) => `${pre}${px(url)}`
  );

  // Strip integrity, nonce, crossorigin attributes
  html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, "");
  html = html.replace(/\s+nonce\s*=\s*["'][^"']*["']/gi, "");
  html = html.replace(/\s+crossorigin(?:\s*=\s*["'][^"']*["'])?/gi, "");

  // Inject base + referrer policy early in <head>
  const headPayload = `<meta name="referrer" content="no-referrer"><base href="${baseUrl}">`;
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, `$&${headPayload}`);
  } else {
    html = headPayload + html;
  }

  // Rewrite absolute src
  html = html.replace(
    /(<(?:img|script|iframe|source|video|audio|embed|input|link)\b[^>]*?\s)src\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (_m, pre, q, url) => url.startsWith("data:") ? _m : `${pre}src=${q}${px(absUrl(url))}${q}`
  );

  // Rewrite link href
  html = html.replace(
    /(<(?:link)\b[^>]*?\s)href\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\2/gi,
    (_m, pre, q, url) => `${pre}href=${q}${px(absUrl(url))}${q}`
  );

  // Rewrite srcset
  html = html.replace(
    /srcset\s*=\s*(["'])(.*?)\1/gi,
    (_m, q, val) => {
      const rewritten = val.replace(/((?:https?:)?\/\/[^\s,]+)/gi, (u: string) => px(absUrl(u)));
      return `srcset=${q}${rewritten}${q}`;
    }
  );

  // Rewrite poster
  html = html.replace(
    /poster\s*=\s*(["'])((?:https?:)?\/\/[^"']*)\1/gi,
    (_m, q, url) => `poster=${q}${px(absUrl(url))}${q}`
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
    if(!u||typeof u!=='string')return u;
    if(u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('javascript:')||u.startsWith('#'))return u;
    if(u.includes('/functions/v1/proxy-fetch'))return u;
    try{
      var a=new URL(u,BASE);
      if(a.protocol==='http:'||a.protocol==='https:')return P+'?url='+encodeURIComponent(a.href);
    }catch(e){}
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

  function extractTarget(href){
    if(href&&href.includes('/functions/v1/proxy-fetch')){
      try{var pu=new URL(href);var t=pu.searchParams.get('url');if(t)return t;}catch(e){}
    }
    return href;
  }

  // Block service workers
  if(navigator.serviceWorker){
    try{Object.defineProperty(navigator,'serviceWorker',{get:function(){return{register:function(){return Promise.reject(new Error('blocked'))},ready:Promise.resolve(),controller:null,addEventListener:function(){},removeEventListener:function(){}}}});}catch(e){}
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

  // Intercept WebSocket
  var _WS=window.WebSocket;
  window.WebSocket=function(url,protocols){
    if(url&&(url.startsWith('wss://')||url.startsWith('ws://'))){
      console.log('[proxy] WebSocket intercepted:',url);
      var dummy={readyState:3,send:function(){},close:function(){},addEventListener:function(e,f){if(e==='error')setTimeout(f,0)},removeEventListener:function(){}};
      dummy.onopen=null;dummy.onclose=null;dummy.onmessage=null;dummy.onerror=null;
      setTimeout(function(){if(dummy.onerror)dummy.onerror(new Event('error'))},0);
      return dummy;
    }
    return new _WS(url,protocols);
  };
  window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;

  // Intercept link clicks
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a');
    if(!a||!a.href)return;
    var h=a.href;
    if(h.startsWith('javascript:')||h==='#'||h.startsWith('data:'))return;
    e.preventDefault();e.stopPropagation();
    h=realUrl(h);
    h=extractTarget(h);
    try{h=new URL(h,BASE).href}catch(e2){}
    window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(h),targetUrl:h},'*');
  },true);

  // Intercept form submissions
  document.addEventListener('submit',function(e){
    var f=e.target;if(!f||!f.tagName)return;
    e.preventDefault();
    var fd=new FormData(f);
    var act=f.action||BASE;
    try{act=new URL(act,BASE).href}catch(e2){}
    var method=(f.method||'GET').toUpperCase();
    if(method==='GET'){
      var p=new URLSearchParams(fd).toString();
      var sep=act.includes('?')?'&':'?';
      var t=act+sep+p;
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(t),targetUrl:t},'*');
    } else {
      var body=new URLSearchParams(fd).toString();
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(act),targetUrl:act,method:'POST',body:body},'*');
    }
  },true);

  // Intercept window.open
  window.open=function(url){
    if(url){
      try{url=new URL(url,BASE).href}catch(e){}
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(url),targetUrl:url},'*');
    }
    return null;
  };

  // Intercept history pushState/replaceState
  var _pushState=history.pushState;
  var _replaceState=history.replaceState;
  history.pushState=function(state,title,url){
    if(url){try{window.parent.postMessage({type:'proxy-url-change',targetUrl:new URL(url,BASE).href},'*')}catch(e){}}
    return _pushState.apply(this,arguments);
  };
  history.replaceState=function(state,title,url){
    if(url){try{window.parent.postMessage({type:'proxy-url-change',targetUrl:new URL(url,BASE).href},'*')}catch(e){}}
    return _replaceState.apply(this,arguments);
  };

  // Intercept location.assign / location.replace
  try{
    window.location.assign=function(url){
      try{url=new URL(url,BASE).href}catch(e){}
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(url),targetUrl:url},'*');
    };
    window.location.replace=function(url){
      try{url=new URL(url,BASE).href}catch(e){}
      window.parent.postMessage({type:'proxy-navigate',url:P+'?url='+encodeURIComponent(url),targetUrl:url},'*');
    };
  }catch(e){}

  // MutationObserver for dynamic elements
  function processNode(el){
    if(el.hasAttribute&&el.hasAttribute('integrity'))el.removeAttribute('integrity');
    if(el.hasAttribute&&el.hasAttribute('nonce'))el.removeAttribute('nonce');
    if(el.hasAttribute&&el.hasAttribute('crossorigin'))el.removeAttribute('crossorigin');
    if(el.src&&typeof el.src==='string'&&(el.src.startsWith('http://')||el.src.startsWith('https://'))&&!el.src.includes('/functions/v1/proxy-fetch')){
      el.src=pxUrl(el.src);
    }
    if(el.tagName==='LINK'&&el.href&&(el.href.startsWith('http://')||el.href.startsWith('https://'))&&!el.href.includes('/functions/v1/proxy-fetch')){
      el.href=pxUrl(el.href);
    }
  }

  var observer=new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.nodeType!==1)return;
        processNode(n);
        if(n.querySelectorAll){
          n.querySelectorAll('script[src],link[href],img[src],iframe[src],source[src],video[src],audio[src]').forEach(processNode);
        }
      });
    });
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  // Clean existing elements
  document.querySelectorAll('[integrity],[nonce],[crossorigin]').forEach(function(el){
    el.removeAttribute('integrity');el.removeAttribute('nonce');el.removeAttribute('crossorigin');
  });
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, `$&${script}`);
  } else {
    html = script + html;
  }

  return html;
}

// ── CSS Rewriter ──
function rewriteCss(css: string): string {
  css = css.replace(
    /url\(\s*(["']?)((?:https?:)?\/\/[^"')]+)\1\s*\)/gi,
    (_m, q, url) => `url(${q}${px(absUrl(url))}${q})`
  );
  css = css.replace(
    /@import\s+(["'])((?:https?:)?\/\/[^"']+)\1/gi,
    (_m, q, url) => `@import ${q}${px(absUrl(url))}${q}`
  );
  return css;
}

// ── Fetch with retries ──
async function fetchWithRetry(url: string, options: RequestInit, retries = 1): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      lastError = e as Error;
      if (i < retries) await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastError;
}

// ── Security header stripping ──
function cleanHeaders(headers: Headers): Record<string, string> {
  const blocked = new Set([
    "content-security-policy", "content-security-policy-report-only",
    "x-frame-options", "x-content-type-options", "strict-transport-security",
    "permissions-policy", "cross-origin-opener-policy", "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ]);
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { if (!blocked.has(k.toLowerCase())) out[k] = v; });
  return out;
}

// ── Main Handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");
    const useBrowser = requestUrl.searchParams.get("engine") === "browser";

    // ═══ GET/POST pass-through: proxy any URL ═══
    if (targetUrl) {
      let resolved = targetUrl;
      if (!/^https?:\/\//i.test(resolved)) resolved = "https://" + resolved;

      console.log(`Proxy → ${resolved}${useBrowser ? " [browserless]" : ""}`);

      // If explicitly requesting browser engine, go straight to Browserless
      if (useBrowser && BROWSERLESS_API_KEY) {
        try {
          const { html: rawHtml, finalUrl } = await fetchWithBrowserless(resolved);
          const html = rewriteHtml(rawHtml, finalUrl);
          return new Response(html, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "text/html; charset=utf-8",
              "X-Final-URL": finalUrl,
              "X-Engine": "browserless",
              "Access-Control-Expose-Headers": "X-Final-URL,X-Engine",
            },
          });
        } catch (e) {
          console.error("Browserless failed:", e);
          // Fall through to direct fetch
        }
      }

      // Direct fetch (fast path)
      const fetchOptions: RequestInit = {
        method: req.method === "POST" && req.headers.get("content-type") ? "POST" : "GET",
        headers: browserHeaders(resolved),
        redirect: "follow",
      };

      if (req.method === "POST") {
        const ct = req.headers.get("content-type") || "";
        if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
          fetchOptions.body = await req.text();
          (fetchOptions.headers as Record<string, string>)["Content-Type"] = ct;
        }
      }

      const res = await fetchWithRetry(resolved, fetchOptions);
      storeCookies(resolved, res.headers);

      const ct = res.headers.get("content-type") || "";
      const finalUrl = res.url;

      // HTML → check for Cloudflare, rewrite & serve
      if (ct.includes("text/html") || ct.includes("application/xhtml")) {
        let html = await res.text();

        // Detect Cloudflare challenge → auto-fallback to Browserless
        if (isCloudflareChallenge(html, res.status) && BROWSERLESS_API_KEY && !useBrowser) {
          console.log(`Cloudflare detected on ${resolved}, falling back to Browserless...`);
          try {
            const { html: browserHtml, finalUrl: browserFinalUrl } = await fetchWithBrowserless(resolved);
            const rewritten = rewriteHtml(browserHtml, browserFinalUrl);
            return new Response(rewritten, {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "text/html; charset=utf-8",
                "X-Final-URL": browserFinalUrl,
                "X-Engine": "browserless",
                "Access-Control-Expose-Headers": "X-Final-URL,X-Engine",
              },
            });
          } catch (browserErr) {
            console.error("Browserless fallback failed:", browserErr);
            // Continue with the Cloudflare challenge page (will show error)
          }
        }

        html = rewriteHtml(html, finalUrl);
        return new Response(html, {
          status: res.status,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "X-Final-URL": finalUrl,
            "X-Engine": "direct",
            "Access-Control-Expose-Headers": "X-Final-URL,X-Engine",
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

      // JavaScript → pass through
      if (ct.includes("javascript") || ct.includes("ecmascript")) {
        const body = await res.arrayBuffer();
        return new Response(body, {
          headers: { ...corsHeaders, "Content-Type": ct, "Cache-Control": "public, max-age=3600" },
        });
      }

      // Everything else → stream through
      const body = await res.arrayBuffer();
      const outHeaders = cleanHeaders(res.headers);
      return new Response(body, {
        headers: {
          ...corsHeaders, ...outHeaders,
          "Content-Type": ct || "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // ═══ JSON API for the frontend ═══
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

    const requestUrl = new URL(req.url);
    if (requestUrl.searchParams.get("url")) {
      const errorHtml = `<!DOCTYPE html><html><head><style>
        body{font-family:system-ui;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
        .box{text-align:center;padding:2rem;max-width:500px}
        h1{color:#00ff88;font-size:1.5rem;margin-bottom:1rem}
        p{color:#888;font-size:0.9rem;line-height:1.6}
        .retry{margin-top:1.5rem;padding:10px 24px;background:#00ff88;color:#0a0a0a;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:0.9rem}
        .retry:hover{background:#00cc6a}
      </style></head><body><div class="box">
        <h1>⚡ Connection Failed</h1>
        <p>${(err as Error).message || "The site couldn't be reached."}</p>
        <p style="margin-top:1rem">Try searching for the site instead, or use a different URL.</p>
        <button class="retry" onclick="window.parent.postMessage({type:'proxy-navigate',url:'',targetUrl:''},'*')">← Go Home</button>
      </div></body></html>`;
      return new Response(errorHtml, {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(JSON.stringify({ error: (err as Error).message || "Failed to fetch" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
