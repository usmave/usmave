using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Pe;

namespace NeuralSwap.Core.NeuralRendering;

/// <summary>Woher DLSS5oneclick kommt – über das Manifest austauschbar.</summary>
public sealed class Dlss5OneClickSource
{
    [JsonPropertyName("repo")] public string Repo { get; set; } = "faisalkindi/DLSS5oneclick";
    [JsonPropertyName("assetName")] public string AssetName { get; set; } = "dlss5oneclick.exe";

    /// <summary>Feste Version (Release-Tag); leer = neueste stabile Version.</summary>
    [JsonPropertyName("pinnedTag")] public string? PinnedTag { get; set; }
}

/// <summary>
/// Bindet DLSS5oneclick (https://github.com/faisalkindi/DLSS5oneclick, MIT) als
/// Engine für Neural Rendering ein. Dessen Kommandozeile installiert ohne
/// Rückfragen und wählt das passende Setup selbst (ReShade + renodx-dlss5,
/// ShortFuses Add-on, OptiScaler-NR-Fork für Vulkan, Feeder für Spiele ohne
/// DLSS, REFramework für RE-Engine-Spiele …); Exit-Code 0 = Erfolg, 1 = Fehler.
/// </summary>
public sealed class Dlss5OneClick
{
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(45);

    private readonly GitHubReleases _github;
    private readonly IProcessRunner _runner;
    private readonly Dlss5OneClickSource _source;
    private readonly string _toolDir;

    public Dlss5OneClick(HttpClient http, IProcessRunner runner, Dlss5OneClickSource source, string toolsRoot)
    {
        _github = new GitHubReleases(http);
        _runner = runner;
        _source = source;
        _toolDir = Path.Combine(toolsRoot, "dlss5oneclick");
    }

    public sealed record Tool(string ExePath, string Tag);

    /// <summary>Stabiles Release mit dem Programm-Asset; Vorabversionen nur, wenn es nichts anderes gibt.</summary>
    public static GitHubRelease? PickRelease(IEnumerable<GitHubRelease> releases, Dlss5OneClickSource source)
    {
        bool HasAsset(GitHubAsset a) => a.Name.Equals(source.AssetName, StringComparison.OrdinalIgnoreCase);
        var list = releases.Where(r => !r.Draft && r.Assets.Any(HasAsset)).ToList();
        if (!string.IsNullOrWhiteSpace(source.PinnedTag))
            return list.FirstOrDefault(r => r.TagName.Equals(source.PinnedTag, StringComparison.OrdinalIgnoreCase));
        return list.Where(r => !r.Prerelease).OrderByDescending(r => r.PublishedAt ?? DateTime.MinValue).FirstOrDefault()
               ?? list.OrderByDescending(r => r.PublishedAt ?? DateTime.MinValue).FirstOrDefault();
    }

    /// <summary>Lädt DLSS5oneclick (gecacht, SHA-256 gegen GitHubs Digest geprüft).</summary>
    public async Task<Tool> EnsureAsync(IProgress<string>? progress, CancellationToken ct = default)
    {
        try
        {
            var releases = await _github.GetReleasesAsync(_source.Repo, maxPages: 1, ct);
            var release = PickRelease(releases, _source)
                          ?? throw new InvalidOperationException($"Kein Release von {_source.Repo} mit {_source.AssetName} gefunden.");
            var asset = release.Assets.First(a => a.Name.Equals(_source.AssetName, StringComparison.OrdinalIgnoreCase));
            var exe = Path.Combine(_toolDir, Sanitize(release.TagName), _source.AssetName);
            if (!IsValidTool(exe))
            {
                progress?.Report($"Lade DLSS5oneclick {release.TagName} …");
                await _github.DownloadAsync(asset.Url, exe, asset.Digest, ct);
                if (!IsValidTool(exe))
                {
                    File.Delete(exe);
                    throw new InvalidOperationException("Der DLSS5oneclick-Download ist keine gültige 64-Bit-EXE.");
                }
            }
            return new Tool(exe, release.TagName);
        }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or TaskCanceledException
                                       && !ct.IsCancellationRequested)
        {
            // Offline, GitHub-Limit oder Prüfsummenfehler: die neueste bereits geladene (geprüfte) Version nehmen.
            var cached = Directory.Exists(_toolDir)
                ? Directory.EnumerateFiles(_toolDir, _source.AssetName, SearchOption.AllDirectories)
                    .Where(IsValidTool).OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault()
                : null;
            if (cached == null) throw;
            progress?.Report($"Neue DLSS5oneclick-Version nicht verfügbar ({ex.Message}) – nutze die bereits geladene, geprüfte Version.");
            return new Tool(cached, Path.GetFileName(Path.GetDirectoryName(cached)!));
        }
    }

    public static bool IsValidTool(string path) =>
        File.Exists(path) && new FileInfo(path).Length > 100_000 && PeInfo.TryRead(path) is { Is64Bit: true };

    /// <summary>Führt DLSS5oneclick für ein Spiel (EXE oder Ordner) mit den angegebenen Schaltern aus.</summary>
    public Task<ProcessResult> RunAsync(Tool tool, string target, IEnumerable<string> flags,
        Action<string>? onLine = null, CancellationToken ct = default)
    {
        var args = new List<string> { target };
        args.AddRange(flags);
        return _runner.RunAsync(tool.ExePath, args, Timeout, onLine, ct);
    }

    private static readonly Regex ProgressSegment = new(@"^\s*\d{1,3}%\s", RegexOptions.Compiled);

    /// <summary>
    /// Bereitet eine Ausgabezeile fürs Protokoll auf: Fortschrittsanzeigen
    /// („ 42% …“, per \r überschrieben) entfallen, übrig bleibt der Text.
    /// </summary>
    public static string? CleanLine(string raw)
    {
        var segments = raw.Split('\r').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
        var text = segments.LastOrDefault(s => !ProgressSegment.IsMatch(s));
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static string Sanitize(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s;
    }
}
