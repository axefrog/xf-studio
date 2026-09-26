<#
.SYNOPSIS
  Test helper: opens a borderless window with an exact client size and a known pixel pattern,
  prints "HWND=<n>" and stays open for -Seconds. Used by capture.test.ts to check capture,
  crop and downscale without the game. It never takes focus.

  Pattern (client coordinates):
    background            RGB(40, 40, 40)
    red block             x 100..299, y 50..149         RGB(255, 0, 0)
    checkerboard          x 400..655, y 100..355        1-px black/white squares
    blue block            100x100 centred on the window RGB(0, 0, 255)
    green corner          last 10x10 pixels             RGB(0, 255, 0)
#>
param(
    [Parameter(Mandatory = $true)] [int] $Width,
    [Parameter(Mandatory = $true)] [int] $Height,
    [int] $X = -9000,
    [int] $Y = 0,
    [int] $Seconds = 30,
    [switch] $TopMost
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Drawing.Primitives, System.Drawing.Common, System.ComponentModel.Primitives, System.Windows.Forms.Primitives -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
public class XfbSyntheticForm : Form {
    private readonly Bitmap image;
    public XfbSyntheticForm(Bitmap image) {
        this.image = image;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        DoubleBuffered = true;
        AutoScaleMode = AutoScaleMode.None;
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void OnPaint(PaintEventArgs e) { e.Graphics.DrawImageUnscaled(image, 0, 0); }
    protected override void OnPaintBackground(PaintEventArgs e) { }
}
'@
[System.Windows.Forms.Application]::SetHighDpiMode([System.Windows.Forms.HighDpiMode]::PerMonitorV2) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppRgb)
$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.Clear([System.Drawing.Color]::FromArgb(40, 40, 40))
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 0))), 100, 50, 200, 100)
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 0, 255))), [int]($Width / 2) - 50, [int]($Height / 2) - 50, 100, 100)
$g.Dispose()
for ($yy = 0; $yy -lt [Math]::Min(256, $Height - 100); $yy++) {
    for ($xx = 0; $xx -lt [Math]::Min(256, $Width - 400); $xx++) {
        $c = if ((($xx + $yy) % 2) -eq 0) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
        $bitmap.SetPixel(400 + $xx, 100 + $yy, $c)
    }
}

$g = [System.Drawing.Graphics]::FromImage($bitmap)
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 255, 0))), $Width - 10, $Height - 10, 10, 10)
$g.Dispose()

$form = New-Object XfbSyntheticForm $bitmap
$form.Text = "xfb-synthetic-${Width}x${Height}"
$form.Location = New-Object System.Drawing.Point $X, $Y
$form.ClientSize = New-Object System.Drawing.Size $Width, $Height
$form.TopMost = [bool]$TopMost
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1, $Seconds) * 1000
$timer.add_Tick({ $form.Close() })
$form.add_Shown({
    $timer.Start()
    [Console]::Out.WriteLine("HWND=$($form.Handle.ToInt64()) CLIENT=$($form.ClientSize.Width)x$($form.ClientSize.Height)")
    [Console]::Out.Flush()
})
[System.Windows.Forms.Application]::Run($form)
