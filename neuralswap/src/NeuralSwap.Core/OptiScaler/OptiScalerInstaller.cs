using System.Text.Json;
using NeuralSwap.Core.Models;
using SharpCompress.Archives;
using SharpCompress.Common;

namespace NeuralSwap.Core.OptiScaler;

/// <summary>
/// Installiert OptiScaler (https://github.com/optiscaler/OptiScaler) in ein
/// Spiel. OptiScaler bringt DLSS/Neural-Rendering-Upscaling in Spiele ohne
/// native Unterstützung und ist die Basis der AMD-Mods.
/// Ablauf: neuestes GitHub-Release laden → Archiv in den Spielordner
/// entpacken → OptiScaler.dll unter einem Proxy-Namen (Standard: dxgi.dll)
/// bereitstellen.
/// </summary>
public sealed class OptiScalerInstaller
{
    public static readonly string[] ProxyNames =
        { "dxgi.dll", "winmm.dll", "dbghelp.dll", "version.dll", "wininet.dll", "winhttp.dll", "OptiScaler.asi" };

    private readonly HttpClient _http;

    public OptiScalerInstaller(HttpClient? http = null)
    {
        _http = http ?? new HttpClient();
        if (!_http.DefaultRequestHeaders.Contains("User-Agent"))
            _http.DefaultRequestHeaders.Add("User-Agent", "NeuralSwap");
    }

    public sealed record InstallResult(bool Success, string Message, string? InstallDir);

    public async Task<InstallResult> InstallAsync(
        Game game,
        string repo = "optiscaler/OptiScaler",
        string proxyName = "dxgi.dll",
        IProgress<string>? progress = null,
        CancellationToken ct = default)
    {
        // Zielordner: dort, wo bereits DLSS-DLLs liegen (dann liegt dort auch
        // die Spiel-Exe bzw. die Engine erwartet die Proxy-DLL), sonst der
        // Spielordner selbst.
        var targetDir = game.Dlls
            .Select(d => Path.GetDirectoryName(d.Path)!)
            .FirstOrDefault() ?? game.InstallDir;

        try
        {
            progress?.Report($"Suche neuestes OptiScaler-Release ({repo}) …");
            var releaseJson = await _http.GetStringAsync($"https://api.github.com/repos/{repo}/releases/latest", ct);
            using var doc = JsonDocument.Parse(releaseJson);

            string? assetUrl = null, assetName = null;
            foreach (var asset in doc.RootElement.GetProperty("assets").EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                if (name.EndsWith(".7z", StringComparison.OrdinalIgnoreCase) ||
                    name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    assetUrl = asset.GetProperty("browser_download_url").GetString();
                    assetName = name;
                    break;
                }
            }
            if (assetUrl == null)
                return new InstallResult(false, "Kein passendes Archiv im neuesten Release gefunden.", null);

            var tag = doc.RootElement.TryGetProperty("tag_name", out var t) ? t.GetString() : null;
            progress?.Report($"Lade {assetName} ({tag}) …");

            var tempFile = Path.Combine(Path.GetTempPath(), "NeuralSwap", Guid.NewGuid().ToString("N") + "_" + assetName);
            Directory.CreateDirectory(Path.GetDirectoryName(tempFile)!);
            await using (var response = await _http.GetStreamAsync(assetUrl, ct))
            await using (var file = File.Create(tempFile))
            {
                await response.CopyToAsync(file, ct);
            }

            progress?.Report($"Entpacke nach {targetDir} …");
            using (var archive = ArchiveFactory.OpenArchive(tempFile, new SharpCompress.Readers.ReaderOptions()))
            {
                foreach (var entry in archive.Entries.Where(e => !e.IsDirectory))
                {
                    entry.WriteToDirectory(targetDir, new ExtractionOptions
                    {
                        ExtractFullPath = true,
                        Overwrite = true,
                    });
                }
            }

            var optiDll = Path.Combine(targetDir, "OptiScaler.dll");
            if (File.Exists(optiDll) && !proxyName.Equals("OptiScaler.dll", StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(optiDll, Path.Combine(targetDir, proxyName), overwrite: true);
            }

            return new InstallResult(true,
                $"OptiScaler {tag} nach {targetDir} installiert (Proxy: {proxyName}). " +
                "Bei Problemen anderen Proxy-Namen probieren oder die OptiScaler.ini anpassen.",
                targetDir);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new InstallResult(false, $"Download fehlgeschlagen: {ex.Message}", null);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return new InstallResult(false, $"Installation fehlgeschlagen: {ex.Message}", null);
        }
    }

    /// <summary>Entfernt eine zuvor installierte OptiScaler-Kopie wieder.</summary>
    public static InstallResult Uninstall(string installDir, string proxyName = "dxgi.dll")
    {
        try
        {
            var removed = 0;
            foreach (var file in new[] { "OptiScaler.dll", "OptiScaler.ini", proxyName })
            {
                var path = Path.Combine(installDir, file);
                if (File.Exists(path)) { File.Delete(path); removed++; }
            }
            return new InstallResult(true, $"{removed} OptiScaler-Datei(en) entfernt.", installDir);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new InstallResult(false, $"Entfernen fehlgeschlagen: {ex.Message}", installDir);
        }
    }
}
