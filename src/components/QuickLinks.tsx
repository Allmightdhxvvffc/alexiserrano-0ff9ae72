import { useState } from "react";
import {
  Play, BookOpen, MessageCircle, Gamepad2, Newspaper, Music,
  Crosshair, Swords, Puzzle, Car, Globe, Zap, ChevronDown, ChevronUp,
  Film, Tv, Sparkles, Baby,
} from "lucide-react";

interface QuickLinksProps {
  onNavigate: (url: string) => void;
  isLoading: boolean;
}

const quickSites = [
  { name: "YouTube", url: "https://www.youtube.com", icon: Play, color: "text-red-400" },
  { name: "Wikipedia", url: "https://www.wikipedia.org", icon: BookOpen, color: "text-blue-400" },
  { name: "Reddit", url: "https://old.reddit.com", icon: MessageCircle, color: "text-orange-400" },
  { name: "CNN", url: "https://lite.cnn.com", icon: Newspaper, color: "text-sky-400" },
  { name: "SoundCloud", url: "https://soundcloud.com", icon: Music, color: "text-pink-400" },
];

const gameCategories = [
  {
    genre: "Shooters / Battle Royale",
    icon: Crosshair,
    color: "text-red-400",
    sites: [
      { name: "1v1.LOL", url: "https://1v1.lol" },
      { name: "Krunker.io", url: "https://krunker.io" },
      { name: "Shell Shockers", url: "https://shellshock.io" },
      { name: "Venge.io", url: "https://venge.io" },
    ],
  },
  {
    genre: "Action / Adventure",
    icon: Swords,
    color: "text-orange-400",
    sites: [
      { name: "CrazyGames", url: "https://www.crazygames.com" },
      { name: "Poki", url: "https://poki.com" },
      { name: "Now.gg", url: "https://now.gg" },
      { name: "Armored Patrol", url: "https://www.crazygames.com/game/armored-patrol" },
    ],
  },
  {
    genre: "Racing / Driving",
    icon: Car,
    color: "text-yellow-400",
    sites: [
      { name: "Moto X3M", url: "https://www.crazygames.com/game/moto-x3m" },
      { name: "Drift Hunters", url: "https://www.crazygames.com/game/drift-hunters" },
      { name: "Smash Karts", url: "https://smashkarts.io" },
      { name: "City Car Driving", url: "https://www.crazygames.com/game/city-car-driving-simulator" },
    ],
  },
  {
    genre: "Puzzle / Strategy",
    icon: Puzzle,
    color: "text-green-400",
    sites: [
      { name: "CoolMathGames", url: "https://www.coolmathgames.com" },
      { name: "2048", url: "https://play2048.co" },
      { name: "Chess.com", url: "https://www.chess.com" },
      { name: "Wordle", url: "https://www.nytimes.com/games/wordle" },
    ],
  },
  {
    genre: "Sandbox / Open World",
    icon: Globe,
    color: "text-cyan-400",
    sites: [
      { name: "Eaglercraft", url: "https://eaglercraft.com" },
      { name: "BuildRoyale.io", url: "https://buildroyale.io" },
      { name: "Territorial.io", url: "https://territorial.io" },
      { name: "Defly.io", url: "https://defly.io" },
    ],
  },
  {
    genre: "IO / Multiplayer",
    icon: Zap,
    color: "text-purple-400",
    sites: [
      { name: "Slither.io", url: "https://slither.io" },
      { name: "Agar.io", url: "https://agar.io" },
      { name: "Diep.io", url: "https://diep.io" },
      { name: "Surviv.io", url: "https://surviv.io" },
    ],
  },
];

