using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Scanning;

/// <summary>
/// Erkennt Spiele, an denen NeuralSwap nichts verändern sollte oder kann:
///  • Online-Spiele mit Anti-Cheat – geänderte DLLs oder injizierte Add-ons können
///    zu Kick oder Sperre führen. Die Datei-Marker entsprechen denen von
///    DLSS5oneclick (game.rs: detect_anticheat / known_anticheat_exe), ergänzt um
///    Call of Duty (Ricochet hinterlässt keine Marker-Dateien).
///  • Game-Pass-/Store-Kopien, deren Spiel-EXE Windows sperrt – dort lädt das
///    Spiel nichts, was man daneben legt (gleiche Prüfung wie DLSS5oneclick).
/// </summary>
public static class GameProtection
{
    private const int MaxDepth = 3;

    private static readonly Dictionary<string, string> AntiCheatDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["EasyAntiCheat"] = "Easy Anti-Cheat",
        ["EasyAntiCheat_EOS"] = "Easy Anti-Cheat",
        ["BattlEye"] = "BattlEye",
        ["GameGuard"] = "GameGuard",
        ["EAAntiCheat"] = "EA Javelin Anticheat",
        ["AntiCheatExpert"] = "Anti-Cheat Expert (ACE)",
    };

    private static readonly Dictionary<string, string> KnownExes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["overwatch.exe"] = "Blizzard (Overwatch)",
        ["wow.exe"] = "Blizzard Warden (World of Warcraft)",
        ["wowclassic.exe"] = "Blizzard Warden (World of Warcraft)",
        ["valorant.exe"] = "Riot Vanguard",
        ["valorant-win64-shipping.exe"] = "Riot Vanguard",
        ["leagueclient.exe"] = "Riot Vanguard",
        ["league of legends.exe"] = "Riot Vanguard",
        ["robloxplayerbeta.exe"] = "Roblox Hyperion",
        ["wardogsclient-win64-shipping.exe"] = "Wardogs Anti-Cheat",
        ["cod.exe"] = "Ricochet (Call of Duty)",
    };

    /// <summary>Name des Anti-Cheat-Systems oder null.</summary>
    public static string? DetectAntiCheat(Game game)
    {
        if (game.Name.Contains("Call of Duty", StringComparison.OrdinalIgnoreCase) ||
            game.Name.Contains("Warzone", StringComparison.OrdinalIgnoreCase))
            return "Ricochet (Call of Duty)";

        if (game.MainExe != null && KnownExes.TryGetValue(Path.GetFileName(game.MainExe), out var byExe))
            return byExe;

        return Directory.Exists(game.InstallDir) ? Walk(game.InstallDir, MaxDepth) : null;
    }

    private static string? Walk(string dir, int depth)
    {
        IEnumerable<string> entries;
        try { entries = Directory.EnumerateFileSystemEntries(dir).ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return null; }

        foreach (var entry in entries)
        {
            var name = Path.GetFileName(entry);
            if (Directory.Exists(entry))
            {
                if (AntiCheatDirs.TryGetValue(name, out var ac)) return ac;
                continue;
            }

            var lower = name.ToLowerInvariant();
            if (lower.StartsWith("easyanticheat") && lower.EndsWith(".exe")) return "Easy Anti-Cheat";
            if (lower is "beservice_x64.exe" or "install_battleye.bat" || lower.EndsWith("_be.exe")) return "BattlEye";
            if (lower is "ggsetup.exe" or "gameguard.des") return "GameGuard";
            if (lower.StartsWith("eaanticheat")) return "EA Javelin Anticheat";
            if (KnownExes.TryGetValue(lower, out var known) && lower != "cod.exe") return known;
            if (lower == "cod.exe" || (lower.EndsWith("-cod.exe") && lower.Length > 8)) return "Ricochet (Call of Duty)";
        }

        if (depth == 0) return null;
        foreach (var sub in entries.Where(Directory.Exists))
        {
            if (Walk(sub, depth - 1) is { } hit) return hit;
        }
        return null;
    }

    /// <summary>Der Content-Ordner einer Game-Pass-/Store-Installation (mit MicrosoftGame.config).</summary>
    public static string? StoreContentDir(Game game)
    {
        var dir = new DirectoryInfo(game.ModDir);
        for (var i = 0; i < 4 && dir != null; i++, dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "MicrosoftGame.config"))) return dir.FullName;
        }
        return null;
    }

    /// <summary>
    /// True, wenn es eine Store-Kopie ist, deren Spiel-EXE sich nicht lesen lässt –
    /// Windows schützt dann die Installation, und Mods neben der EXE werden nicht geladen.
    /// </summary>
    public static bool IsLockedStoreCopy(Game game, Func<string, bool>? canRead = null)
    {
        if (StoreContentDir(game) == null || game.MainExe == null) return false;
        canRead ??= CanRead;
        return !canRead(game.MainExe);
    }

    private static bool CanRead(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return stream.ReadByte() >= 0;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return false; }
    }
}
