using System.Text.RegularExpressions;

namespace NeuralSwap.Core.NeuralRendering;

/// <summary>
/// Übersetzt die (englischen) Ausgaben von DLSS5oneclick ins Deutsche. Bekannte
/// Meldungen werden vollständig übersetzt, Fortschrittszeilen in ihren festen
/// Bestandteilen; Unbekanntes bleibt im Original stehen.
/// </summary>
public static class Dlss5OneClickText
{
    private static readonly (Regex Pattern, Func<Match, string> German)[] Rules =
    {
        Rule(@"^error:\s*Game Pass / Microsoft Store copy \((?<dir>.+?)\):.*$", m =>
            $"Diese Game-Pass-/Store-Installation ({m.Groups["dir"].Value}) schützt Windows: Die Spiel-EXE ist gesperrt, " +
            "deshalb lädt das Spiel keine Mods, die daneben liegen. Neural Rendering ist auf dieser Kopie nicht möglich – " +
            "mit der Steam-, Epic- oder GOG-Version desselben Spiels funktioniert es."),
        Rule(@"^(?<ac>.+?) anti-cheat found in this game\..*$", m =>
            $"Anti-Cheat im Spiel gefunden ({m.Groups["ac"].Value}). Es erkennt eingeschleuste ReShade-Add-ons – " +
            "im besten Fall ein Kick, im schlimmsten eine Sperre. Deshalb abgelehnt."),
        Rule(@"^error:\s*nothing from this tool is installed in this game yet.*$", _ =>
            "Hier ist noch kein Neural Rendering installiert – zuerst „Installieren / Aktualisieren“."),
        Rule(@"^error:\s*this game is on the last setup there is \((?<s>.+?)\); nothing further to try\.?$", m =>
            $"Das ist bereits das letzte Setup der Liste ({m.Groups["s"].Value}) – weitere Varianten gibt es nicht."),
        Rule(@"^error:\s*none of this tool's setups fits this game\.?$", _ =>
            "Für dieses Spiel passt keines der Setups von DLSS5oneclick."),
        Rule(@"^error:\s*game executable not found:\s*(?<p>.+)$", m => $"Spiel-EXE nicht gefunden: {m.Groups["p"].Value}"),
        Rule(@"^Done\. In game: Home opens ReShade -> Add-ons tab -> DLSS 5 Neural Rendering -> enable\..*$", _ =>
            "Fertig. Im Spiel DLSS bzw. DLAA einschalten, dann Pos1 → Reiter „Add-ons“ → „DLSS 5 Neural Rendering“ aktivieren " +
            "(F6 schaltet es ein und aus). Dass der Pos1-Reiter „keine Effektdateien“ meldet, ist bei Spielen mit eigenem DLSS normal."),
        Rule(@"^Done\. In game: Home opens ReShade -> Add-ons tab -> RenoDX DLSS -> turn Neural Rendering on\..*$", _ =>
            "Fertig. Im Spiel Pos1 → Reiter „Add-ons“ → „RenoDX DLSS“ → Neural Rendering einschalten."),
        Rule(@"^Done\. In game: Insert opens the OptiScaler overlay -> enable Neural Rendering.*$", _ =>
            "Fertig. Im Spiel öffnet die Einfg-Taste das OptiScaler-Menü – dort Neural Rendering einschalten (ist anfangs aus)."),
        Rule(@"^Done\. In game: turn the game's own upscaling on.*AMDNR menu.*$", _ =>
            "Fertig. Im Spiel das Upscaling einschalten (DLSS, FSR oder XeSS); Einfg öffnet das AMDNR-Menü, Pos1 schaltet es ein und aus."),
        Rule(@"^Done\. In game: Neural Rendering is on.*RTX Encore menu.*$", _ =>
            "Fertig. Neural Rendering ist an (braucht DLSS Super Resolution im Spiel); Einfg öffnet das RTX-Encore-Menü."),
        Rule(@"^Done\. In game: turn the game's own upscaling, anti-aliasing and frame generation off.*$", _ =>
            "Fertig. Im Spiel Upscaling, Kantenglättung und Frame Generation ausschalten und im Fenster spielen; " +
            "Pos1 → Reiter „Add-ons“ → „Standalone DLSS-NR + SR“."),
        Rule(@"^Done\. In game: turn on the game's own DLSS Frame Generation; Backspace opens the RTXMFG menu\.?$", _ =>
            "Fertig. Im Spiel DLSS Frame Generation einschalten; die Rücktaste öffnet das RTXMFG-Menü."),
        Rule(@"^Done\. In game: turn on the game's own DLSS Frame Generation; Home opens ReShade.*$", _ =>
            "Fertig. Im Spiel DLSS Frame Generation einschalten; Pos1 → Reiter „Add-ons“ → MFG-Freischaltung."),
        Rule(@"^No ReShade\.log next to the game exe.*$", _ =>
            "Keine ReShade.log neben der Spiel-EXE: ReShade wurde noch nie geladen. Entweder wurde das Spiel seit der " +
            "Installation nicht gestartet, oder es lädt dxgi.dll nicht (falsche EXE oder ein Launcher startet eine andere)."),
        Rule(@"^DLSS 5 model beside the exe: (?<v>\S+) — NVIDIA original build$", m =>
            $"DLSS-5-Modell neben der EXE: {m.Groups["v"].Value} – NVIDIA-Originalbuild"),
        Rule(@"^DLSS 5 model beside the exe: (?<v>\S+) — ShortFuse \.SF build.*$", m =>
            $"DLSS-5-Modell neben der EXE: {m.Groups["v"].Value} – ShortFuse-Build für alle RTX-Generationen"),
        Rule(@"^removed (?<f>.+)$", m => $"entfernt: {m.Groups["f"].Value}"),
        Rule(@"^using (?<exe>.+?)(?: \(other candidates: (?<o>.+)\))?$", m =>
            $"verwende {m.Groups["exe"].Value}" + (m.Groups["o"].Success ? $" (weitere Kandidaten: {m.Groups["o"].Value})" : "")),
        Rule(@"^FAILED:\s*(?<d>.*)$", m => $"FEHLER: {m.Groups["d"].Value}"),
        // Unbekannte Fehler: Präfix auf Deutsch, Einzelheiten im Original.
        Rule(@"^error:\s*(?<d>.*)$", m => $"Fehler (Originalmeldung): {m.Groups["d"].Value}"),
    };

