using System.Text.Json;
using NeuralSwap.Core.Library;
using NeuralSwap.Core.NeuralRendering;
using NeuralSwap.Core.Presets;
using Xunit;

namespace NeuralSwap.Core.Tests;

public class NeuralRenderingConfigTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "nstest_" + Guid.NewGuid().ToString("N"));

    public NeuralRenderingConfigTests() => Directory.CreateDirectory(_root);
    public void Dispose() { try { Directory.Delete(_root, true); } catch { } }

    [Fact]
    public void RouteAWritesRenoDxSection()
    {
        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: true, new NrOptions { WorkingScalePercent = 75 });

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("1", ini.Get("RenoDX.DLSS5", "NRHookPoint"));
        Assert.Equal("1", ini.Get("RenoDX.DLSS5", "NRPasses"));
        Assert.Equal("2", ini.Get("RenoDX.DLSS5", "NRDetailStability"));
    }

    [Fact]
    public void RouteBMergesPreprocessorDefinitionsAndWritesFeedConfig()
    {
        File.WriteAllLines(Path.Combine(_root, "ReShade.ini"),
            new[] { "[GENERAL]", "PreprocessorDefinitions=FOO=1" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: false, new NrOptions { WorkingScalePercent = 50 });

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("FOO=1,DLSS5_MV_PROVIDER=3", ini.Get("GENERAL", "PreprocessorDefinitions"));

        var cfg = File.ReadAllLines(Path.Combine(_root, "dlss5-feed.cfg"));
        Assert.Contains("work_resolution=0.5", cfg);

        var preset = File.ReadAllText(Path.Combine(_root, "ReShadePreset.ini"));
        Assert.Contains("Lumenite_Kernel", preset);
        Assert.Contains("DLSS5_Feed", preset);
    }

    [Fact]
    public void RouteBDoesNotDuplicateProviderOrTechniques()
    {
        File.WriteAllLines(Path.Combine(_root, "ReShade.ini"),
            new[] { "[GENERAL]", "PreprocessorDefinitions=DLSS5_MV_PROVIDER=3" });
        File.WriteAllLines(Path.Combine(_root, "ReShadePreset.ini"),
            new[] { "Techniques=Lumenite_Kernel,DLSS5_Feed" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: false, new NrOptions());

        var ini = IniFile.Load(Path.Combine(_root, "ReShade.ini"));
        Assert.Equal("DLSS5_MV_PROVIDER=3", ini.Get("GENERAL", "PreprocessorDefinitions"));
        var techniqueLines = File.ReadAllLines(Path.Combine(_root, "ReShadePreset.ini"))
            .Count(l => l.StartsWith("Techniques=", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(1, techniqueLines);
    }

    [Fact]
    public void SetsOptiScalerWorkingScaleWhenPresent()
    {
        File.WriteAllLines(Path.Combine(_root, "OptiScaler.ini"), new[] { "[Upscalers]", "Dx12Upscaler=auto" });

        NeuralRenderingInstaller.ApplyConfigs(_root, routeA: true, new NrOptions { WorkingScalePercent = 100 });

        Assert.Equal("1.0", IniFile.Load(Path.Combine(_root, "OptiScaler.ini")).Get("DlssNr", "WorkingScale"));
    }

    [Fact]
    public void UninstallRemovesRecordedFiles()
    {
        var addon = Path.Combine(_root, "dlss5-feed.addon64");
        File.WriteAllBytes(addon, new byte[] { 1 });
        File.WriteAllText(Path.Combine(_root, NeuralRenderingInstaller.StateFileName),
            JsonSerializer.Serialize(new[] { addon }));

        Assert.True(NeuralRenderingInstaller.IsInstalled(_root));
        var result = NeuralRenderingInstaller.Uninstall(_root);

        Assert.True(result.Success, result.Message);
        Assert.False(File.Exists(addon));
        Assert.False(NeuralRenderingInstaller.IsInstalled(_root));
    }

    [Fact]
    public void ManifestParsesNeuralRenderingSources()
    {
        var manifest = VersionManifest.Parse("""
            { "neuralRendering": { "feederRepo": "foo/bar", "lumeniteBranch": "dev" } }
            """);

        Assert.Equal("foo/bar", manifest.NeuralRendering.FeederRepo);
        Assert.Equal("dev", manifest.NeuralRendering.LumeniteBranch);
        Assert.Equal("crosire/reshade-shaders", manifest.NeuralRendering.ShadersRepo);
    }
}
