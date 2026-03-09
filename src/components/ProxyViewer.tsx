import { useState, useRef, useCallback, useEffect } from "react";
import { X, ExternalLink, ArrowLeft, ArrowRight, RotateCw, Home, Lock, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProxyViewerProps {
  proxyUrl: string;
  targetUrl: string;
  onClose: () => void;
}

interface Tab {
  id: string;
  title: string;
  proxyUrl: string;
  targetUrl: string;
  currentTargetUrl: string;
  history: { proxyUrl: string; targetUrl: string }[];
  historyIndex: number;
  isLoading: boolean;
  htmlContent: string | null;
}

let tabIdCounter = 0;
function newTabId() {
  return `tab-${++tabIdCounter}`;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url.slice(0, 20); }
}

const ProxyViewer = ({ proxyUrl, targetUrl, onClose }: ProxyViewerProps) => {
  const [tabs, setTabs] = useState<Tab[]>(() => [{
    id: newTabId(),
    title: hostnameOf(targetUrl),
    proxyUrl,
    targetUrl,
    currentTargetUrl: targetUrl,
    history: [{ proxyUrl, targetUrl }],
    historyIndex: 0,
    isLoading: true,
    htmlContent: null,
  }]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t));
  }, []);

  const loadPage = useCallback(async (tabId: string, pUrl: string, tUrl: string, addToHistory = true) => {
    if (!pUrl || !tUrl) {
      onClose();
      return;
    }

    updateTab(tabId, {
      isLoading: true,
      currentTargetUrl: tUrl,
    });

    try {
      const response = await fetch(pUrl, {
        headers: { "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const finalUrl = response.headers.get("x-final-url") || tUrl;

      setTabs(prev => prev.map(t => {
        if (t.id !== tabId) return t;
        const newHistory = addToHistory
          ? [...t.history.slice(0, t.historyIndex + 1), { proxyUrl: pUrl, targetUrl: finalUrl }]
          : t.history;
        return {
          ...t,
          isLoading: false,
          currentTargetUrl: finalUrl,
          title: hostnameOf(finalUrl),
          htmlContent: html,
          history: newHistory,
          historyIndex: addToHistory ? newHistory.length - 1 : t.historyIndex,
        };
      }));

      // Write to iframe
      const iframe = iframeRefs.current[tabId];
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
      updateTab(tabId, { isLoading: false });
    }
  }, [onClose, updateTab]);

  // Initial load for first tab
  useEffect(() => {
    loadPage(tabs[0].id, proxyUrl, targetUrl, false);
  }, []); // eslint-disable-line

  // When switching tabs, re-render the iframe content
  useEffect(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab?.htmlContent) return;
    const iframe = iframeRefs.current[activeTabId];
    if (iframe) {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(tab.htmlContent);
        doc.close();
      }
    }
  }, [activeTabId]); // eslint-disable-line

  // Listen for navigation messages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "proxy-navigate" && e.data.url) {
        loadPage(activeTabId, e.data.url, e.data.targetUrl || e.data.url);
      } else if (e.data?.type === "proxy-url-change" && e.data.targetUrl) {
        updateTab(activeTabId, {
          currentTargetUrl: e.data.targetUrl,
          title: hostnameOf(e.data.targetUrl),
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeTabId, loadPage, updateTab]);

  const goBack = () => {
    if (activeTab.historyIndex > 0) {
      const i = activeTab.historyIndex - 1;
      updateTab(activeTabId, { historyIndex: i });
      loadPage(activeTabId, activeTab.history[i].proxyUrl, activeTab.history[i].targetUrl, false);
    }
  };

  const goForward = () => {
    if (activeTab.historyIndex < activeTab.history.length - 1) {
      const i = activeTab.historyIndex + 1;
      updateTab(activeTabId, { historyIndex: i });
      loadPage(activeTabId, activeTab.history[i].proxyUrl, activeTab.history[i].targetUrl, false);
    }
  };

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).querySelector("input") as HTMLInputElement;
    const trimmed = input?.value?.trim();
    if (!trimmed) return;

    let url = trimmed;
    if (!/^https?:\/\//i.test(url) && /\.\w{2,}/.test(url)) {
      url = "https://" + url;
    } else if (!/^https?:\/\//i.test(url)) {
      url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(url)}`;
    }

    try {
      const { data, error } = await supabase.functions.invoke("proxy-fetch", { body: { url } });
      if (error) throw error;
      if (data?.proxyUrl) {
        loadPage(activeTabId, data.proxyUrl, data.targetUrl);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to navigate");
    }
  };

  const addTab = () => {
    const id = newTabId();
    const newTab: Tab = {
      id,
      title: "New Tab",
      proxyUrl: "",
      targetUrl: "",
      currentTargetUrl: "",
      history: [],
      historyIndex: -1,
      isLoading: false,
      htmlContent: null,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
  };

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) {
      onClose();
      return;
    }
    const idx = tabs.findIndex(t => t.id === tabId);
    const remaining = tabs.filter(t => t.id !== tabId);
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(remaining[Math.min(idx, remaining.length - 1)].id);
    }
  };

  const urlInput = activeTab.currentTargetUrl;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Tab bar */}
      <div className="flex items-center bg-card/80 border-b border-border overflow-x-auto scrollbar-hide">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 min-w-0 max-w-[180px] px-3 py-1.5 border-r border-border cursor-pointer transition-colors text-xs font-mono ${
              tab.id === activeTabId
                ? "bg-background text-foreground"
                : "bg-card/50 text-muted-foreground hover:bg-secondary/50"
            }`}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.isLoading && (
              <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
            )}
            <span className="truncate flex-1">{tab.title || "New Tab"}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-secondary transition-all flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={addTab}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors flex-shrink-0"
          title="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-card border-b border-border">
        <button onClick={() => closeTab(activeTabId)} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Close tab">
          <X className="w-4 h-4" />
        </button>
        <button onClick={goBack} disabled={activeTab.historyIndex <= 0} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30" title="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button onClick={goForward} disabled={activeTab.historyIndex >= activeTab.history.length - 1} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30" title="Forward">
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            if (activeTab.history.length > 0) {
              const h = activeTab.history[activeTab.historyIndex];
              if (h) loadPage(activeTabId, h.proxyUrl, h.targetUrl, false);
            }
          }}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Reload"
        >
          <RotateCw className={`w-4 h-4 ${activeTab.isLoading ? "animate-spin" : ""}`} />
        </button>
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Home">
          <Home className="w-4 h-4" />
        </button>

        <form onSubmit={handleUrlSubmit} className="flex-1 mx-1">
          <div className="flex items-center bg-secondary rounded-md px-2 py-1">
            <Lock className="w-3 h-3 text-primary/70 mr-1.5 flex-shrink-0" />
            <input
              type="text"
              defaultValue={urlInput}
              key={activeTabId + urlInput}
              className="flex-1 bg-transparent font-mono text-xs text-secondary-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Enter URL or search..."
            />
          </div>
        </form>

        <a href={activeTab.currentTargetUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Open in new tab">
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Loading bar */}
      {activeTab.isLoading && (
        <div className="h-0.5 w-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary w-full" style={{
            background: 'linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)',
            animation: 'loading 1.5s ease-in-out infinite',
          }} />
        </div>
      )}

      {/* Iframes — one per tab, only active one visible */}
      <div className="flex-1 relative">
        {tabs.map(tab => (
          <iframe
            key={tab.id}
            ref={el => { iframeRefs.current[tab.id] = el; }}
            className={`absolute inset-0 w-full h-full bg-white ${tab.id === activeTabId ? "" : "hidden"}`}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-presentation allow-popups-to-escape-sandbox"
            title={`Tab: ${tab.title}`}
            referrerPolicy="no-referrer"
          />
        ))}
      </div>
    </div>
  );
};

export default ProxyViewer;
