using System.Text;

namespace NeuralSwap.Core.Tests;

/// <summary>Baut minimale, gültige PE-Dateien (EXE/DLL) mit Exporten und Importen für Tests.</summary>
internal static class TestPe
{
    public static byte[] Build(bool is64Bit, IEnumerable<string>? exports = null, IEnumerable<string>? imports = null,
        int minSize = 0)
    {
        var exportNames = (exports ?? Array.Empty<string>()).ToList();
        var importNames = (imports ?? Array.Empty<string>()).ToList();

        const int peOffset = 0x40;
        const int sectionRva = 0x1000;
        const int sectionFileOffset = 0x200;
        var optionalHeaderSize = is64Bit ? 112 + 16 * 8 : 96 + 16 * 8;

        // Abschnittsinhalt (RVA-relativ zu sectionRva) aufbauen.
        var section = new MemoryStream();
        var w = new BinaryWriter(section);
        int Rva() => sectionRva + (int)section.Position;

        var exportDirRva = 0;
        if (exportNames.Count > 0)
        {
            exportDirRva = Rva();
            w.Write(new byte[40]); // Export-Verzeichnis, wird unten gefüllt
            var namesArrayRva = Rva();
            w.Write(new byte[4 * exportNames.Count]);
            var nameRvas = new List<int>();
            foreach (var name in exportNames)
            {
                nameRvas.Add(Rva());
                w.Write(Encoding.ASCII.GetBytes(name));
                w.Write((byte)0);
            }
            var end = section.Position;
            section.Position = exportDirRva - sectionRva + 24;
            w.Write((uint)exportNames.Count);           // NumberOfNames
            section.Position = exportDirRva - sectionRva + 32;
            w.Write((uint)namesArrayRva);                // AddressOfNames
            section.Position = namesArrayRva - sectionRva;
            foreach (var rva in nameRvas) w.Write((uint)rva);
            section.Position = end;
        }

        var importDirRva = 0;
        if (importNames.Count > 0)
        {
            importDirRva = Rva();
            w.Write(new byte[20 * (importNames.Count + 1)]);
            var nameRvas = new List<int>();
            foreach (var name in importNames)
            {
                nameRvas.Add(Rva());
                w.Write(Encoding.ASCII.GetBytes(name));
                w.Write((byte)0);
            }
            var end = section.Position;
            for (var i = 0; i < importNames.Count; i++)
            {
                section.Position = importDirRva - sectionRva + i * 20;
                w.Write(1u);              // OriginalFirstThunk
                w.Write(0u);              // TimeDateStamp
                w.Write(0u);              // ForwarderChain
                w.Write((uint)nameRvas[i]);
                w.Write(1u);              // FirstThunk
            }
            section.Position = end;
        }

        var sectionBytes = section.ToArray();
        var rawSize = Math.Max(0x200, (sectionBytes.Length + 0x1FF) & ~0x1FF);

        var file = new MemoryStream();
        var f = new BinaryWriter(file);
        f.Write((ushort)0x5A4D);
        file.Position = 0x3C;
        f.Write(peOffset);
        file.Position = peOffset;
        f.Write(0x00004550u);
        f.Write(is64Bit ? (ushort)0x8664 : (ushort)0x014C);
        f.Write((ushort)1);               // NumberOfSections
        f.Write(0u); f.Write(0u); f.Write(0u);
        f.Write((ushort)optionalHeaderSize);
        f.Write((ushort)0x2022);

        var optionalStart = file.Position;
        f.Write(is64Bit ? (ushort)0x20B : (ushort)0x10B);
        file.Position = optionalStart + (is64Bit ? 108 : 92);
        f.Write(16u);                     // NumberOfRvaAndSizes
        f.Write((uint)exportDirRva); f.Write(exportDirRva == 0 ? 0u : 40u);
        f.Write((uint)importDirRva); f.Write(importDirRva == 0 ? 0u : (uint)(20 * (importNames.Count + 1)));
        file.Position = optionalStart + optionalHeaderSize;

        // Section header
        f.Write(Encoding.ASCII.GetBytes(".rdata\0\0"));
        f.Write((uint)rawSize);           // VirtualSize
        f.Write((uint)sectionRva);        // VirtualAddress
        f.Write((uint)rawSize);           // SizeOfRawData
        f.Write((uint)sectionFileOffset); // PointerToRawData
        f.Write(new byte[16]);

        file.Position = sectionFileOffset;
        f.Write(sectionBytes);
        file.SetLength(Math.Max(sectionFileOffset + rawSize, minSize));
        return file.ToArray();
    }

    public static void Write(string path, bool is64Bit, IEnumerable<string>? exports = null,
        IEnumerable<string>? imports = null, int minSize = 0)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, Build(is64Bit, exports, imports, minSize));
    }
}
