<#
  Generates src/native/write/writer-classes.json: for every class of the native reader's RTTI slice (and the structs its properties
  hold), the property list in WolvenKit's write order with each property's RED type, whether the class writes its default properties
  too (`SerializeDefault`), and the class's default instance as WolvenKit's JSON. The native CR2W writer leaves a property out exactly
  when WolvenKit would: when it equals this default.

  The facts come from WolvenKit's generated classes (generated from the game's RTTI), read by reflection from a local WolvenKit CLI's
  WolvenKit.RED4.dll and serialized with its own JSON serializer. Nothing of WolvenKit is copied into the Studio; the table holds names,
  types, order and default values only. Needs PowerShell 7 (it runs on .NET, which loads WolvenKit's assemblies).

    pwsh tools/native-writer-classes.ps1 -WolvenKit PATH_TO\WolvenKit.CLI.exe
#>
param([Parameter(Mandatory = $true)][string]$WolvenKit)
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $WolvenKit
Get-ChildItem $dir -Filter *.dll | ForEach-Object { try { [void][Reflection.Assembly]::LoadFrom($_.FullName) } catch {} }
$red = [Reflection.Assembly]::LoadFrom((Join-Path $dir 'WolvenKit.RED4.dll'))
$common = [Reflection.Assembly]::LoadFrom((Join-Path $dir 'WolvenKit.Common.dll'))
$reflection = $red.GetType('WolvenKit.RED4.Types.RedReflection')
$serializer = $common.GetType('WolvenKit.RED4.CR2W.JSON.RedJsonSerializer')
$options = [Activator]::CreateInstance($common.GetType('WolvenKit.RED4.CR2W.JSON.RedJsonSerializerOptions'))
$types = $reflection.GetMethod('GetTypes').Invoke($null, @())
$typeInfo = $reflection.GetMethod('GetTypeInfo', [Type[]]@([Type]))
$redType = $reflection.GetMethod('GetRedTypeFromCSType')
$version = (Get-Item $WolvenKit).VersionInfo.ProductVersion

$authoring = Split-Path -Parent $PSScriptRoot
$subset = Get-Content (Join-Path $authoring 'src/native/rtti-subset.json') -Raw | ConvertFrom-Json -AsHashtable
$queue = [System.Collections.Generic.Queue[string]]::new()
foreach ($name in $subset.classes.Keys) { $queue.Enqueue($name) }
$classes = [ordered]@{}
$missing = @()
while ($queue.Count) {
  $name = $queue.Dequeue()
  if ($classes.Contains($name)) { continue }
  if (-not $types.ContainsKey($name)) { $missing += $name; continue }
  $type = $types[$name]
  if ($type.IsAbstract) { $classes[$name] = $null }
  $info = $typeInfo.Invoke($null, @($type))
  $props = @()
  foreach ($p in $info.PropertyInfos) {
    if ($p.IsIgnored -or $p.IsDynamic) { continue }
    $t = $redType.Invoke($null, @($p.Type, $p.Flags))
    $props += , @($p.RedName, $t)
    # Structs held by value are written by their own properties: include them.
    $bare = $t -replace '^(array:|static:\d+,)+', ''
    if ($bare -notmatch '^(w?handle|ra?Ref):' -and $types.ContainsKey($bare)) { $queue.Enqueue($bare) }
  }
  $entry = [ordered]@{ sd = [int]$info.SerializeDefault; props = $props }
  if (-not $type.IsAbstract) {
    $instance = [Activator]::CreateInstance($type)
    $entry.defaults = $serializer.GetMethod('Serialize').Invoke($null, @($instance, $options)) | ConvertFrom-Json -AsHashtable
  }
  $classes[$name] = $entry
}
$out = [ordered]@{
  source = "WolvenKit CLI $version, WolvenKit.RED4.dll generated classes (from the game's RTTI), read by reflection; tools/native-writer-classes.ps1"
  classes = $classes
}
$target = Join-Path $authoring 'src/native/write/writer-classes.json'
$out | ConvertTo-Json -Depth 64 -Compress | Set-Content -Path $target -Encoding utf8NoBOM
"Wrote $($classes.Count) classes to $target; not in WolvenKit: $($missing -join ', ')"
