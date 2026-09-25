# Dot-sourced by sandbox-first-run.ps1 inside Windows Sandbox. Drives the installed XF Studio
# window through Windows UI Automation, the same accessibility tree a screen reader uses, so the
# trial clicks the real controls the way a user would (no debugging port, no test hooks).
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$UIA = [System.Windows.Automation.AutomationElement]
$Scope = [System.Windows.Automation.TreeScope]

function UiRoot { $a = AppWindow; if ($a) { $UIA::FromHandle($a.MainWindowHandle) } }
# First element whose accessible name matches (-like pattern); waits up to $seconds.
function UiFind([string]$pattern, [int]$seconds = 20, [string]$type = "") {
  $end = (Get-Date).AddSeconds($seconds)
  do {
    $root = UiRoot
    if ($root) {
      $all = $root.FindAll($Scope::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($e in $all) {
        try {
          $name = $e.Current.Name
          if ($name -and $name -like $pattern -and (-not $type -or $e.Current.ControlType.ProgrammaticName -eq $type)) { return $e }
        } catch { }
      }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $end)
  return $null
}
# Keyboard press on the focused control: real input, so the page sees a user gesture
# (needed for the file chooser) and toggle buttons behave exactly as for a user.
function UiPress([string]$pattern, [string]$type = "ControlType.Button") {
  $e = UiFind $pattern 20 $type
  if (-not $e) { throw "No control named '$pattern'" }
  $app = AppWindow; if ($app) { [void]$shell.AppActivate($app.Id) }
  $e.SetFocus(); Start-Sleep -Milliseconds 300
  $shell.SendKeys("{ENTER}")
  Start-Sleep -Milliseconds 900
}
function UiInvoke([string]$pattern, [string]$type = "ControlType.Button") {
  $e = UiFind $pattern 20 $type
  if (-not $e) { throw "No control named '$pattern'" }
  $p = $null
  try {
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke() }
    elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select() }
    else { UiPress $pattern $type; return }
  } catch { UiPress $pattern $type; return }
  Start-Sleep -Milliseconds 700
}
function UiValue([string]$pattern) {
  $e = UiFind $pattern 10 "ControlType.Edit"
  if (-not $e) { throw "No field named '$pattern'" }
  $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
}
function UiSetValue([string]$pattern, [string]$value) {
  $e = UiFind $pattern 10 "ControlType.Edit"
  if (-not $e) { throw "No field named '$pattern'" }
  $e.SetFocus(); Start-Sleep -Milliseconds 200
  $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($value)
  Start-Sleep -Milliseconds 200
  $shell.SendKeys("{TAB}")   # commit the edit (change event) the way a user leaving the field does
  Start-Sleep -Milliseconds 800
}
function UiStep([string]$name, [scriptblock]$run) {
  try { $value = & $run; $report.ui[$name] = [ordered]@{ ok = $true; value = $value } }
  catch { $report.ui[$name] = [ordered]@{ ok = $false; error = $_.Exception.Message } }
  Save
}

