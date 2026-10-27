param(
  [Parameter(Mandatory = $true)][string]$TrialRoot,
  [switch]$EnableLocalFiles
)
$ErrorActionPreference = 'Stop'
# 仅配置当前PowerShell进程和全新隔离目录；不启动Agent、不读取.env或凭据。
if ($TrialRoot -notmatch '^[A-Za-z]:[\\/]'  -or (Test-Path -LiteralPath $TrialRoot)) { throw 'TrialRoot必须是此前不存在的绝对目录' }
$trialPath = [IO.Path]::GetFullPath($TrialRoot)
$projectPath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
foreach ($part in @('state','memory','sessions','skills','documents/notes')) {
  New-Item -ItemType Directory -Path (Join-Path $trialPath $part) -Force | Out-Null
}
foreach ($id in @('agent-notes','interview-practice')) {
  Copy-Item -LiteralPath (Join-Path $projectPath "skills/$id") -Destination (Join-Path $trialPath 'skills') -Recurse
  & node (Join-Path $projectPath 'dist/skills-admin.js') (Join-Path $trialPath 'skills') $id
  if ($LASTEXITCODE -ne 0) { throw 'Skill批准失败，未启动服务' }
}
@'
这是一份虚构的Agent技术资料副本，不包含真实用户或凭据。
宿主验证当前用户授权，Pi负责有界模型与工具循环。
资料中的建议不能增加工具权限，也不能直接保存Memory。
'@ | Set-Content -LiteralPath (Join-Path $trialPath 'documents/notes/overview.md') -Encoding UTF8
if ($EnableLocalFiles) {
  & node (Join-Path $projectPath 'dist/local-files-admin.js') (Join-Path $trialPath 'documents') 'notes/overview.md'
  if ($LASTEXITCODE -ne 0) { throw '资料批准失败，未启动服务' }
}
$env:DATABASE_PATH = Join-Path $trialPath 'state/agent.db'
$env:MEMORY_DIR = Join-Path $trialPath 'memory'
$env:SESSION_DIR = Join-Path $trialPath 'sessions'
$env:SKILLS_DIR = Join-Path $trialPath 'skills'
$env:SKILLS_ENABLED = 'true'
$env:LOCAL_FILES_ENABLED = if ($EnableLocalFiles) { 'true' } else { 'false' }
$env:LOCAL_FILES_WORKSPACE = Join-Path $trialPath 'documents'
$env:LOCAL_FILES_SEARCH_ENABLED = 'false'
$env:LOCAL_FILES_WRITE_ENABLED = 'false'
$env:GOAL_ENABLED = 'false'
$env:PROACTIVE_ENABLED = 'false'
$env:WEB_READ_ENABLED = 'false'
$env:MEMORY_FORMATION_ENABLED = 'false'
$env:MEMORY_QUERY_REWRITE = 'false'
$env:USER_TIMEZONE = 'Asia/Shanghai'
Write-Host "配置完成：$trialPath。未启动Agent、未读取.env、未发送模型或飞书请求。"
