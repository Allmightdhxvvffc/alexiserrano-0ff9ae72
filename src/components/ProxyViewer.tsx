import { useState, useRef, useCallback, useEffect } from "react";
import { X, ExternalLink, ArrowLeft, ArrowRight, RotateCw, Home, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProxyViewerProps {
  proxyUrl: string;
  targetUrl: string;
  onClose: () => void;
}

const ProxyViewer = ({ proxyUrl, targetUrl, onClose }: ProxyViewerProps) => {
  const [currentTargetUrl, setCurrentTargetUrl] = useState(targetUrl);
  const [urlInput, setUrlInput] = useState(targetUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<{ proxyUrl: string; targetUrl: string }[]>([{ proxyUrl, targetUrl }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadPage = useCallback(async (pUrl: string, tUrl: string, addToHistory = true) => {
    if (!pUrl || !tUrl) {
      onClose();
      return;
    }

    setIsLoading(true);
    setCurrentTargetUrl(tUrl);
    setUrlInput(tUrl);

    try {
      const response = await fetch(pUrl, {
        headers: {
          "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();

      if (addToHistory) {
        const newHistory = [...history.slice(0, historyIndex + 1), { proxyUrl: pUrl, targetUrl: tUrl }];
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }

      const finalUrl = response.headers.get("x-final-url") || tUrl;
      setCurrentTargetUrl(finalUrl);
      setUrlInput(finalUrl);

      const iframe = iframeRef.current;
      if (iframe) {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load page");
    } finally {
      setIsLoading(false);
    }
  }, [history, historyIndex, onClose]);

  useEffect(() => {
    loadPage(proxyUrl, targetUrl, false);
  }, []); // eslint-disable-line

  // Listen for navigation messages from injected scripts
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "proxy-navigate" && e.data.url) {
        loadPage(e.data.url, e.data.targetUrl || e.data.url);
      } else if (e.data?.type === "proxy-url-change" && e.data.targetUrl) {
        // History pushState/replaceState - just update the URL bar
        setCurrentTargetUrl(e.data.targetUrl);
        setUrlInput(e.data.targetUrl);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadPage]);

  const goBack = () => {
    if (historyIndex > 0) {
      const i = historyIndex - 1;
      setHistoryIndex(i);
      loadPage(history[i].proxyUrl, history[i].targetUrl, false);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const i = historyIndex + 1;
      setHistoryIndex(i);
      loadPage(history[i].proxyUrl, history[i].targetUrl, false);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    let url = trimmed;
    if (!/^https?:\/\//i.test(url) && /\.\w{2,}/.test(url)) {
      url = "https://" + url;
    } else if (!/^https?:\/\//i.test(url)) {
      url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(url)}`;
    }

    try {
      const { data, error } = await supabase.functions.invoke("proxy-fetch", {
        body: { url },
      });
      if (error) throw error;
      if (data?.proxyUrl) {
        loadPage(data.proxyUrl, data.targetUrl);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to navigate");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-card border-b border-border">
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Close">
          <X className="w-4 h-4" />
        </button>
        <button onClick={goBack} disabled={historyIndex <= 0} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={goForward} disabled={historyIndex >= history.length - 1} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30" title="Forward">
          <ArrowRight className="w-4 h-4" />
        </button>
        <button onClick={() => loadPage(history[historyIndex].proxyUrl, history[historyIndex].targetUrl, false)} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Reload">
          <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Home">
          <Home className="w-4 h-4" />
        </button>

        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
          <div className="flex items-center bg-secondary rounded-md px-2 py-1">
            <Lock className="w-3 h-3 text-primary/70 mr-1.5 flex-shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="flex-1 bg-transparent font-mono text-xs text-secondary-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Enter URL or search..."
            />
          </div>
        </form>

        <a href={currentTargetUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Open in new tab">
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-0.5 w-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary w-full" style={{
            background: 'linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)',
            animation: 'loading 1.5s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        className="flex-1 w-full bg-white"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation allow-popups-to-escape-sandbox"
        title="Proxied content"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

export default ProxyViewer;
