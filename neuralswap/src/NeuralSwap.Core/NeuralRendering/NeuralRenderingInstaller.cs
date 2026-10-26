using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Presets;
using SharpCompress.Archives;
using SharpCompress.Common;

namespace NeuralSwap.Core.NeuralRendering;

/// <summary>Download-Quellen für die Neural-Rendering-Komponenten (per Manifest überschreibbar).</summary>
public sealed class NrSources
{
    /// <summary>ReShade-Addon „DLSS5-Feeder" (Pfad B: Spiele ohne natives DLSS).</summary>
    [JsonPropertyName("feederRepo")] public string FeederRepo { get; set; } = "jlrouzies-fr/DLSS5-Feeder";

    /// <summary>LumeniteFX-Shader als Motion-Vector-Provider (Pfad B).</summary>
    [JsonPropertyName("lumeniteRepo")] public string LumeniteRepo { get; set; } = "umar-afzaal/LumeniteFX";
    [JsonPropertyName("lumeniteBranch")] public string LumeniteBranch { get; set; } = "mainline";

    /// <summary>Standard-Shader-Header von ReShade (Pfad B).</summary>
    [JsonPropertyName("shadersRepo")] public string ShadersRepo { get; set; } = "crosire/reshade-shaders";
    [JsonPropertyName("shadersBranch")] public string ShadersBranch { get; set; } = "slim";

    /// <summary>RenoDX-DLSS5-Addon (Pfad A: Spiele mit nativem DLSS).</summary>
    [JsonPropertyName("addonRepo")] public string AddonRepo { get; set; } = "RankFTW/rhi-repo";
    [JsonPropertyName("addonAssetPrefix")] public string AddonAssetPrefix { get; set; } = "renodx-dlss5";
}

/// <summary>Einstellungen für die Neural-Rendering-Installation.</summary>
public sealed class NrOptions
{
    /// <summary>Modell-Auflösung in Prozent (100/75/50) – niedriger = schneller, weicher.</summary>
    public int WorkingScalePercent { get; set; } = 75;

    /// <summary>RenoDX NRDetailStability (2 = „Always", Standard der Community-Installer).</summary>
    public int DetailStability { get; set; } = 2;

    /// <summary>Anzahl der Neural-Passes (1 = Standard).</summary>
    public int Passes { get; set; } = 1;
}

/// <summary>
/// Installiert die Community-Mods für fotorealistische Gesichter und
/// Beleuchtung (DLSS 5 Neural Rendering) in ein Spiel – nach dem Muster der
/// etablierten Community-Installer:
///  Pfad A (Spiel hat natives DLSS): ReShade-Addon „renodx-dlss5.addon64"
///   + nvngx_dlssnr.dll, Konfiguration in ReShade.ini [RenoDX.DLSS5].
///  Pfad B (kein DLSS): „dlss5-feed.addon64" + DLSS5_Feed.fx + LumeniteFX
///   (Motion-Vectors) + Shader-Header, Feed-Konfiguration in dlss5-feed.cfg.
/// ReShade selbst (mit Add-on-Unterstützung) muss einmalig über den
/// offiziellen Installer von reshade.me ins Spiel – darauf weist das
/// Ergebnis hin, falls es fehlt.
/// </summary>
public sealed class NeuralRenderingInstaller
{
    public const string StateFileName = "_neuralswap-nr.json";

    private readonly HttpClient _http;

    public NeuralRenderingInstaller(HttpClient? http = null)
    {
        _http = http ?? new HttpClient();
        if (!_http.DefaultRequestHeaders.Contains("User-Agent"))
            _http.DefaultRequestHeaders.Add("User-Agent", "NeuralSwap");
    }

    public sealed record NrResult(bool Success, string Message, string? InstallDir);

