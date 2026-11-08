param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
$templateRoot = Join-Path $skillRoot 'templates'
$resolvedTarget = [System.IO.Path]::GetFullPath($ProjectPath)

$directories = @(
    'config',
    'imports/raw/cnki',
    'imports/raw/wanfang',
    'imports/raw/vip',
    'imports/raw/sinomed',
    'logs',
    'reports',
    'tables'
)

foreach ($relative in $directories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $resolvedTarget $relative) | Out-Null
}

$copies = @(
    @{ Source = 'protocol_template_v1.md'; Target = 'config/protocol_v1.md' },
    @{ Source = 'search_project_template_v1.json'; Target = 'config/search_project_v1.json' },
    @{ Source = 'browser_automation_config_v2.json'; Target = 'config/browser_automation_v2.json' },
    @{ Source = 'search_run_ledger_template_v1.csv'; Target = 'tables/v1_search_run_ledger.csv' },
    @{ Source = 'automation_family_ledger_template_v2.csv'; Target = 'tables/v2_automation_family_ledger.csv' },
    @{ Source = 'screening_ledger_template_v1.csv'; Target = 'tables/v1_title_abstract_screening_template.csv' }
)

foreach ($item in $copies) {
    $source = Join-Path $templateRoot $item.Source
    $target = Join-Path $resolvedTarget $item.Target
    if ((Test-Path -LiteralPath $target) -and -not $Force) {
        Write-Host "[SKIP] Already exists: $target"
        continue
    }
    Copy-Item -LiteralPath $source -Destination $target -Force:$Force
    Write-Host "[CREATE] $target"
}

Write-Host "`nProject initialized: $resolvedTarget"
Write-Host 'Next: freeze the protocol. Use manual authorized export, or read references/browser-automation.md before the optional CNKI alpha adapter.'


