using NeuralSwap.Core;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.Models;
using NeuralSwap.Core.Swapping;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class DllSwapperTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public DllSwapperTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    private InstalledDll MakeTarget(byte[] content)
    {
        var path = Path.Combine(_root, "nvngx_dlssnr.dll");
        File.WriteAllBytes(path, content);
        return new InstalledDll { Kind = DlssDllKind.NeuralRendering, Path = path };
    }

    [Fact]
    public void SwapCreatesBackupAndReplaces()
    {
        var target = MakeTarget(new byte[] { 1, 1, 1 });
        var source = Path.Combine(_root, "new.dll");
        File.WriteAllBytes(source, new byte[] { 2, 2 });

        var result = DllSwapper.Swap(target, source);

        Assert.True(result.Success, result.Message);
        Assert.Equal(new byte[] { 2, 2 }, File.ReadAllBytes(target.Path));
        Assert.True(File.Exists(DllSwapper.BackupPath(target.Path)));
        Assert.Equal(new byte[] { 1, 1, 1 }, File.ReadAllBytes(DllSwapper.BackupPath(target.Path)));
        Assert.True(target.HasBackup);
    }

    [Fact]
    public void SecondSwapKeepsOriginalBackup()
    {
        var target = MakeTarget(new byte[] { 1 });
        var source2 = Path.Combine(_root, "v2.dll");
        var source3 = Path.Combine(_root, "v3.dll");
        File.WriteAllBytes(source2, new byte[] { 2 });
        File.WriteAllBytes(source3, new byte[] { 3 });

        DllSwapper.Swap(target, source2);
        DllSwapper.Swap(target, source3);

        Assert.Equal(new byte[] { 1 }, File.ReadAllBytes(DllSwapper.BackupPath(target.Path)));
        Assert.Equal(new byte[] { 3 }, File.ReadAllBytes(target.Path));
    }

    [Fact]
    public void RestoreBringsBackOriginal()
    {
        var target = MakeTarget(new byte[] { 1 });
        var source = Path.Combine(_root, "v2.dll");
        File.WriteAllBytes(source, new byte[] { 2 });
        DllSwapper.Swap(target, source);

        var result = DllSwapper.Restore(target);

        Assert.True(result.Success, result.Message);
        Assert.Equal(new byte[] { 1 }, File.ReadAllBytes(target.Path));
        Assert.False(File.Exists(DllSwapper.BackupPath(target.Path)));
        Assert.False(target.HasBackup);
    }

    [Fact]
    public void RestoreWithoutBackupFails()
    {
        var target = MakeTarget(new byte[] { 1 });
        Assert.False(DllSwapper.Restore(target).Success);
    }
}

public class DllLibraryTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void ImportRejectsUnknownFileNames()
    {
        var library = new DllLibrary(_root);
        var file = Path.Combine(_root, "irgendwas.dll");
        File.WriteAllBytes(file, new byte[] { 1 });

        Assert.Throws<ArgumentException>(() => library.Import(file));
    }

    [Fact]
    public void ImportRejectsWrongHash()
    {
        var library = new DllLibrary(_root);
        var file = Path.Combine(_root, "nvngx_dlss.dll");
        File.WriteAllBytes(file, new byte[] { 1 });

        Assert.Throws<InvalidOperationException>(() => library.Import(file, new string('0', 64)));
    }

    [Fact]
    public void ImportAcceptsCorrectHashAndListsEntry()
    {
        var library = new DllLibrary(Path.Combine(_root, "lib"));
        var file = Path.Combine(_root, "nvngx_dlss.dll");
        File.WriteAllBytes(file, new byte[] { 1, 2, 3 });

        var entry = library.Import(file, DllLibrary.Sha256Of(file));

        Assert.Equal(DlssDllKind.SuperResolution, entry.Kind);
        Assert.Single(library.List());
        Assert.Equal(entry.Path, library.Latest(DlssDllKind.SuperResolution)!.Path);
    }

    [Theory]
    [InlineData("310.9.16.0", "310.8.0.0", true)]
    [InlineData("310.10.0.0", "310.9.16.0", true)]
    [InlineData("3.17.20", "310.9.16.0", false)]
    public void ParseVersionOrdersNumerically(string a, string b, bool aNewer)
    {
        var cmp = DllLibrary.ParseVersion(a).CompareTo(DllLibrary.ParseVersion(b));
        Assert.Equal(aNewer, cmp > 0);
    }
}

public class OneClickServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public OneClickServiceTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void UpdateGameSwapsFromLibrary()
    {
        var gameDir = Path.Combine(_root, "game");
        Directory.CreateDirectory(gameDir);
        var dllPath = Path.Combine(gameDir, "nvngx_dlssnr.dll");
        File.WriteAllBytes(dllPath, new byte[] { 1 });

        var library = new DllLibrary(Path.Combine(_root, "lib"));
        var import = Path.Combine(_root, "nvngx_dlssnr.dll");
        File.WriteAllBytes(import, new byte[] { 9, 9 });
        library.Import(import);

        var game = new Game { Name = "Test", InstallDir = gameDir, Platform = GamePlatform.Manual };
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.NeuralRendering, Path = dllPath });

        var result = new OneClickService(library).UpdateGame(game);

        var swap = Assert.Single(result.Swaps);
        Assert.True(swap.Success, swap.Message);
        Assert.Equal(new byte[] { 9, 9 }, File.ReadAllBytes(dllPath));
    }

    [Fact]
    public void UpdateAllSkipsXboxGames()
    {
        var library = new DllLibrary(Path.Combine(_root, "lib"));
        var game = new Game { Name = "GamePassTitel", InstallDir = _root, Platform = GamePlatform.Xbox };
        game.Dlls.Add(new InstalledDll { Kind = DlssDllKind.SuperResolution, Path = Path.Combine(_root, "x.dll") });

        var results = new OneClickService(library).UpdateAll(new[] { game });

        Assert.Empty(results);
    }
}
