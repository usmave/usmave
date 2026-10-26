using NeuralSwap.Core.Models;
using NeuralSwap.Core.Scanning;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class VdfParserTests
{
    [Fact]
    public void ParsesLibraryFolders()
    {
        const string vdf = """
            "libraryfolders"
            {
                "0"
                {
                    "path"		"C:\\Program Files (x86)\\Steam"
                    "label"		""
                }
                "1"
                {
                    "path"		"D:\\SteamLibrary"
                }
            }
            """;

        var kv = VdfParser.Parse(vdf);

        Assert.Equal(@"C:\Program Files (x86)\Steam", kv["libraryfolders/0/path"]);
        Assert.Equal(@"D:\SteamLibrary", kv["libraryfolders/1/path"]);
    }

    [Fact]
    public void ParsesAppManifest()
    {
        const string acf = """
            "AppState"
            {
                "appid"		"1091500"
                "name"		"Cyberpunk 2077"
                "installdir"		"Cyberpunk 2077"
            }
            """;

        var kv = VdfParser.Parse(acf);

        Assert.Equal("Cyberpunk 2077", kv["AppState/name"]);
        Assert.Equal("Cyberpunk 2077", kv["AppState/installdir"]);
    }
}

public class SteamScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void FindsGamesAcrossLibraries()
    {
        // Steam-Wurzel mit einer zweiten Bibliothek simulieren.
        var lib2 = Path.Combine(_root, "lib2");
        var steamApps1 = Path.Combine(_root, "steamapps");
        var steamApps2 = Path.Combine(lib2, "steamapps");
        Directory.CreateDirectory(Path.Combine(steamApps1, "common", "GameA"));
        Directory.CreateDirectory(Path.Combine(steamApps2, "common", "GameB"));

        File.WriteAllText(Path.Combine(steamApps1, "libraryfolders.vdf"), $$"""
            "libraryfolders"
            {
                "0" { "path" "{{_root.Replace(@"\", @"\\")}}" }
                "1" { "path" "{{lib2.Replace(@"\", @"\\")}}" }
            }
            """);
        File.WriteAllText(Path.Combine(steamApps1, "appmanifest_1.acf"),
            """ "AppState" { "name" "Game A" "installdir" "GameA" } """);
        File.WriteAllText(Path.Combine(steamApps2, "appmanifest_2.acf"),
            """ "AppState" { "name" "Game B" "installdir" "GameB" } """);

        var games = new SteamScanner().ScanFromRoot(_root);

        Assert.Equal(2, games.Count);
        Assert.Contains(games, g => g.Name == "Game A" && g.Platform == GamePlatform.Steam);
        Assert.Contains(games, g => g.Name == "Game B");
    }
}

public class EpicScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void ReadsItemManifests()
    {
        var manifests = Path.Combine(_root, "Manifests");
        var install = Path.Combine(_root, "Games", "Alan Wake 2");
        Directory.CreateDirectory(manifests);
        Directory.CreateDirectory(install);
        File.WriteAllText(Path.Combine(manifests, "abc.item"),
            $$"""{ "DisplayName": "Alan Wake 2", "InstallLocation": {{System.Text.Json.JsonSerializer.Serialize(install)}} }""");
        File.WriteAllText(Path.Combine(manifests, "broken.item"), "{ nicht json");

        var games = new EpicScanner().ScanManifestDir(manifests);

        var game = Assert.Single(games);
        Assert.Equal("Alan Wake 2", game.Name);
        Assert.Equal(GamePlatform.Epic, game.Platform);
    }
}

public class DriveScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void FindsGamesInCommonFoldersAndSkipsIgnored()
    {
        // Simuliertes Laufwerk E:\ mit Games-, Spiele- und Epic-Ordnern.
        Directory.CreateDirectory(Path.Combine(_root, "Games", "GameC"));
        Directory.CreateDirectory(Path.Combine(_root, "Spiele", "GameD"));
        Directory.CreateDirectory(Path.Combine(_root, "Epic Games", "GameE"));
        Directory.CreateDirectory(Path.Combine(_root, "Epic Games", "Launcher")); // kein Spiel
        Directory.CreateDirectory(Path.Combine(_root, "Irgendwas", "GameF"));     // kein bekannter Ordner

        var games = new DriveScanner().ScanRoots(new[] { _root });

        Assert.Equal(3, games.Count);
        Assert.Contains(games, g => g.Name == "GameC" && g.Platform == GamePlatform.Manual);
        Assert.Contains(games, g => g.Name == "GameD");
        Assert.Contains(games, g => g.Name == "GameE");
        Assert.DoesNotContain(games, g => g.Name == "Launcher");
        Assert.DoesNotContain(games, g => g.Name == "GameF");
    }
}

public class DlssDllLocatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void FindsAllKindsInSubfolders()
    {
        var sub = Path.Combine(_root, "Engine", "Plugins");
        Directory.CreateDirectory(sub);
        File.WriteAllBytes(Path.Combine(_root, "nvngx_dlss.dll"), new byte[] { 1 });
        File.WriteAllBytes(Path.Combine(sub, "nvngx_dlssnr.dll"), new byte[] { 2 });
        File.WriteAllBytes(Path.Combine(sub, "nvngx_other.dll"), new byte[] { 3 });

        var dlls = DlssDllLocator.Locate(_root);

        Assert.Equal(2, dlls.Count);
        Assert.Contains(dlls, d => d.Kind == DlssDllKind.SuperResolution);
        Assert.Contains(dlls, d => d.Kind == DlssDllKind.NeuralRendering);
    }

    [Fact]
    public void FindsDllsInDeepUnrealEnginePaths()
    {
        // Regressionstest für Hogwarts Legacy & Co.: UE-Spiele liegen
        // 8 Ebenen tief – die alte Tiefengrenze (6) hat sie übersehen.
        var ueDir = Path.Combine(_root,
            "Engine", "Plugins", "Runtime", "Nvidia", "DLSS", "Binaries", "ThirdParty", "Win64");
        Directory.CreateDirectory(ueDir);
        File.WriteAllBytes(Path.Combine(ueDir, "nvngx_dlss.dll"), new byte[] { 1 });

        var dlls = DlssDllLocator.Locate(_root);

        var dll = Assert.Single(dlls);
        Assert.Equal(DlssDllKind.SuperResolution, dll.Kind);
    }
}
