<#
.SYNOPSIS
SuperScanner gRPC 服务测试脚本。
使用 grpcurl 工具通过 PowerShell 自动化调用 tasks.v1.Tasks 服务。

.DESCRIPTION
本脚本会依次执行 gRPC 服务的创建任务、获取详情、启动、监听事件、停止、
列出和删除等操作，用于端到端测试。

.NOTES
已修复 grpcurl "Too many arguments" 错误。解决方案是使用管道 (stdin) 代替 -d 参数。
#>
param(
    [Parameter(Mandatory=$false)]
    [string]$ServerAddr = "127.0.0.1:50051", # gRPC 服务器地址
    
    [Parameter(Mandatory=$false)]
    [string]$ProtoFileName = "tasks.proto" # proto 文件名
)

# 使用 Join-Path 确保跨平台的路径兼容性
$ProtoDir = Join-Path $PSScriptRoot '..\\proto'
$ProtoFile = Join-Path $ProtoDir $ProtoFileName
$ImportPath = $ProtoDir

# 默认的 grpcurl 参数
$BaseGrpcurlArgs = @(
    "-plaintext",
    "-import-path", $ImportPath,
    "-proto", $ProtoFile,
    $ServerAddr
)

# 函数：执行 grpcurl 命令并处理通用错误
function Invoke-GrpcCall {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Method,          # gRPC 方法，例如 tasks.v1.Tasks/CreateTask
        [Parameter(Mandatory=$false)]
        [string]$Data = ""        # JSON 输入数据 (如果使用管道，则为要管道化的内容)
    )

    Write-Host "`n>>> 正在调用方法: $Method" -ForegroundColor Cyan
    
    $CurrentArgs = @($BaseGrpcurlArgs)
    
    $HasInputData = -not [string]::IsNullOrEmpty($Data)

    if ($HasInputData) {
        # 如果需要数据输入，添加 -d @ 表示从 stdin 读取
        $CurrentArgs += @("-d", "@") 
    }
    
    $CurrentArgs += @($Method)

    # 调用 grpcurl，并捕获任何错误输出
    try {
        # 核心修复点：将 JSON 数据通过管道传递给 grpcurl
        if ($HasInputData) {
            # 1. 写入 JSON 数据到管道
            # 2. 调用外部命令 grpcurl 并使用 splatting 传递参数
            $Result = $Data | & grpcurl @CurrentArgs 2>&1
        } else {
            # 如果没有数据，直接调用
            $Result = & grpcurl @CurrentArgs 2>&1
        }
        
        # 检查 grpcurl 是否返回了错误
        if ($LASTEXITCODE -ne 0) {
            Write-Error "grpcurl 调用 $Method 失败 (Exit Code $LASTEXITCODE)。输出: $Result"
            return $null
        }

        # 如果成功，返回结果
        return $Result
        
    } catch {
        Write-Error "执行 grpcurl 过程中发生 PowerShell 异常: $_"
        return $null
    }
}

# --------------------
# 预检和环境检查
# --------------------

Write-Host "--- gRPC 测试脚本 v2.0 (已修复参数错误) ---" -ForegroundColor Green
Write-Host "目标服务器: $ServerAddr"
Write-Host "Proto 路径: $ProtoFile"

# 检查 grpcurl 是否安装
if (-not (Get-Command grpcurl -ErrorAction SilentlyContinue)) {
    Write-Error "未找到 grpcurl。请先安装它。"
    exit 1
}

# 检查 proto 文件是否存在
if (-not (Test-Path $ProtoFile)) {
    Write-Error "无法找到 proto 文件: $ProtoFile"
    exit 1
}

# 检查 gRPC 服务可达性 (TCP 连接测试)
$hostName = $ServerAddr.Split(':')[0]
$portNum = [int]$ServerAddr.Split(':')[1]
try {
    # 显式使用 -InformationLevel Quiet 确保不输出动态状态行/指示器
    # 增加 TimeoutSeconds，防止长时间阻塞
    $TestResult = Test-NetConnection -ComputerName $hostName `
                                    -Port $portNum `
                                    -InformationLevel Quiet `
                                    -TimeoutSeconds 1 `
                                    -ErrorAction Stop
    
    $reachable = $TestResult.TcpTestSucceeded
} catch {
    $reachable = $false
}
if (-not $reachable) {
    Write-Warning "gRPC 服务 $ServerAddr 无法连接 (TCP Test Failed)。相关调用可能会失败。"
}

# --------------------
# 脚本核心测试流程
# --------------------
$TaskId = $null
$Job = $null

