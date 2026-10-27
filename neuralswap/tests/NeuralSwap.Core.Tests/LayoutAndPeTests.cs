using NeuralSwap.Core.Models;
using NeuralSwap.Core.Pe;
using NeuralSwap.Core.Scanning;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class PeInfoTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public PeInfoTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void ReadsMachineExportsAndImports64()
    {
        var path = Path.Combine(_root, "ReShade64.dll");
        TestPe.Write(path, is64Bit: true,
            exports: new[] { "ReShadeRegisterAddon", "ReShadeUnregisterAddon" },
            imports: new[] { "KERNEL32.dll", "d3d12.dll" });

        var pe = PeInfo.TryRead(path)!;

        Assert.True(pe.Is64Bit);
        Assert.Equal(new[] { "ReShadeRegisterAddon", "ReShadeUnregisterAddon" }, pe.Exports);
        Assert.Equal(new[] { "KERNEL32.dll", "d3d12.dll" }, pe.Imports);
    }

    [Fact]
    public void Reads32BitPe()
    {
        var path = Path.Combine(_root, "game.exe");
        TestPe.Write(path, is64Bit: false, imports: new[] { "d3d9.dll" });

        var pe = PeInfo.TryRead(path)!;

        Assert.False(pe.Is64Bit);
        Assert.Empty(pe.Exports);
        Assert.Equal(new[] { "d3d9.dll" }, pe.Imports);
    }

    [Fact]
    public void RejectsNonPeAndTruncatedFiles()
    {
        var html = Path.Combine(_root, "download.exe");
        File.WriteAllText(html, "<!DOCTYPE html><html>Error 500</html>");
        var truncated = Path.Combine(_root, "trunc.dll");
        File.WriteAllBytes(truncated, TestPe.Build(true, new[] { "X" }).Take(0x60).ToArray());

        Assert.Null(PeInfo.TryRead(html));
        Assert.Null(PeInfo.TryRead(truncated));
        Assert.Null(PeInfo.TryRead(Path.Combine(_root, "missing.dll")));
    }
}

public class GameExeLocatorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private string Touch(string relative, int size = 1)
    {
        var path = Path.Combine(_root, relative.Replace('\\', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, new byte[size]);
        return path;
    }

    [Fact]
    public void UnrealSteamLayoutPicksShippingExeNotStarterOrPluginDir()
    {
        // Aufbau wie Hogwarts Legacy: kleiner Starter oben, echte EXE unter Phoenix\Binaries\Win64,
        // DLSS-DLL tief im Engine-Plugin-Ordner, CrashReportClient unter Engine\Binaries.
        Touch("HogwartsLegacy.exe", 300_000);
        var shipping = Touch(@"Phoenix\Binaries\Win64\HogwartsLegacy.exe", 2_000_000);
        Touch(@"Engine\Binaries\Win64\CrashReportClient.exe", 5_000_000);
        var dll = Touch(@"Engine\Plugins\Runtime\Nvidia\DLSS\Binaries\ThirdParty\Win64\nvngx_dlss.dll");

        Assert.Equal(shipping, GameExeLocator.FindMainExe(_root, new[] { dll }));
    }

    [Fact]
    public void UnrealGamePassLayoutPicksWinGdkExe()
    {
        Touch("gamelaunchhelper.exe", 400_000);
        Touch("Phoenix.exe", 300_000);
        var shipping = Touch(@"Phoenix\Binaries\WinGDK\Phoenix-WinGDK-Shipping.exe", 1_500_000);

        Assert.Equal(shipping, GameExeLocator.FindMainExe(_root, Array.Empty<string>()));
    }

    [Fact]
    public void NonUnrealPrefersExeBesideDlssDll()
    {
        // Aufbau wie Cyberpunk 2077: bin\x64\Cyberpunk2077.exe neben nvngx_dlss.dll;
        // ein größerer Launcher im Hauptordner darf nicht gewinnen.
        Touch("REDprelauncher.exe", 9_000_000);
        var game = Touch(@"bin\x64\Cyberpunk2077.exe", 3_000_000);
        var dll = Touch(@"bin\x64\nvngx_dlss.dll");

        Assert.Equal(game, GameExeLocator.FindMainExe(_root, new[] { dll }));
    }

    [Fact]
    public void SkipsCrashHandlersRedistsAndPenalizesLaunchers()
    {
        Touch("UnityCrashHandler64.exe", 9_000_000);
        Touch(@"_CommonRedist\vcredist\vc_redist.x64.exe", 9_000_000);
        Touch("GameLauncher.exe", 5_000_000);
        var game = Touch("Game.exe", 1_000_000);

        Assert.Equal(game, GameExeLocator.FindMainExe(_root, Array.Empty<string>()));
    }

    [Fact]
    public void DetectsStreamlineInSubfolder()
    {
        Touch("TheGreatCircle.exe", 1_000_000);
        Touch(@"streamline\sl.interposer.dll");

        Assert.True(GameExeLocator.HasStreamline(_root));
    }

    [Fact]
    public void ModDirFallsBackToInstallDir()
    {
        Directory.CreateDirectory(_root);
        var game = new Game { Name = "x", InstallDir = _root, Platform = GamePlatform.Manual };

        GameExeLocator.Inspect(game);

        Assert.Null(game.MainExe);
        Assert.Equal(_root, game.ModDir);
        Assert.False(game.UsesStreamline);
    }
}