    private static readonly (string English, string German)[] Phrases =
    {
        ("setup:", "Setup:"),
        ("chosen by hand, kept", "von Hand gewählt, bleibt"),
        ("the game has its own DLSS", "Spiel hat eigenes DLSS"),
        ("the game has no DLSS of its own", "Spiel ohne eigenes DLSS"),
        ("API unknown, assuming DX12", "API unbekannt, DX12 angenommen"),
        ("GPU unknown", "GPU unbekannt"),
        ("ReShade (add-on build)", "ReShade (Add-on-Version)"),
        ("DLSS 5 add-on + models", "DLSS-5-Add-on + Modell"),
        ("ReShade config", "ReShade-Konfiguration"),
        ("GPU preference", "GPU-Zuweisung"),
        ("already present", "bereits vorhanden"),
        ("(newest build)", "(neueste Version)"),
        ("present (not placed by this tool)", "vorhanden (nicht von DLSS5oneclick)"),
        ("[warn]", "[Hinweis]"),
        ("[FAIL]", "[FEHLER]"),
        ("[ok  ]", "[ok]"),
    };

    private static readonly Regex Step = new(@"\(step (\d+) of (\d+)\)", RegexOptions.Compiled);

    private static (Regex, Func<Match, string>) Rule(string pattern, Func<Match, string> german) =>
        (new Regex(pattern, RegexOptions.Compiled | RegexOptions.CultureInvariant), german);

    public static string ToGerman(string line)
    {
        var text = line.Trim();

        // Diagnose-Zeilen: Präfix übersetzen, Rest einzeln prüfen.
        var diag = Regex.Match(text, @"^\[(ok  |warn|FAIL)\]\s*(?<rest>.*)$");
        if (diag.Success)
        {
            var prefix = diag.Groups[1].Value switch { "FAIL" => "[FEHLER]", "warn" => "[Hinweis]", _ => "[ok]" };
            return $"{prefix} {ToGerman(diag.Groups["rest"].Value)}";
        }

        foreach (var (pattern, german) in Rules)
        {
            var m = pattern.Match(text);
            if (m.Success) return german(m);
        }

        foreach (var (english, german) in Phrases)
            text = text.Replace(english, german, StringComparison.Ordinal);
        return Step.Replace(text, "(Stufe $1 von $2)");
    }
}
