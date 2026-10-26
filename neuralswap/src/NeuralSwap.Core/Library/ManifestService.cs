using NeuralSwap.Core.Models;

namespace NeuralSwap.Core.Library;

/// <summary>Lädt das Versions-Manifest und holt DLLs aus dessen Quellen in die Bibliothek.</summary>
public sealed class ManifestService
{
    private readonly HttpClient _http;

    public ManifestService(HttpClient? http = null)
    {
        _http = http ?? new HttpClient();
        if (!_http.DefaultRequestHeaders.Contains("User-Agent"))
            _http.DefaultRequestHeaders.Add("User-Agent", "NeuralSwap");
    }

    /// <summary>Lädt das Manifest von einer URL, mit lokaler Datei als Fallback.</summary>
    public async Task<VersionManifest> LoadAsync(string? remoteUrl, string localFallbackPath, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(remoteUrl))
        {
            try
            {
                var json = await _http.GetStringAsync(remoteUrl, ct);
                return VersionManifest.Parse(json);
            }
            catch (Exception) { /* offline oder URL defekt → lokales Manifest */ }
        }

        if (File.Exists(localFallbackPath))
            return VersionManifest.Parse(await File.ReadAllTextAsync(localFallbackPath, ct));

        return new VersionManifest();
    }

    /// <summary>
    /// Lädt die DLL eines Manifest-Eintrags aus der ersten erreichbaren Quelle,
    /// prüft (falls angegeben) den SHA-256 und importiert sie in die Bibliothek.
    /// </summary>
    public async Task<DllLibrary.LibraryEntry> DownloadAsync(
        ManifestDll dll, DllLibrary library, IProgress<string>? progress = null, CancellationToken ct = default)
    {
        if (dll.Sources.Count == 0)
            throw new InvalidOperationException(
                $"Für {dll.FileName} {dll.Version} ist keine Download-Quelle hinterlegt. " +
                "Bitte die DLL manuell importieren (z. B. aus einem Spiel oder von Nexus Mods).");

        var tempDir = Path.Combine(Path.GetTempPath(), "NeuralSwap", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var tempFile = Path.Combine(tempDir, dll.FileName);

        Exception? lastError = null;
        foreach (var source in dll.Sources)
        {
            try
            {
                progress?.Report($"Lade {dll.FileName} {dll.Version} von {source.Name} …");
                await using (var response = await _http.GetStreamAsync(source.Url, ct))
                await using (var file = File.Create(tempFile))
                {
                    await response.CopyToAsync(file, ct);
                }

                var entry = library.Import(tempFile, dll.Sha256);
                progress?.Report($"{dll.FileName} {entry.Version} importiert.");
                return entry;
            }
            catch (Exception ex)
            {
                lastError = ex;
                progress?.Report($"Quelle {source.Name} fehlgeschlagen: {ex.Message}");
            }
        }

        throw new InvalidOperationException(
            $"Keine Quelle für {dll.FileName} {dll.Version} erreichbar.", lastError);
    }
}