    public async Task<NrResult> InstallAsync(
        Game game, DllLibrary library, NrSources sources, NrOptions options,
        IProgress<string>? progress = null, CancellationToken ct = default)
    {
        var targetDir = game.Dlls
            .Select(d => Path.GetDirectoryName(d.Path)!)
            .FirstOrDefault() ?? game.InstallDir;
        var routeA = game.Dlls.Any(d => d.Kind == DlssDllKind.SuperResolution);
        var installedFiles = new List<string>();

        try
        {
            // 1) Neural-Rendering-Modell aus der Bibliothek bereitstellen.
            var nr = library.Latest(DlssDllKind.NeuralRendering);
            if (nr == null)
                return new NrResult(false,
                    "Keine nvngx_dlssnr.dll in der Bibliothek. Erst unter „DLL-Bibliothek…“ importieren " +
                    "(RTX 50: Original-Build; RTX 20–40: ShortFuse-Kompatibilitäts-Build).", null);

            var nrTarget = Path.Combine(targetDir, DlssDllKind.NeuralRendering.FileName());
            if (!File.Exists(nrTarget))
            {
                File.Copy(nr.Path, nrTarget);
                installedFiles.Add(nrTarget);
                progress?.Report($"nvngx_dlssnr.dll {nr.Version} bereitgestellt.");
            }

            // 2) Komponenten laden.
            if (routeA)
            {
                progress?.Report("Pfad A (natives DLSS): lade RenoDX-DLSS5-Addon …");
                await DownloadLatestAssetAsync(sources.AddonRepo,
                    name => name.StartsWith(sources.AddonAssetPrefix, StringComparison.OrdinalIgnoreCase),
                    targetDir, installedFiles, progress, ct);
            }
            else
            {
                progress?.Report("Pfad B (kein natives DLSS): lade DLSS5-Feeder …");
                await DownloadLatestAssetAsync(sources.FeederRepo, _ => true,
                    targetDir, installedFiles, progress, ct);

                var shadersDir = Path.Combine(targetDir, "reshade-shaders", "Shaders");
                Directory.CreateDirectory(shadersDir);

                progress?.Report("Lade LumeniteFX (Motion-Vector-Provider) …");
                await DownloadBranchShadersAsync(sources.LumeniteRepo, sources.LumeniteBranch,
                    shadersDir, installedFiles, ct);

                progress?.Report("Lade ReShade-Shader-Header …");
                await DownloadBranchShadersAsync(sources.ShadersRepo, sources.ShadersBranch,
                    shadersDir, installedFiles, ct);
            }

            // 3) Konfiguration schreiben.
            foreach (var message in ApplyConfigs(targetDir, routeA, options))
                progress?.Report(message);

            // 4) Zustand für die Deinstallation festhalten.
            File.WriteAllText(Path.Combine(targetDir, StateFileName),
                JsonSerializer.Serialize(installedFiles, new JsonSerializerOptions { WriteIndented = true }));

            var reshadeHint = HasReShade(targetDir)
                ? string.Empty
                : " WICHTIG: ReShade fehlt noch – einmalig den offiziellen Installer von reshade.me ausführen " +
                  "(Spiel auswählen, Haken bei „Add-on support“ setzen), dann greift die Installation.";
            var activateHint = routeA
                ? " Aktivierung: im Spiel das ReShade-Overlay (Pos1) öffnen → Add-ons → RenoDX.DLSS5."
                : " Aktivierung: im Spiel Pos1 (ReShade) → Add-on „DLSS 5 Feed“; Lumenite_Kernel muss über DLSS5_Feed stehen.";

            return new NrResult(true,
                $"Neural Rendering ({(routeA ? "RenoDX-Route" : "Feeder-Route")}) installiert, " +
                $"Modell-Auflösung {options.WorkingScalePercent} %.{activateHint}{reshadeHint}", targetDir);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new NrResult(false, $"Download fehlgeschlagen: {ex.Message}", null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException or JsonException)
        {
            return new NrResult(false, $"Installation fehlgeschlagen: {ex.Message}", null);
        }
    }

    /// <summary>Entfernt eine frühere Neural-Rendering-Installation anhand der Zustandsdatei.</summary>
    public static NrResult Uninstall(string installDir)
    {
        var stateFile = Path.Combine(installDir, StateFileName);
        if (!File.Exists(stateFile))
            return new NrResult(false, "Keine Neural-Rendering-Installation gefunden.", installDir);

        try
        {
            var files = JsonSerializer.Deserialize<List<string>>(File.ReadAllText(stateFile)) ?? new();
            var removed = 0;
            foreach (var file in files.Where(File.Exists)) { File.Delete(file); removed++; }
            File.Delete(stateFile);
            return new NrResult(true, $"{removed} Neural-Rendering-Datei(en) entfernt. Konfig-Einträge in ReShade.ini bleiben wirkungslos zurück.", installDir);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            return new NrResult(false, $"Entfernen fehlgeschlagen: {ex.Message}", installDir);
        }
    }

    public static bool IsInstalled(string installDir) => File.Exists(Path.Combine(installDir, StateFileName));

    public static bool HasReShade(string dir) =>
        File.Exists(Path.Combine(dir, "ReShade.ini")) ||
        File.Exists(Path.Combine(dir, "ReShade64.dll")) ||
        File.Exists(Path.Combine(dir, "ReShade32.dll"));

    // ----- Konfiguration (separat, damit unter Linux testbar) -----

    public static List<string> ApplyConfigs(string targetDir, bool routeA, NrOptions options)
    {
        var messages = new List<string>();
        var scale = (options.WorkingScalePercent / 100.0).ToString("0.0#", CultureInfo.InvariantCulture);
        var reShadeIniPath = Path.Combine(targetDir, "ReShade.ini");
        var reShadeIni = IniFile.Load(reShadeIniPath);

        if (routeA)
        {
            reShadeIni.Set("RenoDX.DLSS5", "NRHookPoint", "1");
            reShadeIni.Set("RenoDX.DLSS5", "NRPasses", options.Passes.ToString(CultureInfo.InvariantCulture));
            reShadeIni.Set("RenoDX.DLSS5", "NRDetailStability", options.DetailStability.ToString(CultureInfo.InvariantCulture));
            messages.Add("ReShade.ini: [RenoDX.DLSS5] konfiguriert.");
        }
        else
        {
            // Motion-Vector-Provider für den Feeder aktivieren, ohne
            // vorhandene PreprocessorDefinitions zu überschreiben.
            const string token = "DLSS5_MV_PROVIDER=3";
            var defs = reShadeIni.Get("GENERAL", "PreprocessorDefinitions");
            if (string.IsNullOrWhiteSpace(defs))
                reShadeIni.Set("GENERAL", "PreprocessorDefinitions", token);
            else if (!defs.Contains("DLSS5_MV_PROVIDER", StringComparison.OrdinalIgnoreCase))
                reShadeIni.Set("GENERAL", "PreprocessorDefinitions", defs.TrimEnd(',') + "," + token);
            messages.Add("ReShade.ini: DLSS5_MV_PROVIDER gesetzt.");

            // Feed-Konfiguration (einfaches key=value-Format).
            var cfgPath = Path.Combine(targetDir, "dlss5-feed.cfg");
            SetPlainKey(cfgPath, "work_resolution", scale);
            messages.Add($"dlss5-feed.cfg: work_resolution={scale}.");

            // Preset: Lumenite_Kernel muss vor DLSS5_Feed laufen.
            var presetPath = Path.Combine(targetDir, "ReShadePreset.ini");
            if (!File.Exists(presetPath))
            {
                File.WriteAllLines(presetPath, new[] { "Techniques=Lumenite_Kernel,DLSS5_Feed" });
                messages.Add("ReShadePreset.ini angelegt (Lumenite_Kernel + DLSS5_Feed aktiv).");
            }
            else
            {
                var lines = File.ReadAllLines(presetPath).ToList();
                var idx = lines.FindIndex(l => l.TrimStart().StartsWith("Techniques=", StringComparison.OrdinalIgnoreCase));
                if (idx < 0)
                {
                    lines.Add("Techniques=Lumenite_Kernel,DLSS5_Feed");
                }
                else if (!lines[idx].Contains("DLSS5_Feed", StringComparison.OrdinalIgnoreCase))
                {
                    lines[idx] = lines[idx].TrimEnd(',') + ",Lumenite_Kernel,DLSS5_Feed";
                }
                File.WriteAllLines(presetPath, lines);
                messages.Add("ReShadePreset.ini: Techniken ergänzt.");
            }
        }

        reShadeIni.Save(reShadeIniPath);

        // Läuft OptiScaler im Spiel, bekommt es dieselbe Modell-Auflösung.
        var optiScalerIni = Path.Combine(targetDir, "OptiScaler.ini");
        if (File.Exists(optiScalerIni))
        {
            var ini = IniFile.Load(optiScalerIni);
            ini.Set("DlssNr", "WorkingScale", scale);
            ini.Save(optiScalerIni);
            messages.Add($"OptiScaler.ini: [DlssNr] WorkingScale={scale}.");
        }

        return messages;
    }

    private static void SetPlainKey(string path, string key, string value)
    {
        var lines = File.Exists(path) ? File.ReadAllLines(path).ToList() : new List<string>();
        var idx = lines.FindIndex(l => l.TrimStart().StartsWith(key + "=", StringComparison.OrdinalIgnoreCase));
        if (idx >= 0) lines[idx] = $"{key}={value}";
        else lines.Add($"{key}={value}");
        File.WriteAllLines(path, lines);
    }

    // ----- Downloads -----

    private async Task DownloadLatestAssetAsync(
        string repo, Func<string, bool> assetMatch, string targetDir,
        List<string> installedFiles, IProgress<string>? progress, CancellationToken ct)
    {
        var json = await _http.GetStringAsync($"https://api.github.com/repos/{repo}/releases/latest", ct);
        using var doc = JsonDocument.Parse(json);

        string? url = null, name = null;
        foreach (var asset in doc.RootElement.GetProperty("assets").EnumerateArray())
        {
            var assetName = asset.GetProperty("name").GetString() ?? "";
            if (!assetMatch(assetName)) continue;
            url = asset.GetProperty("browser_download_url").GetString();
            name = assetName;
            break;
        }
        if (url == null || name == null)
            throw new InvalidOperationException($"Kein passendes Release-Asset in {repo} gefunden.");

        progress?.Report($"Lade {name} …");
        var tempFile = Path.Combine(Path.GetTempPath(), "NeuralSwap", Guid.NewGuid().ToString("N") + "_" + name);
        Directory.CreateDirectory(Path.GetDirectoryName(tempFile)!);
        await DownloadToFileAsync(url, tempFile, ct);

        if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
            name.EndsWith(".7z", StringComparison.OrdinalIgnoreCase))
        {
            using var archive = ArchiveFactory.OpenArchive(tempFile, new SharpCompress.Readers.ReaderOptions());
            foreach (var entry in archive.Entries.Where(e => !e.IsDirectory))
            {
                entry.WriteToDirectory(targetDir, new ExtractionOptions { ExtractFullPath = true, Overwrite = true });
                installedFiles.Add(Path.Combine(targetDir, entry.Key!.Replace('/', Path.DirectorySeparatorChar)));
            }
        }
        else
        {
            var dest = Path.Combine(targetDir, name);
            File.Copy(tempFile, dest, overwrite: true);
            installedFiles.Add(dest);
        }
    }

