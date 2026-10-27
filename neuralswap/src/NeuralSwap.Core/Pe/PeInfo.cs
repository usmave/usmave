using System.Text;

namespace NeuralSwap.Core.Pe;

/// <summary>
/// Minimaler, plattformunabhängiger Leser für Windows-PE-Dateien (EXE/DLL):
/// Prozessorarchitektur, importierte DLLs und exportierte Funktionsnamen.
/// Dient z. B. dazu, ReShade-Module mit Add-on-Unterstützung zu erkennen
/// (Exporte ReShadeRegisterAddon/ReShadeUnregisterAddon) – genau wie das
/// offizielle DLSS5-Feeder-Installationsskript.
/// </summary>
public sealed class PeInfo
{
    public const ushort MachineI386 = 0x014C;
    public const ushort MachineAmd64 = 0x8664;
    public const ushort MachineArm64 = 0xAA64;

    public ushort Machine { get; private init; }
    public bool Is64Bit => Machine is MachineAmd64 or MachineArm64;
    public IReadOnlyList<string> Exports { get; private init; } = Array.Empty<string>();
    public IReadOnlyList<string> Imports { get; private init; } = Array.Empty<string>();

    private const int MaxNames = 65536;

    /// <summary>Liest die PE-Datei; null, wenn sie fehlt oder kein gültiges PE ist.</summary>
    public static PeInfo? TryRead(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return TryRead(stream);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static PeInfo? TryRead(Stream stream)
    {
        try
        {
            var reader = new BinaryReader(stream, Encoding.ASCII, leaveOpen: true);
            if (stream.Length < 0x40) return null;

            stream.Position = 0;
            if (reader.ReadUInt16() != 0x5A4D) return null; // "MZ"

            stream.Position = 0x3C;
            var peOffset = reader.ReadInt32();
            if (peOffset <= 0 || peOffset > stream.Length - 24) return null;

            stream.Position = peOffset;
            if (reader.ReadUInt32() != 0x00004550) return null; // "PE\0\0"

            var machine = reader.ReadUInt16();
            var sectionCount = reader.ReadUInt16();
            stream.Position += 12; // TimeDateStamp, PointerToSymbolTable, NumberOfSymbols
            var optionalHeaderSize = reader.ReadUInt16();
            stream.Position += 2;  // Characteristics

            var optionalHeaderStart = stream.Position;
            var magic = reader.ReadUInt16();
            int dataDirOffset, rvaCountOffset;
            switch (magic)
            {
                case 0x10B: rvaCountOffset = 92; dataDirOffset = 96; break;   // PE32
                case 0x20B: rvaCountOffset = 108; dataDirOffset = 112; break; // PE32+
                default: return null;
            }

            stream.Position = optionalHeaderStart + rvaCountOffset;
            var rvaCount = reader.ReadUInt32();

            uint exportRva = 0, importRva = 0;
            if (rvaCount > 0)
            {
                stream.Position = optionalHeaderStart + dataDirOffset;
                exportRva = reader.ReadUInt32();
                reader.ReadUInt32(); // Size
            }
            if (rvaCount > 1)
            {
                importRva = reader.ReadUInt32();
                reader.ReadUInt32(); // Size
            }

            var sections = new List<(uint Va, uint VirtualSize, uint RawSize, uint RawPointer)>();
            stream.Position = optionalHeaderStart + optionalHeaderSize;
            for (var i = 0; i < sectionCount; i++)
            {
                stream.Position += 8; // Name
                var virtualSize = reader.ReadUInt32();
                var va = reader.ReadUInt32();
                var rawSize = reader.ReadUInt32();
                var rawPointer = reader.ReadUInt32();
                stream.Position += 16; // Rest des Section-Headers
                sections.Add((va, virtualSize, rawSize, rawPointer));
            }

            long? ToOffset(uint rva)
            {
                foreach (var s in sections)
                {
                    var size = Math.Max(s.VirtualSize, s.RawSize);
                    if (rva >= s.Va && rva < s.Va + size)
                    {
                        var offset = (long)rva - s.Va + s.RawPointer;
                        return offset < stream.Length ? offset : null;
                    }
                }
                return null;
            }

            string? ReadAsciiZ(uint rva)
            {
                var offset = ToOffset(rva);
                if (offset == null) return null;
                stream.Position = offset.Value;
                var sb = new StringBuilder();
                int b;
                while ((b = stream.ReadByte()) > 0 && sb.Length < 512) sb.Append((char)b);
                return sb.ToString();
            }

            var exports = new List<string>();
            if (exportRva != 0 && ToOffset(exportRva) is { } exportOffset)
            {
                stream.Position = exportOffset + 24;
                var nameCount = reader.ReadUInt32();
                stream.Position = exportOffset + 32;
                var namesRva = reader.ReadUInt32();
                if (nameCount <= MaxNames && ToOffset(namesRva) is { } namesOffset)
                {
                    var nameRvas = new uint[nameCount];
                    stream.Position = namesOffset;
                    for (var i = 0; i < nameCount; i++) nameRvas[i] = reader.ReadUInt32();
                    foreach (var rva in nameRvas)
                        if (ReadAsciiZ(rva) is { Length: > 0 } name) exports.Add(name);
                }
            }

            var imports = new List<string>();
            if (importRva != 0 && ToOffset(importRva) is { } importOffset)
            {
                for (var i = 0; i < 4096; i++)
                {
                    stream.Position = importOffset + i * 20L;
                    var originalFirstThunk = reader.ReadUInt32();
                    stream.Position += 8;
                    var nameRva = reader.ReadUInt32();
                    var firstThunk = reader.ReadUInt32();
                    if (originalFirstThunk == 0 && nameRva == 0 && firstThunk == 0) break;
                    if (ReadAsciiZ(nameRva) is { Length: > 0 } name) imports.Add(name);
                }
            }

            return new PeInfo { Machine = machine, Exports = exports, Imports = imports };
        }
        catch (EndOfStreamException)
        {
            return null;
        }
    }
}
