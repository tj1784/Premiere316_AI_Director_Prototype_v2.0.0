$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$shell = New-Object -ComObject WScript.Shell
$links = @(
    @('Pictures\The Prodigal Son\Assets and Screenplay.lnk', 'public\pictures\prodigal-son'),
    @('Pictures\Moses - The Red Sea\Picture Thumbnail.lnk', 'public\stills\red-sea-visual-direction.jpg'),
    @('Pictures\Moses - The Red Sea\Film Sequence.lnk', 'scripts\moses-film-sequence.json'),
    @('Pictures\Moses - The Red Sea\Render Assets and Project Snapshots.lnk', 'screenshots\moses-restart'),
    @('Pictures\Moses - The Red Sea\Earlier Project Snapshots.lnk', 'screenshots\moses-qwen-no-thinking')
)
foreach ($entry in $links) {
    $linkPath = Join-Path $projectRoot $entry[0]
    $targetPath = Join-Path $projectRoot $entry[1]
    if (-not (Test-Path -LiteralPath $targetPath)) { continue }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($linkPath)) | Out-Null
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $targetPath
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = 'Premiere316 picture assets - original working location'
    $shortcut.Save()
    if ($shell.CreateShortcut($linkPath).TargetPath -ne $targetPath) {
        throw "Shortcut verification failed: $linkPath"
    }
    Write-Output $entry[0]
}
