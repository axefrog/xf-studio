<#
.SYNOPSIS
  External capture of the game window's client area to a PNG under the project's ignored
  captures/ folder. Runs outside the game and changes nothing in it.

.DESCRIPTION
  No verified in-game screenshot API exists (see research/runtime/runtime-bridge-design.md,
  capability matrix), so the baseline capture is external: GDI CopyFromScreen of the composited
  desktop over the game's client rectangle. What it captures is exactly what is on screen after
  tone mapping, ReShade and any overlay (CET, notifications), in 8-bit sRGB. It suits framing
  checks, not colour calibration. Whether it works in the game's fullscreen mode is unverified;
  borderless windowed is the expected case.

.EXAMPLE
  pwsh -File tools/capture-window.ps1 -Name finish-board-01
#>
param(
    [Parameter(Mandatory = $true)] [ValidatePattern('^[A-Za-z0-9._-]{1,80}$')] [string] $Name,
    [string] $ProcessName = 'Cyberpunk2077'
)

$ErrorActionPreference = 'Stop'
$captureDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'captures'
New-Item -ItemType Directory -Force $captureDir | Out-Null
$outFile = Join-Path $captureDir ("{0}-{1}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Name)

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace XfCapture -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
'@
[XfCapture.Native]::SetProcessDPIAware() | Out-Null

$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $process) { Write-Host "No $ProcessName window found. Is the game running?"; exit 2 }
$hwnd = $process.MainWindowHandle
if ([XfCapture.Native]::IsIconic($hwnd)) { Write-Host 'The game window is minimised.'; exit 2 }

$rect = New-Object XfCapture.Native+RECT
[XfCapture.Native]::GetClientRect($hwnd, [ref] $rect) | Out-Null
$origin = New-Object XfCapture.Native+POINT
[XfCapture.Native]::ClientToScreen($hwnd, [ref] $origin) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { Write-Host 'The game window has no client area.'; exit 2 }

$bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($origin.X, $origin.Y, 0, 0, (New-Object System.Drawing.Size $width, $height))
    $bitmap.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
$hash = (Get-FileHash -Algorithm SHA256 $outFile).Hash.ToLowerInvariant()
Write-Host ("captured {0}x{1} pid={2} -> {3}" -f $width, $height, $process.Id, $outFile)
Write-Host "sha256 $hash"
