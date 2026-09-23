// Project-local adapter for the installed WolvenKit API. The stock CLI import command
// does not load archives, but morph import requires the base mesh's bone-name mapping.
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using WolvenKit.Common;
using WolvenKit.Common.Interfaces;
using WolvenKit.Common.Model.Arguments;
using WolvenKit.Core.Compression;
using WolvenKit.Modkit.RED4;
using WolvenKit.RED4.CR2W;

var exportOnly = args.Length == 3 && args[0] == "--export";
if (args.Length != 4 && !exportOnly) throw new ArgumentException("Expected: base-mesh.archive input.glb target.morphtarget output-base-path; or --export input.morphtarget output-base-path");
if (!Oodle.Load()) throw new Exception("WolvenKit compression library unavailable.");
ImportExportArgs.IsCLI = true;
var cli = Assembly.Load("WolvenKit.CLI");
var factory = cli.GetType("WolvenKit.CLI.GenericHost", true)!.GetMethod("CreateHostBuilder", BindingFlags.Static | BindingFlags.Public)!;
using var host = ((IHostBuilder)factory.Invoke(null, new object[] { Array.Empty<string>() })!).Build();
var archives = host.Services.GetRequiredService<IArchiveManager>();
var tools = (ModTools)host.Services.GetRequiredService<IModTools>();
var parser = host.Services.GetRequiredService<Red4ParserService>();
if (exportOnly) {
    using var source = File.OpenRead(args[1]);
    var resource = parser.ReadRed4File(source) ?? throw new Exception("Could not parse morph resource.");
    if (!tools.ExportMorphTargets(resource, new FileInfo(args[2]), true, false)) throw new Exception("Morph export failed.");
    Console.WriteLine("Read-only morph export completed.");
    return;
}
archives.LoadModArchive(Path.GetFullPath(args[0]), false);
var temporary = args[2] + ".importing";
File.Copy(args[2], temporary, true);
try {
    using (var output = new FileStream(temporary, FileMode.Open, FileAccess.ReadWrite)) {
        if (!tools.ImportMorphTargets(new FileInfo(args[1]), output, new GltfImportArgs { Keep = true, ImportFormat = GltfImportAsFormat.Morphtarget }))
            throw new Exception("Morph import failed.");
    }
    File.Move(temporary, args[2], true);
} finally {
    if (File.Exists(temporary)) File.Delete(temporary);
}
using (var input = File.OpenRead(args[2])) {
    var file = parser.ReadRed4File(input) ?? throw new Exception("Could not parse rebuilt morph resource.");
    if (!tools.ExportMorphTargets(file, new FileInfo(args[3]), true, false)) throw new Exception("Morph round-trip export failed.");
}
Console.WriteLine("Morph import and round-trip export completed.");