const mediaCategories = [
  {
    genre: "Free Movies",
    icon: Film,
    color: "text-amber-400",
    sites: [
      { name: "Tubi", url: "https://tubitv.com" },
      { name: "Pluto TV", url: "https://pluto.tv" },
      { name: "Plex", url: "https://watch.plex.tv" },
      { name: "Crackle", url: "https://www.crackle.com" },
      { name: "Popcornflix", url: "https://popcornflix.com" },
      { name: "Kanopy", url: "https://www.kanopy.com" },
      { name: "Vudu Free", url: "https://www.vudu.com/content/movies/free" },
      { name: "Internet Archive", url: "https://archive.org/details/movies" },
      { name: "GoMovies", url: "https://gomovies.sx" },
    ],
  },
  {
    genre: "Free TV Shows",
    icon: Tv,
    color: "text-indigo-400",
    sites: [
      { name: "Tubi TV", url: "https://tubitv.com/category/tv" },
      { name: "Pluto TV Live", url: "https://pluto.tv/live-tv" },
      { name: "The CW", url: "https://www.cwtv.com" },
      { name: "ABC", url: "https://abc.com" },
      { name: "NBC", url: "https://www.nbc.com" },
      { name: "FOX", url: "https://www.fox.com" },
      { name: "CBS", url: "https://www.cbs.com" },
      { name: "PBS", url: "https://www.pbs.org/video" },
    ],
  },
  {
    genre: "Anime",
    icon: Sparkles,
    color: "text-pink-400",
    sites: [
      { name: "Crunchyroll", url: "https://www.crunchyroll.com" },
      { name: "MyAnimeList", url: "https://myanimelist.net" },
      { name: "AniList", url: "https://anilist.co" },
      { name: "Anime-Planet", url: "https://www.anime-planet.com" },
      { name: "9anime", url: "https://9animetv.to" },
      { name: "RetroCrush", url: "https://www.retrocrush.tv" },
      { name: "Tubi Anime", url: "https://tubitv.com/category/anime" },
      { name: "Pluto Anime", url: "https://pluto.tv/live-tv/anime-all-day" },
      { name: "VIZ", url: "https://www.viz.com" },
    ],
  },
  {
    genre: "Cartoons & Kids",
    icon: Baby,
    color: "text-lime-400",
    sites: [
      { name: "Cartoon Network", url: "https://www.cartoonnetwork.com" },
      { name: "Nickelodeon", url: "https://www.nick.com" },
      { name: "Disney Channel", url: "https://disneynow.com" },
      { name: "PBS Kids", url: "https://pbskids.org" },
      { name: "Boomerang", url: "https://www.boomerang.com" },
      { name: "Tubi Kids", url: "https://tubitv.com/category/kids" },
      { name: "WB Kids", url: "https://www.wbkids.com" },
      { name: "YouTube Kids", url: "https://www.youtubekids.com" },
    ],
  },
];

type Section = "games" | "media" | null;

const QuickLinks = ({ onNavigate, isLoading }: QuickLinksProps) => {
  const [openSection, setOpenSection] = useState<Section>(null);

  const toggle = (section: Section) =>
    setOpenSection((prev) => (prev === section ? null : section));

  const renderGrid = (categories: typeof gameCategories) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
      {categories.map((cat) => {
        const CatIcon = cat.icon;
        return (
          <div
            key={cat.genre}
            className="rounded-lg border border-border bg-card/80 p-3 space-y-2"
          >
            <div className="flex items-center gap-2 font-mono text-xs font-semibold text-foreground">
              <CatIcon className={`w-4 h-4 ${cat.color}`} />
              {cat.genre}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cat.sites.map((site) => (
                <button
                  key={site.name}
                  onClick={() => onNavigate(site.url)}
                  disabled={isLoading}
                  className="px-2.5 py-1.5 rounded-md border border-border/60 bg-secondary/50 hover:bg-primary/10 hover:border-primary/30 transition-all font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  {site.name}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {/* Quick Sites */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {quickSites.map((site) => {
          const Icon = site.icon;
          return (
            <button
              key={site.name}
              onClick={() => onNavigate(site.url)}
              disabled={isLoading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-card hover:bg-secondary transition-all duration-200 font-mono text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 group"
            >
              <Icon className={`w-3.5 h-3.5 ${site.color} group-hover:scale-110 transition-transform`} />
              {site.name}
            </button>
          );
        })}
      </div>

      {/* Section Toggles */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => toggle("games")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all font-mono text-xs ${
            openSection === "games"
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary"
          }`}
        >
          <Gamepad2 className="w-4 h-4" />
          {openSection === "games" ? "Hide Games" : "Browse Games"}
          {openSection === "games" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => toggle("media")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all font-mono text-xs ${
            openSection === "media"
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary"
          }`}
        >
          <Film className="w-4 h-4" />
          {openSection === "media" ? "Hide Media" : "Movies & Shows"}
          {openSection === "media" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Game Categories */}
      {openSection === "games" && renderGrid(gameCategories)}

      {/* Media Categories */}
      {openSection === "media" && renderGrid(mediaCategories)}
    </div>
  );
};

export default QuickLinks;
