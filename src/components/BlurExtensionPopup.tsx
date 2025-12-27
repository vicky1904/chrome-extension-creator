import { useState, useEffect } from "react";
import { Shield, Sparkles, Type, Eye, Plus, X, Trash2, Sun, Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const BlurExtensionPopup = () => {
  const [aiBlurEnabled, setAiBlurEnabled] = useState(true);
  const [keywordBlurEnabled, setKeywordBlurEnabled] = useState(true);
  const [blurIntensity, setBlurIntensity] = useState([70]);
  const [keywords, setKeywords] = useState<string[]>(["SSN", "credit card", "password"]);
  const [newKeyword, setNewKeyword] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setIsDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    document.documentElement.classList.toggle("dark", newMode);
  };

  // Mock stats
  const stats = {
    aiBlurred: 12,
    keywordBlurred: 5,
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword("");
    }
  };

  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter((k) => k !== keyword));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      addKeyword();
    }
  };

  return (
    <div className="w-[360px] bg-background rounded-2xl shadow-2xl overflow-hidden border border-border/50">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary via-accent to-secondary p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">PII Shield</h1>
              <p className="text-xs text-white/80">Protect your sensitive data</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleDarkMode}
            className="w-9 h-9 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg text-white"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="px-4 py-3 bg-muted/50 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Items blurred this session</span>
          </div>
          <div className="flex gap-2">
            <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
              <Sparkles className="w-3 h-3 mr-1" />
              {stats.aiBlurred} AI
            </Badge>
            <Badge variant="secondary" className="bg-accent/10 text-accent-foreground border-0">
              <Type className="w-3 h-3 mr-1" />
              {stats.keywordBlurred} Keywords
            </Badge>
          </div>
        </div>
      </div>

      {/* Toggle Controls */}
      <div className="p-4 space-y-4">
        {/* AI Auto-Blur Toggle */}
        <div className="bg-card rounded-xl p-4 border border-border/50 transition-all hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                aiBlurEnabled ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">AI Auto-Blur</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically detect PII using Chrome AI
                </p>
              </div>
            </div>
            <Switch
              checked={aiBlurEnabled}
              onCheckedChange={setAiBlurEnabled}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>

        {/* Keyword Blur Toggle */}
        <div className="bg-card rounded-xl p-4 border border-border/50 transition-all hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                keywordBlurEnabled ? "bg-accent/20 text-accent-foreground" : "bg-muted text-muted-foreground"
              }`}>
                <Type className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Keyword Blur</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Blur content matching your keywords
                </p>
              </div>
            </div>
            <Switch
              checked={keywordBlurEnabled}
              onCheckedChange={setKeywordBlurEnabled}
              className="data-[state=checked]:bg-accent"
            />
          </div>
        </div>

        {/* Blur Intensity */}
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground">Blur Intensity</h3>
            <span className="text-sm font-medium text-primary">{blurIntensity}%</span>
          </div>
          <Slider
            value={blurIntensity}
            onValueChange={setBlurIntensity}
            max={100}
            min={10}
            step={5}
            className="w-full"
          />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Light</span>
            <span>Heavy</span>
          </div>
        </div>

        {/* Custom Keywords */}
        <div className="bg-card rounded-xl p-4 border border-border/50">
          <h3 className="font-semibold text-foreground mb-3">Custom Keywords</h3>
          
          {/* Add Keyword Input */}
          <div className="flex gap-2 mb-3">
            <Input
              placeholder="Add a keyword..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 bg-background"
            />
            <Button
              onClick={addKeyword}
              size="icon"
              className="bg-primary hover:bg-primary/90"
              disabled={!newKeyword.trim()}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Keywords List */}
          {keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <Badge
                  key={keyword}
                  variant="secondary"
                  className="bg-secondary/50 text-secondary-foreground pl-3 pr-1 py-1 flex items-center gap-1 group"
                >
                  {keyword}
                  <button
                    onClick={() => removeKeyword(keyword)}
                    className="ml-1 hover:bg-destructive/20 rounded p-0.5 transition-colors"
                  >
                    <X className="w-3 h-3 text-muted-foreground group-hover:text-destructive" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-sm">
              <Type className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No keywords added yet</p>
            </div>
          )}

          {keywords.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 text-destructive hover:text-destructive hover:bg-destructive/10 w-full"
              onClick={() => setKeywords([])}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all keywords
            </Button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-muted/30 border-t border-border/50">
        <p className="text-xs text-center text-muted-foreground">
          🔒 All processing happens locally on your device
        </p>
      </div>
    </div>
  );
};

export default BlurExtensionPopup;