function UiFirstRun {
  $report.ui = [ordered]@{}
  UiStep "welcome" {
    if (-not (UiFind "Start designing" 60)) { throw "The welcome did not appear" }
    Shot "01-welcome"
    UiInvoke "Start designing"
    if (UiFind "Start designing" 2) { throw "The welcome did not close" }
    "shown and dismissed"
  }
  UiStep "uvEditor" {
    $head = UiFind "*can't do that yet*" 20 "ControlType.Text"
    if (-not (UiFind "Both eyes" 10)) { throw "The UV map controls are missing" }
    Shot "02-uv-editor"
    [ordered]@{ uvControls = $true; headMessage = $(if ($head) { $head.Current.Name } else { $null }) }
  }
  UiStep "editAndUndo" {
    $before = UiValue "Colour hex value"
    UiSetValue "Colour hex value" "#123456"
    $edited = UiValue "Colour hex value"
    Shot "03-edited"
    UiInvoke "Undo"
    $after = UiValue "Colour hex value"
    if ($edited -ne "#123456" -or $after -ne $before) { throw "Edit/Undo mismatch: $before -> $edited -> $after" }
    [ordered]@{ before = $before; edited = $edited; afterUndo = $after }
  }
  UiStep "save" {
    UiInvoke "Save"
    UiInvoke "Library" "ControlType.TabItem"
    $state = UiFind "*matches library revision*" 20
    if (-not $state) { throw "The library did not report a saved revision" }
    Shot "04-saved"
    $state.Current.Name
  }
  UiStep "importFixture" {
    UiPress "Import collection*"
    # WebView2 shows the standard Windows Open dialog (owned by the app window); type the
    # fixture path into its File name box like a user would.
    $end = (Get-Date).AddSeconds(30); $dialog = $null
    $nameIs = New-Object System.Windows.Automation.PropertyCondition($UIA::NameProperty, "Open")
    while (-not $dialog -and (Get-Date) -lt $end) {
      $dialog = $UIA::RootElement.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition($nameIs,
        (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)))))
      Start-Sleep -Milliseconds 500
    }
    if (-not $dialog) { throw "No file dialog appeared" }
    $fileName = $dialog.FindFirst($Scope::Descendants, (New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition($UIA::NameProperty, "File name:")),
      (New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))))
    if ($fileName) { $fileName.SetFocus(); $fileName.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($fixture) }
    else { $shell.SendKeys($fixture) }
    Start-Sleep -Milliseconds 400
    $shell.SendKeys("{ENTER}")
    Start-Sleep -Seconds 2
    UiInvoke "Presets" "ControlType.TabItem"
    if (-not (UiFind "*Verification*collection A*" 20)) { throw "The fixture presets did not appear" }
    "four fixture presets imported"
  }
  UiStep "check" {
    UiInvoke "Package"
    UiPress "Check mod export"
    $result = UiFind "*presets can become mod files*" 60
    if (-not $result) { throw "No Check result" }
    Shot "05-check"
    $result.Current.Name
  }
  UiStep "exportCollection" {
    UiInvoke "Library" "ControlType.TabItem"
    $downloads = Join-Path $env:USERPROFILE "Downloads"
    $before = @(Get-ChildItem $downloads -File -ErrorAction SilentlyContinue).Count
    UiPress "Export collection"
    $end = (Get-Date).AddSeconds(30); $file = $null
    while (-not $file -and (Get-Date) -lt $end) {
      $file = Get-ChildItem $downloads -File -Filter *.json -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
      if ($file -and @(Get-ChildItem $downloads -File).Count -le $before) { $file = $null }
      Start-Sleep -Milliseconds 500
    }
    if (-not $file) { throw "No exported collection arrived in Downloads" }
    [ordered]@{ file = $file.Name; bytes = $file.Length }
  }
  UiStep "aboutAndLicences" {
    UiInvoke "About XF Studio"
    Start-Sleep -Seconds 1
    Shot "06-about"
    UiInvoke "Licences"
    if (-not (UiFind "*Permission is hereby granted*" 15)) { throw "The XF Studio licence text did not load" }
    UiPress "Third-party notices"
    Start-Sleep -Seconds 2
    Shot "07-licences"
    if (-not (UiFind "*statically links JavaScriptCore*" 20)) { throw "The third-party notices did not load" }
    $shell.SendKeys("{ESC}"); Start-Sleep -Milliseconds 600
    "licence and notices shown"
  }
}

function UiRelaunch {
  UiStep "relaunch" {
    if (-not (UiFind "Both eyes" 60)) { throw "The editor did not open" }
    Start-Sleep -Seconds 2
    $welcome = [bool](UiFind "Start designing" 3)
    UiInvoke "Presets" "ControlType.TabItem"
    $fixturePresets = [bool](UiFind "*Verification*collection A*" 10)
    Shot "08-relaunch"
    if ($welcome -or -not $fixturePresets) { throw "Relaunch state: welcome=$welcome fixturePresets=$fixturePresets" }
    [ordered]@{ welcomeReturned = $welcome; fixturePresetsKept = $fixturePresets }
  }
}
