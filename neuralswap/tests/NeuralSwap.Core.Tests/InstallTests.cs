using System.IO.Compression;
using NeuralSwap.Core.Install;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.OptiScaler;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class InstallTrackerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));
    private string Game => Path.Combine(_root, "game");
    private string State => Path.Combine(_root, "state");

    public InstallTrackerTests()
    {
        Directory.CreateDirectory(Game);
        File.WriteAllText(Path.Combine(Game, "ReShade.ini"), "[GENERAL]\nPresetPath=.\\mine.ini\n");
        File.WriteAllText(Path.Combine(Game, "user.cfg"), "keep me");
        File.WriteAllBytes(Path.Combine(Game, "Game.exe"), new byte[100]);
    }

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void UndoRestoresOriginalStateExactly()
    {
        var tracker = new InstallTracker(Game, "test", State);
        var session = tracker.Begin("reshade-shaders");

        // Was ein Installer typischerweise tut:
        File.WriteAllText(Path.Combine(Game, "dxgi.dll"), "reshade");                      // neu
        File.AppendAllText(Path.Combine(Game, "ReShade.ini"), "[RenoDX.DLSS5]\nX=1\n");    // geändert
        File.Delete(Path.Combine(Game, "user.cfg"));                                       // gelöscht
        Directory.CreateDirectory(Path.Combine(Game, "reshade-shaders", "Shaders", "include"));
        File.WriteAllText(Path.Combine(Game, "reshade-shaders", "Shaders", "include", "a.fxh"), "x");
        Directory.CreateDirectory(Path.Combine(Game, "Licenses"));
        File.WriteAllText(Path.Combine(Game, "Licenses", "LICENSE.txt"), "MIT");

        var record = tracker.Diff(session);
        tracker.Save(record);
        Assert.True(tracker.IsInstalled);

        var problems = tracker.Undo(tracker.Load()!);

        Assert.Empty(problems);
        Assert.False(File.Exists(Path.Combine(Game, "dxgi.dll")));
        Assert.Equal("[GENERAL]\nPresetPath=.\\mine.ini\n", File.ReadAllText(Path.Combine(Game, "ReShade.ini")));
        Assert.Equal("keep me", File.ReadAllText(Path.Combine(Game, "user.cfg")));
        Assert.False(Directory.Exists(Path.Combine(Game, "reshade-shaders")));
        Assert.False(Directory.Exists(Path.Combine(Game, "Licenses")));
        Assert.True(File.Exists(Path.Combine(Game, "Game.exe")));
        Assert.False(tracker.IsInstalled);
    }

    [Fact]
    public void UndoKeepsFilesTheUserAddedLaterToCreatedFolders()
    {
        var tracker = new InstallTracker(Game, "test", State);
        var session = tracker.Begin("reshade-shaders");
        Directory.CreateDirectory(Path.Combine(Game, "reshade-shaders", "Shaders"));
        File.WriteAllText(Path.Combine(Game, "reshade-shaders", "Shaders", "ours.fx"), "x");
        tracker.Save(tracker.Diff(session));

        File.WriteAllText(Path.Combine(Game, "reshade-shaders", "Shaders", "mine.fx"), "user");
        tracker.Undo(tracker.Load()!);

        Assert.False(File.Exists(Path.Combine(Game, "reshade-shaders", "Shaders", "ours.fx")));
        Assert.True(File.Exists(Path.Combine(Game, "reshade-shaders", "Shaders", "mine.fx")));
    }

    [Fact]
    public void DetectsSameSizeContentChange()
    {
        var tracker = new InstallTracker(Game, "test", State);
        var session = tracker.Begin();
        var ini = Path.Combine(Game, "ReShade.ini");
        var original = File.ReadAllText(ini);
        var stamp = File.GetLastWriteTimeUtc(ini);
        File.WriteAllText(ini, original.Replace("mine", "MINE"));  // gleiche Länge
        File.SetLastWriteTimeUtc(ini, stamp);                       // gleiche Zeit

        var record = tracker.Diff(session);

        Assert.Contains("ReShade.ini", record.RestoreFiles.Keys);
    }

    [Fact]
    public void BeginRefusesWhileAnInstallationIsRecorded()
    {
        var tracker = new InstallTracker(Game, "test", State);
        tracker.Save(tracker.Diff(tracker.Begin()));

        Assert.Throws<InvalidOperationException>(() => tracker.Begin());
    }
}

public class OptiScalerInstallerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public OptiScalerInstallerTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void ChooseProxyNeverOverwritesExistingFiles()
    {
        File.WriteAllText(Path.Combine(_root, "dxgi.dll"), "ReShade");

        Assert.Equal("winmm.dll", OptiScalerInstaller.ChooseProxy(_root, "dxgi.dll"));
        Assert.Equal("version.dll", OptiScalerInstaller.ChooseProxy(_root, "version.dll"));
    }

    [Fact]
    public void ChooseProxyReturnsNullWhenAllTaken()
    {
        foreach (var name in OptiScalerInstaller.ProxyNames) File.WriteAllText(Path.Combine(_root, name), "x");
        Assert.Null(OptiScalerInstaller.ChooseProxy(_root, "dxgi.dll"));
    }

    [Theory]
    [InlineData("OptiScaler.dll", "")]
    [InlineData("OptiScaler_0.9.0/OptiScaler.dll", "OptiScaler_0.9.0/")]
    [InlineData("OptiScaler_0.9.0\\OptiScaler.dll", "OptiScaler_0.9.0/")]
    public void FindsArchiveRoot(string key, string expectedRoot)
    {
        Assert.Equal(expectedRoot, OptiScalerInstaller.FindArchiveRoot(new[] { "readme.txt", key }));
    }

    [Fact]
    public void ExtractIntoStripsRootAndRenamesToProxy()
    {
        var archive = Path.Combine(_root, "opti.zip");
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        {
            foreach (var (name, content) in new[]
                     {
                         ("OptiScaler_0.9.0/OptiScaler.dll", "dll"),
                         ("OptiScaler_0.9.0/OptiScaler.ini", "[DLSS]"),
                         ("OptiScaler_0.9.0/Licenses/LICENSE.txt", "MIT"),
                         ("other/ignored.txt", "x"),
                     })
            {
                using var s = new StreamWriter(zip.CreateEntry(name).Open());
                s.Write(content);
            }
        }
        var game = Path.Combine(_root, "game");
        Directory.CreateDirectory(game);

        OptiScalerInstaller.ExtractInto(archive, game, "winmm.dll");

        Assert.Equal("dll", File.ReadAllText(Path.Combine(game, "winmm.dll")));
        Assert.False(File.Exists(Path.Combine(game, "OptiScaler.dll")));
        Assert.True(File.Exists(Path.Combine(game, "OptiScaler.ini")));
        Assert.True(File.Exists(Path.Combine(game, "Licenses", "LICENSE.txt")));
        Assert.False(Directory.Exists(Path.Combine(game, "other")));
    }

    [Fact]
    public void ExtractIntoRejectsPathTraversal()
    {
        var archive = Path.Combine(_root, "evil.zip");
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        {
            using (var s = new StreamWriter(zip.CreateEntry("OptiScaler.dll").Open())) s.Write("dll");
            using (var s = new StreamWriter(zip.CreateEntry("../evil.dll").Open())) s.Write("evil");
        }
        var game = Path.Combine(_root, "game");
        Directory.CreateDirectory(game);

        Assert.Throws<InvalidOperationException>(() => OptiScalerInstaller.ExtractInto(archive, game, "dxgi.dll"));
        Assert.False(File.Exists(Path.Combine(_root, "evil.dll")));
    }
}
