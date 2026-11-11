[CmdletBinding()]
param(
    [string]$TargetPath = 'D:\Gongzao-Shared-3D-v0.6-Download\Gongzao-Shared-3D-v0.7'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-OrdinaryFolder([string]$Folder) {
    $item = Get-Item -LiteralPath $Folder -Force
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "项目路径不能包含符号链接或目录联接：$($item.FullName)"
        }
        if (-not $item.PSIsContainer) { throw "路径不是文件夹：$($item.FullName)" }
        $item = $item.Parent
    }
}

try {
    $source = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..')).FullName
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $engine = Join-Path $PSScriptRoot 'update-local.mjs'
    Write-Host '正在检查新版文件、目标版本和更新清单……'
    Assert-OrdinaryFolder $source
    Assert-OrdinaryFolder $TargetPath
    $checkOutput = & $node $engine --check --target $TargetPath
    if ($LASTEXITCODE -ne 0) { throw '更新预检失败，尚未修改旧项目。请查看上方具体原因。' }
    $plan = ($checkOutput -join "`n") | ConvertFrom-Json
    $resolvedTarget = [string]$plan.target

    # Only inspect processes. Never terminate a process or service.
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
    foreach ($process in $processes) {
        $line = [string]$process.CommandLine
        if ([string]::IsNullOrWhiteSpace($line)) {
            throw '无法读取一个 Node 进程的启动参数。请关闭正在运行的 Node 应用后重试；不需要管理员权限。'
        }
        if ($line -match '(?i)(launch-local\.mjs|services[\\/]platform[\\/]local\.mjs)' -or
            $line.IndexOf($resolvedTarget, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw '共造服务可能仍在运行。请在原启动窗口按 Ctrl+C，关闭服务后重新双击更新。更新期间不要启动服务。'
        }
    }

    # SQLite data is checked for exclusive access, but never copied, deleted or migrated here.
    foreach ($name in @('platform.sqlite', 'platform.sqlite-wal', 'platform.sqlite-shm')) {
        $databasePath = Join-Path (Join-Path $resolvedTarget 'data') $name
        if (Test-Path -LiteralPath $databasePath) {
            $handle = $null
            try {
                $handle = [IO.File]::Open($databasePath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            } catch {
                throw '数据库仍被占用或不可写。请在原启动窗口按 Ctrl+C 后重试，保留 data 文件夹。'
            } finally {
                if ($null -ne $handle) { $handle.Dispose() }
            }
        }
    }

    Write-Host "即将更新 $($plan.fromVersion) → $($plan.toVersion)，请等待完成。"
    $priorPreflight = [Environment]::GetEnvironmentVariable('GONGZAO_UPDATE_PREFLIGHT', 'Process')
    try {
        $env:GONGZAO_UPDATE_PREFLIGHT = 'complete'
        $resultOutput = & $node $engine --apply --target $resolvedTarget
        if ($LASTEXITCODE -ne 0) { throw '更新未完成。请保留上方提示的备份目录，并查看具体错误；不要删除原 data 文件夹。' }
        $result = ($resultOutput -join "`n") | ConvertFrom-Json
    } finally {
        [Environment]::SetEnvironmentVariable('GONGZAO_UPDATE_PREFLIGHT', $priorPreflight, 'Process')
    }
    Write-Host ''
    Write-Host "更新完成：$($result.fromVersion) → $($result.toVersion)" -ForegroundColor Green
    Write-Host "原项目：$($result.target)"
    Write-Host "代码备份：$($result.backup)"
    Write-Host '原 data、私密配置和依赖目录均保留。'
    foreach ($config in $result.preserved) { Write-Host "保留本机部署设置：$config" }
    Write-Host '现在进入原项目文件夹，双击 START-WINDOWS.cmd 启动。'
    exit 0
} catch {
    Write-Host ''
    Write-Host ('更新失败：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '本程序不会停止其他进程，也不会删除原数据。'
    exit 1
}
