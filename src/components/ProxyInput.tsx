import { useState } from "react";
import { Globe, ArrowRight, Shield, Zap, Eye, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ProxyInputProps {
  onResult?: (html: string, url: string) => void;
  onLoading?: (loading: boolean) => void;
}

function isUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})(\/.*)?$/.test(trimmed)) return true;
  return false;
}

const ProxyInput = ({ onResult, onLoading }: ProxyInputProps) => {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"auto" | "search" | "url">("auto");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error("Enter a URL or search query");
      return;
    }

    let targetUrl: string;
    const shouldSearch = mode === "search" || (mode === "auto" && !isUrl(trimmed));

    if (shouldSearch) {
      targetUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&safe=active`;
    } else {
      targetUrl = trimmed;
    }

    setIsLoading(true);
    onLoading?.(true);

    try {
      const { data, error } = await supabase.functions.invoke("proxy-fetch", {
        body: { url: targetUrl },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
      } else if (data?.html) {
        toast.success(shouldSearch ? `Search: ${trimmed}` : `Loaded: ${data.finalUrl}`);
        onResult?.(data.html, data.finalUrl);
      } else {
        toast.info(`Non-HTML content: ${data?.contentType} (${data?.size} bytes)`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to proxy request");
    } finally {
      setIsLoading(false);
      onLoading?.(false);
    }
  };

  const detectedMode = mode === "auto" ? (isUrl(input.trim()) ? "url" : "search") : mode;

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-primary/20 rounded-lg blur-sm group-focus-within:bg-primary/30 transition-all duration-300 group-focus-within:blur-md" />
        <div className="relative flex items-center bg-card border border-border rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setMode(m => m === "auto" ? "search" : m === "search" ? "url" : "auto")}
            className="pl-4 text-muted-foreground hover:text-primary transition-colors"
            title={`Mode: ${detectedMode} (click to toggle)`}
          >
            {detectedMode === "search" ? (
              <Search className="w-5 h-5" />
            ) : (
              <Globe className="w-5 h-5" />
            )}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={detectedMode === "search" ? "Search the web..." : "https://example.com"}
            className="flex-1 bg-transparent px-3 py-4 font-mono text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-4 bg-primary text-primary-foreground font-display font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            ) : (
              <>
                {detectedMode === "search" ? "SEARCH" : "GO"} <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-6 mt-6 text-xs text-muted-foreground font-mono">
        <span className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-primary/70" /> Encrypted
        </span>
        <span className="flex items-center gap-1.5">
          <Search className="w-3.5 h-3.5 text-primary/70" /> Search or URL
        </span>
        <span className="flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-primary/70" /> Anonymous
        </span>
      </div>
    </form>
  );
};

export default ProxyInput;
