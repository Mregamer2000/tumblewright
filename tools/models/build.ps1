# Rebuilds all Tumblewright models with Blender and embeds them into index.html
# (the normal set, plus the low-poly PS1-style set used by the Low graphics tier).
# Usage (from the project root):  powershell -ExecutionPolicy Bypass -File tools/models/build.ps1
# Optional: -Blender "path\to\blender.exe"   -Preview   (also renders tools/models/preview.png)
param(
  [string]$Blender = "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe",
  [switch]$Preview
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here '..\..')
$html = Join-Path $root 'index.html'

foreach ($set in @(@{ flag = ''; name = 'tumblewright_models'; id = 'tw-models' }, @{ flag = '--lowpoly'; name = 'tumblewright_models_ps1'; id = 'tw-models-ps1' })) {
  $raw = Join-Path $env:TEMP ($set.name + '_raw.glb')
  $packed = Join-Path $env:TEMP ($set.name + '.glb')
  $blArgs = @('--background', '--factory-startup', '--python', (Join-Path $here 'build_models.py'), '--', $raw)
  if ($set.flag) { $blArgs += $set.flag }
  & $Blender @blArgs | Select-String 'MODELS_OK|Error|Traceback'
  npx --yes gltfpack@0.24.0 -i $raw -o $packed -cc -kn -km
  node (Join-Path $here 'embed.mjs') $packed $html $set.id
}
if ($Preview) {
  & $Blender --background --factory-startup --python (Join-Path $here 'preview.py') -- (Join-Path $env:TEMP 'tumblewright_models_raw.glb') (Join-Path $here 'preview.png') | Select-String 'PREVIEW_OK'
}