public class GameMergeTests
{
    private static Game G(string dir, bool auto = false, GamePlatform p = GamePlatform.Manual) =>
        new() { Name = Path.GetFileName(dir), InstallDir = dir, Platform = p, AutoDetected = auto };

    [Fact]
    public void DropsAutoDetectedFolderThatContainsOtherGames()
    {
        var root = Path.Combine(Path.GetTempPath(), "E");
        var games = new[]
        {
            G(Path.Combine(root, "Games", "SteamLibrary"), auto: true),
            G(Path.Combine(root, "Games", "SteamLibrary", "steamapps", "common", "Hogwarts Legacy"), p: GamePlatform.Steam),
            G(Path.Combine(root, "Games", "Witcher 3"), auto: true),
        };

        var merged = GameScanner.Merge(games);

        Assert.DoesNotContain(merged, g => g.Name == "SteamLibrary");
        Assert.Contains(merged, g => g.Name == "Hogwarts Legacy");
        Assert.Contains(merged, g => g.Name == "Witcher 3");
    }

    [Fact]
    public void KeepsExplicitManualFolderAndPrefersLauncherEntryForDuplicates()
    {
        var root = Path.Combine(Path.GetTempPath(), "E");
        var dir = Path.Combine(root, "Games", "Metro Exodus");
        var games = new[]
        {
            G(dir, auto: true),
            G(dir, p: GamePlatform.Steam),
            G(Path.Combine(root, "MeineSpiele")),
            G(Path.Combine(root, "MeineSpiele", "Spiel1"), p: GamePlatform.Epic),
        };

        var merged = GameScanner.Merge(games);

        Assert.Single(merged, g => g.InstallDir == dir);
        Assert.Equal(GamePlatform.Steam, merged.Single(g => g.InstallDir == dir).Platform);
        Assert.Contains(merged, g => g.Name == "MeineSpiele"); // vom Nutzer hinzugefügt → bleibt
    }
}

public class DriveScannerSteamLibraryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void SkipsSteamLibraryFoldersAndMarksAutoDetected()
    {
        Directory.CreateDirectory(Path.Combine(_root, "Games", "SteamLibrary", "steamapps"));
        Directory.CreateDirectory(Path.Combine(_root, "Games", "Alan Wake 2"));

        var games = new DriveScanner().ScanRoots(new[] { _root });

        var game = Assert.Single(games);
        Assert.Equal("Alan Wake 2", game.Name);
        Assert.True(game.AutoDetected);
    }
}