    /// <summary>Lädt einen Branch als Zip und entpackt nur die Shader (*.fx, *.fxh) flach in den Zielordner.</summary>
    private async Task DownloadBranchShadersAsync(
        string repo, string branch, string shadersDir, List<string> installedFiles, CancellationToken ct)
    {
        var tempFile = Path.Combine(Path.GetTempPath(), "NeuralSwap", Guid.NewGuid().ToString("N") + ".zip");
        Directory.CreateDirectory(Path.GetDirectoryName(tempFile)!);
        await DownloadToFileAsync($"https://api.github.com/repos/{repo}/zipball/{branch}", tempFile, ct);

        using var archive = ArchiveFactory.OpenArchive(tempFile, new SharpCompress.Readers.ReaderOptions());
        foreach (var entry in archive.Entries.Where(e => !e.IsDirectory))
        {
            var ext = Path.GetExtension(entry.Key ?? "");
            if (!ext.Equals(".fx", StringComparison.OrdinalIgnoreCase) &&
                !ext.Equals(".fxh", StringComparison.OrdinalIgnoreCase)) continue;

            var dest = Path.Combine(shadersDir, Path.GetFileName(entry.Key!));
            using var entryStream = entry.OpenEntryStream();
            using var file = File.Create(dest);
            entryStream.CopyTo(file);
            installedFiles.Add(dest);
        }
    }

    private async Task DownloadToFileAsync(string url, string destFile, CancellationToken ct)
    {
        await using var response = await _http.GetStreamAsync(url, ct);
        await using var file = File.Create(destFile);
        await response.CopyToAsync(file, ct);
    }
}
