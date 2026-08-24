# Block DaVinci Resolve from internet / update checks.
# Requires Administrator. Safe to re-run. Local LAN panel traffic is not opened here.
# Undo: .\block_resolve_internet.ps1 -Undo

param(
    [switch]$Undo
)

$ErrorActionPreference = 'Stop'
$rulePrefix = 'Block Resolve Internet - '

$targets = @(
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Resolve.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\DaVinci Resolve Welcome.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Blackmagic Remote Monitor.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\OFXLoader.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Electron\electron.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\bootstrap.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\bootstrapc.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\ograf-cef-host.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\Resolve Web Helper.exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\Resolve Web Helper (Alerts).exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\Resolve Web Helper (GPU).exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\Resolve Web Helper (Plugin).exe',
    'C:\Program Files\Blackmagic Design\DaVinci Resolve\Plugins\ChromiumEmbeddedFramework\Resolve Web Helper (Renderer).exe'
)

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw 'This script must be run as Administrator.'
    }
}

function Remove-OurRules {
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like ($rulePrefix + '*') } |
        ForEach-Object {
            Write-Output ("Removing " + $_.DisplayName)
            Remove-NetFirewallRule -Name $_.Name
        }
}

function Add-HostBlocks {
    $hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
    $markerStart = '# BEGIN block-resolve-internet'
    $markerEnd = '# END block-resolve-internet'
    $block = @(
        $markerStart
        '0.0.0.0 blackmagicdesign.com'
        '0.0.0.0 www.blackmagicdesign.com'
        '0.0.0.0 updates.blackmagicdesign.com'
        '0.0.0.0 software.blackmagicdesign.com'
        '0.0.0.0 store.blackmagicdesign.com'
        '0.0.0.0 documents.blackmagicdesign.com'
        '0.0.0.0 forum.blackmagicdesign.com'
        '0.0.0.0 support.blackmagicdesign.com'
        $markerEnd
    )
    $raw = Get-Content -LiteralPath $hostsPath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $raw) { $raw = '' }
    if ($raw -match [regex]::Escape($markerStart)) {
        $raw = [regex]::Replace($raw, "(?s)\r?\n?" + [regex]::Escape($markerStart) + ".*?" + [regex]::Escape($markerEnd) + "\r?\n?", "`r`n")
    }
    if (-not $Undo) {
        $raw = $raw.TrimEnd() + "`r`n`r`n" + ($block -join "`r`n") + "`r`n"
    }
    Set-Content -LiteralPath $hostsPath -Value $raw.TrimEnd() -Encoding ASCII
    ipconfig /flushdns | Out-Null
    Write-Output 'Updated hosts file and flushed DNS.'
}

Assert-Admin
Remove-OurRules

if ($Undo) {
    Add-HostBlocks
    Write-Output 'Removed Resolve internet blocks.'
    exit 0
}

foreach ($exe in $targets) {
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Output ("Skip missing: " + $exe)
        continue
    }
    $name = $rulePrefix + [IO.Path]::GetFileName($exe)
    New-NetFirewallRule `
        -DisplayName $name `
        -Direction Outbound `
        -Action Block `
        -Enabled True `
        -Profile Any `
        -Program $exe `
        -Protocol Any `
        -Description 'Prevent DaVinci Resolve from accessing the internet or checking for updates.' | Out-Null
    Write-Output ("Blocked outbound: " + $exe)
}

Add-HostBlocks
Write-Output 'Done. Restart Resolve for a clean result.'
