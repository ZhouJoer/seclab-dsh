$ErrorActionPreference = 'Stop'
$pluginRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repoRoot = [IO.Path]::GetFullPath((Join-Path $pluginRoot '../../..'))
$links = @{
  '@deepseek-ai/schemastery' = (Join-Path $repoRoot 'vendor/schemastery')
  '@deepseek-ai/dsh-llm' = (Join-Path $repoRoot 'packages/llm/llm')
  '@deepseek-ai/dsh-helper' = (Join-Path $repoRoot 'packages/subagent/helper')
  '@deepseek-ai/dsh-tools' = (Join-Path $repoRoot 'packages/core/tools')
  '@deepseek-ai/dsh-spill-policy' = (Join-Path $repoRoot 'packages/spill/spill-policy')
  'zod' = ((Get-Item -LiteralPath (Join-Path $repoRoot 'node_modules/zod')).ResolveLinkTarget($true).FullName)
}
foreach ($entry in $links.GetEnumerator()) {
  $target = (Resolve-Path -LiteralPath $entry.Value).Path
  $destination = [IO.Path]::GetFullPath((Join-Path $pluginRoot ('node_modules/' + $entry.Key)))
  if (-not $destination.StartsWith($pluginRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Dependency destination escaped the local plugin directory.'
  }
  if (Test-Path -LiteralPath $destination) {
    $existing = Get-Item -LiteralPath $destination
    if ($existing.LinkType -ne 'Junction' -or $existing.ResolveLinkTarget($true).FullName -ne $target) {
      throw ('Existing dependency differs: ' + $entry.Key)
    }
  } else {
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
    New-Item -ItemType Junction -Path $destination -Target $target | Out-Null
  }
}
Write-Output 'Local package-name dependencies linked; existing repository and profile links unchanged.'
