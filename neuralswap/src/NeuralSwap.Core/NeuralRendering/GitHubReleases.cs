using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace NeuralSwap.Core.NeuralRendering;

public sealed class GitHubRelease
{
    [JsonPropertyName("tag_name")] public string TagName { get; set; } = "";
    [JsonPropertyName("draft")] public bool Draft { get; set; }
    [JsonPropertyName("prerelease")] public bool Prerelease { get; set; }
    [JsonPropertyName("published_at")] public DateTime? PublishedAt { get; set; }
    [JsonPropertyName("assets")] public List<GitHubAsset> Assets { get; set; } = new();
}

public sealed class GitHubAsset
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("browser_download_url")] public string Url { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }

    /// <summary>Von GitHub berechneter Hash, z. B. "sha256:bc4e…".</summary>
    [JsonPropertyName("digest")] public string? Digest { get; set; }
}

/// <summary>Liest GitHub-Releases und lädt Assets mit Hash-Prüfung herunter.</summary>
public sealed class GitHubReleases
{
    private readonly HttpClient _http;

    public GitHubReleases(HttpClient http) => _http = http;

    public async Task<List<GitHubRelease>> GetReleasesAsync(string repo, int maxPages = 3, CancellationToken ct = default)
    {
        var all = new List<GitHubRelease>();
        for (var page = 1; page <= maxPages; page++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                $"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}");
            request.Headers.Add("Accept", "application/vnd.github+json");
            using var response = await _http.SendAsync(request, ct);

            if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests &&
                response.Headers.TryGetValues("X-RateLimit-Remaining", out var remaining) &&
                remaining.FirstOrDefault() == "0")
                throw new InvalidOperationException(
                    "GitHub-Abfragelimit erreicht (60 Anfragen pro Stunde ohne Anmeldung). Bitte in einer Stunde erneut versuchen.");
            response.EnsureSuccessStatusCode();

            var json = await response.Content.ReadAsStringAsync(ct);
            var releases = JsonSerializer.Deserialize<List<GitHubRelease>>(json) ?? new();
            all.AddRange(releases);
            if (releases.Count < 100) break;
        }
        return all;
    }

    /// <summary>
    /// Neuestes Release (nach Veröffentlichungsdatum, ohne Entwürfe), dessen Tag
    /// zum Muster passt und das ein passendes Asset hat – dieselbe Regel wie im
    /// offiziellen DLSS5-Feeder-Installer.
    /// </summary>
    public static GitHubRelease? PickLatest(IEnumerable<GitHubRelease> releases, string tagPattern,
        Func<GitHubAsset, bool> assetFilter)
    {
        var regex = new Regex(tagPattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return releases
            .Where(r => !r.Draft && regex.IsMatch(r.TagName) && r.Assets.Any(assetFilter))
            .OrderByDescending(r => r.PublishedAt ?? DateTime.MinValue)
            .FirstOrDefault();
    }

    /// <summary>Lädt eine Datei; prüft den SHA-256 gegen den GitHub-Digest, falls vorhanden.</summary>
    public async Task DownloadAsync(string url, string targetFile, string? digest, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(targetFile)!);
        var temp = targetFile + ".part";
        await using (var response = await _http.GetStreamAsync(url, ct))
        await using (var file = File.Create(temp))
        {
            await response.CopyToAsync(file, ct);
        }

        if (!string.IsNullOrWhiteSpace(digest) && digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
        {
            var expected = digest["sha256:".Length..];
            string actual;
            await using (var file = File.OpenRead(temp))
                actual = Convert.ToHexString(await SHA256.HashDataAsync(file, ct));
            if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            {
                File.Delete(temp);
                throw new InvalidOperationException(
                    $"Prüfsumme von {Path.GetFileName(targetFile)} stimmt nicht (erwartet {expected}, erhalten {actual}). Download verworfen.");
            }
        }

        File.Move(temp, targetFile, overwrite: true);
    }
}
