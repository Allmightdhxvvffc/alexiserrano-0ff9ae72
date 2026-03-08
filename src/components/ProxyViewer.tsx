import { useState, useRef, useCallback, useEffect } from "react";
import { X, ExternalLink, ArrowLeft, ArrowRight, RotateCw, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ProxyViewerProps {
  html: string;
  url: string;
  onClose: () => void;
}

const ProxyViewer = ({ html, url, onClose }: ProxyViewerProps) => {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [currentHtml, setCurrentHtml] = useState(html);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<{ html: string; url: string }[]>([{ html, url }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigateTo = useCallback(async (targetUrl: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("proxy-fetch", {
        body: { url: targetUrl },
      });

      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.html) {
        const newEntry = { html: data.html, url: data.finalUrl };
        const newHistory = [...history.slice(0, historyIndex + 1), newEntry];
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setCurrentHtml(data.html);
        setCurrentUrl(data.finalUrl);
      } else {
        toast.info(`Non-HTML content: ${data?.contentType}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load page");
    } finally {
      setIsLoading(false);
    }
  }, [history, historyIndex]);

  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setCurrentHtml(history[newIndex].html);
      setCurrentUrl(history[newIndex].url);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setCurrentHtml(history[newIndex].html);
      setCurrentUrl(history[newIndex].url);
    }
  };

  // Inject a script that intercepts link clicks and posts messages to the parent
  const injectedHtml = currentHtml.replace(
    "</body>",
    `<script>
      document.addEventListener('click', function(e) {
        var link = e.target.closest('a');
        if (link && link.href && !link.href.startsWith('javascript:') && !link.href.startsWith('#')) {
          e.preventDefault();
          e.stopPropagation();
          window.parent.postMessage({ type: 'proxy-navigate', url: link.href }, '*');
        }
      }, true);
      document.addEventListener('submit', function(e) {
        e.preventDefault();
        window.parent.postMessage({ type: 'proxy-alert', message: 'Form submissions are not supported through the proxy.' }, '*');
      }, true);
    </script></body>`
  );

  // Listen for messages from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'proxy-navigate' && e.data.url) {
        navigateTo(e.data.url);
      }
      if (e.data?.type === 'proxy-alert') {
        toast.info(e.data.message);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [navigateTo]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-card border-b border-border">
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <button
          onClick={goBack}
          disabled={historyIndex <= 0}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <button
          onClick={goForward}
          disabled={historyIndex >= history.length - 1}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          onClick={() => navigateTo(currentUrl)}
          disabled={isLoading}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Reload"
        >
          <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Home"
        >
          <Home className="w-4 h-4" />
        </button>

        <div className="flex-1 px-3 py-1.5 bg-secondary rounded-md font-mono text-xs text-secondary-foreground truncate mx-1">
          {isLoading ? "Loading..." : currentUrl}
        </div>

        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          title="Open in new tab"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-0.5 w-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary animate-pulse w-2/3" />
        </div>
      )}

      {/* Content */}
      <iframe
        ref={iframeRef}
        srcDoc={injectedHtml}
        className="flex-1 w-full bg-white"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
        title="Proxied content"
        referrerPolicy="no-referrer"
      />
    </div>
  );
};

export default ProxyViewer;