# 使用 try/finally 结构确保在任何退出或错误发生时，后台 Job 都能被清理
try {
    Write-Host "`n=== 1. 列出所有服务 ===" -ForegroundColor Yellow
    $ListResult = Invoke-GrpcCall "list"
    if (-not $ListResult) { exit 1 }
    Write-Host $ListResult

    Write-Host "`n=== 2. 创建任务 (Ping Localhost) ===" -ForegroundColor Yellow
    # 将 JSON 转换为紧凑字符串，便于通过管道传输
    $CreateJson = @{
        "name"        = "Ping Test (PowerShell)";
        "description" = "Testing ping command from PowerShell script";
        "targets"     = @("127.0.0.1", "localhost")
    } | ConvertTo-Json -Compress

    $CreateResult = Invoke-GrpcCall "tasks.v1.Tasks/CreateTask" $CreateJson
    
    if ($CreateResult) {
        try {
            $Task = $CreateResult | ConvertFrom-Json
            $TaskId = $Task.id
            Write-Host $CreateResult 
            Write-Host "Created Task ID: $TaskId" -ForegroundColor Green
        } catch {
            Write-Error "无法解析创建任务的响应，跳过后续步骤。"
            exit 1
        }
    } else {
        Write-Error "创建任务失败，无法获取 Task ID。"
        exit 1
    }

    Write-Host "`n=== 3. 获取任务详情 ===" -ForegroundColor Yellow
    $GetJson = "{ ""id"": ""$TaskId"" }"
    Invoke-GrpcCall "tasks.v1.Tasks/GetTask" $GetJson | Write-Host

    Write-Host "`n=== 4. 启动任务 ===" -ForegroundColor Yellow
    $StartJson = "{ ""id"": ""$TaskId"" }"
    Invoke-GrpcCall "tasks.v1.Tasks/StartTask" $StartJson | Write-Host

    Write-Host "`n=== 5. 监听任务事件 (日志/进度) - 运行 5 秒 ===" -ForegroundColor Yellow
    $StreamJson = @{
        "id"                   = $TaskId; 
        "start_if_not_running" = $false 
    } | ConvertTo-Json -Compress

    # 启动后台作业来监听流，Stream 也是需要管道输入 Task ID 的
    $Job = Start-Job -Name "GrpcStreamMonitor" -ScriptBlock {
        param($BaseArgs, $Data)
        
        $FullArgs = $BaseArgs + @("-d", "@", "tasks.v1.Tasks/StreamTaskEvents")
        Write-Host "--- Stream Job Started ---"
        # 使用管道传递 Stream 请求数据
        $Data | & grpcurl @FullArgs
        Write-Host "--- Stream Job Finished ---"
    } -ArgumentList $BaseGrpcurlArgs, $StreamJson

    Write-Host "后台 Job (ID: $($Job.Id)) 已启动，等待 5 秒接收流事件..."
    Start-Sleep -Seconds 5
    
    # 停止 Job
    Stop-Job $Job -PassThru | Out-Null
    
    Write-Host "`n--- StreamTaskEvents 输出 (Job ID: $($Job.Id)) ---" -ForegroundColor DarkGreen
    Receive-Job $Job -Keep -Wait | Write-Host

    Write-Host "---------------------------------------------------------"

    Write-Host "`n=== 6. 停止任务 ===" -ForegroundColor Yellow
    $StopJson = "{ ""id"": ""$TaskId"" }"
    Invoke-GrpcCall "tasks.v1.Tasks/StopTask" $StopJson | Write-Host

    Write-Host "`n=== 7. 列出所有任务 ===" -ForegroundColor Yellow
    Invoke-GrpcCall "tasks.v1.Tasks/ListTasks" | Write-Host

    Write-Host "`n=== 8. 删除任务 ===" -ForegroundColor Yellow
    $DeleteJson = "{ ""id"": ""$TaskId"" }"
    Invoke-GrpcCall "tasks.v1.Tasks/DeleteTask" | Write-Host
    
} catch {
    Write-Error "脚本执行中发生致命错误: $_"
} finally {
    # 无论脚本是否出错，都要清理后台 Job
    if ($Job -and $Job.State -in @("Running", "Suspended", "Stopped")) {
        Write-Host "`n--- 正在清理后台 Job ($($Job.Id)) ---" -ForegroundColor Red
        $Job | Stop-Job -ErrorAction SilentlyContinue
        $Job | Remove-Job
    }
}

Write-Host "`n=== 测试完成 ===" -ForegroundColor Green