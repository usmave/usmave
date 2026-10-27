using System.Diagnostics;
using System.Text;

namespace NeuralSwap.Core.Install;

public sealed record ProcessResult(int ExitCode, string Output, bool TimedOut);

/// <summary>Startet externe Werkzeuge unsichtbar und liefert ihre Ausgabe – auf Wunsch zeilenweise live.</summary>
public interface IProcessRunner
{
    Task<ProcessResult> RunAsync(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout,
        Action<string>? onLine = null, CancellationToken ct = default);
}

public sealed class ProcessRunner : IProcessRunner
{
    public async Task<ProcessResult> RunAsync(string fileName, IReadOnlyList<string> arguments, TimeSpan timeout,
        Action<string>? onLine = null, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo(fileName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in arguments) psi.ArgumentList.Add(arg);

        using var process = new Process { StartInfo = psi };
        var output = new StringBuilder();
        void Collect(string? data)
        {
            if (data == null) return;
            lock (output) output.AppendLine(data);
            onLine?.Invoke(data);
        }
        process.OutputDataReceived += (_, e) => Collect(e.Data);
        process.ErrorDataReceived += (_, e) => Collect(e.Data);

        if (!process.Start())
            return new ProcessResult(-1, $"{fileName} konnte nicht gestartet werden.", false);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            lock (output) return new ProcessResult(-1, output.ToString(), TimedOut: !ct.IsCancellationRequested);
        }

        process.WaitForExit(); // restliche Ausgabe einsammeln
        lock (output) return new ProcessResult(process.ExitCode, output.ToString().Trim(), false);
    }
}
