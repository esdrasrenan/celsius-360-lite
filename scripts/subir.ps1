<#
.SYNOPSIS
  Sobe o Celsius 360 Lite em um comando, conferindo antes o que costuma dar errado.

.DESCRIPTION
  Confere o Docker, o .env, os dados do desafio e as portas. Se o .env não existir, cria um a partir do
  .env.example com uma senha aleatória. Depois roda docker compose up -d --build, acompanha a ingestão
  a cada 5 s e termina com o endereço, os usuários e de onde vem a senha.
  Compatível com o Windows PowerShell 5.1 e o PowerShell 7.

.PARAMETER SoVerificar
  Só faz as checagens, sem subir nada nem criar o .env. Sem Docker, as checagens dele viram avisos.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\subir.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\subir.ps1 -SoVerificar
#>
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingWriteHost', '', Justification = 'Saída colorida para quem está no terminal')]
[CmdletBinding()]
param([switch]$SoVerificar)

# Sem $ErrorActionPreference = 'Stop' de propósito: no 5.1 ele torna fatal qualquer linha que o docker
# escreva no stderr. Cada comando externo é conferido pelo $LASTEXITCODE.

$root = Split-Path -Parent $PSScriptRoot
$started = Get-Date
$script:failures = 0
$defaultPorts = [ordered]@{ WEB_PORT = 8080; API_PORT = 3000; POSTGRES_PORT = 55432; CLICKHOUSE_PORT = 58123; INGEST_METRICS_PORT = 9464 }
$roleLabels = @{ admin_diel = 'administrador da Diel'; gestor_cliente = 'gestor do cliente'; gerente_loja = 'gerente de loja' }

function Write-Check([string]$Level, [string]$Text) {
  $color = @{ ok = 'Green'; aviso = 'Yellow'; erro = 'Red' }[$Level]
  if ($Level -eq 'erro') { $script:failures++ }
  Write-Host ('  {0,-7} ' -f "[$Level]") -ForegroundColor $color -NoNewline
  Write-Host $Text
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $values[$Matches[1]] = $Matches[2].Trim([char[]]@('"', "'"))
    }
  }
  $values
}

# Como no Compose: a variável do terminal tem prioridade sobre o .env
function Get-Setting([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if (-not $value) { $value = $dotenv[$Name] }
  if (-not $value) { $value = $Default }
  $value
}

function Test-PortInUse([int]$Port) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.ConnectAsync('127.0.0.1', $Port).Wait(500) } catch { $false } finally { $client.Dispose() }
}

function Get-RandomPassword {
  $alphabet = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] 64
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  # Descarta bytes >= 248 para que o resto da divisão por 62 não favoreça nenhum caractere
  -join ($bytes | Where-Object { $_ -lt 248 } | Select-Object -First 16 | ForEach-Object { $alphabet[$_ % 62] })
}

Push-Location $root
try {
  Write-Host ''
  Write-Host 'Celsius 360 Lite: conferindo o ambiente' -ForegroundColor Cyan
  $dockerLevel = if ($SoVerificar) { 'aviso' } else { 'erro' }

  $dockerReady = $false
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Check $dockerLevel 'Docker não encontrado. Instale o Docker Desktop 4.x ou o Docker Engine com o Compose v2: https://docs.docker.com/get-docker/'
  } else {
    $info = docker info --format '{{.OSType}}|{{.MemTotal}}|{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $info) {
      Write-Check $dockerLevel 'O Docker não respondeu. Abra o Docker Desktop e espere aparecer "Engine running" (no Linux: sudo systemctl start docker).'
    } else {
      $osType, $memory, $version = "$info".Split('|')
      if ($osType -ne 'linux') {
        Write-Check $dockerLevel 'O Docker está no modo de contêineres Windows. No ícone do Docker Desktop, escolha "Switch to Linux containers".'
      } else {
        $dockerReady = $true
        Write-Check ok "Docker $version respondendo"
      }
      if ([double]$memory -lt 3.5GB) {
        Write-Check aviso ('O Docker tem {0:N1} GB de memória; o recomendado são 4 GB (Docker Desktop: Settings > Resources).' -f ([double]$memory / 1GB))
      }
    }
    $composeVersion = docker compose version --short 2>$null
    if ($LASTEXITCODE -ne 0) {
      $dockerReady = $false
      Write-Check $dockerLevel 'Falta o Docker Compose v2 (o comando "docker compose"). Atualize o Docker Desktop ou instale o docker-compose-plugin.'
    } else {
      Write-Check ok "Docker Compose $composeVersion"
    }
  }

  $envFile = Join-Path $root '.env'
  $dotenv = @{}
  if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Check ok '.env ainda não existe: a subida cria um a partir do .env.example, com uma senha aleatória'
  } elseif ([IO.File]::ReadAllBytes($envFile) -contains 0) {
    Write-Check erro 'O .env está em UTF-16 (o ">" do PowerShell 5.1 grava assim) e o Compose não lê esse formato. Converta com: (Get-Content .env) | Set-Content .env -Encoding ascii'
  } else {
    $dotenv = Read-DotEnv $envFile
    Write-Check ok '.env encontrado'
  }
  $demoPassword = Get-Setting 'DEMO_PASSWORD' ''
  if ($demoPassword -and $demoPassword.Length -lt 8) {
    Write-Check erro 'DEMO_PASSWORD tem menos de 8 caracteres e o setup vai recusá-la. Use uma senha maior ou deixe vazia para o setup gerar uma.'
  }
  $jwtSecret = Get-Setting 'JWT_SECRET' ''
  if ($jwtSecret -and $jwtSecret.Length -lt 32) {
    Write-Check erro 'JWT_SECRET tem menos de 32 caracteres e a API não sobe com ele. Use um maior ou apague a linha para o setup gerar um.'
  }

  $dataSetting = Get-Setting 'DATA_PATH' 'dados'
  $dataDir = if ([IO.Path]::IsPathRooted($dataSetting)) { $dataSetting } else { Join-Path $root $dataSetting }
  $telemetrySetting = Get-Setting 'TELEMETRY_FILE' ''
  $telemetryNames = if ($telemetrySetting) { @($telemetrySetting) } else { @('telemetrias.jsonl', 'telemetrias.jsonl.gz') }
  $registryFile = Join-Path $dataDir 'cadastro.json'
  $telemetryFile = $telemetryNames | ForEach-Object { Join-Path $dataDir $_ } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  $telemetryOverride = $null
  $totalLines = 0
  if ((Test-Path -LiteralPath $registryFile -PathType Leaf) -and $telemetryFile) {
    $telemetryName = Split-Path -Leaf $telemetryFile
    if ((Get-Item -LiteralPath $telemetryFile).Length -eq 0) {
      Write-Check erro "$telemetryName está vazio em ${dataSetting}. Copie de novo o arquivo da pasta dados do desafio."
    } else {
      if (-not $telemetryName.EndsWith('.gz')) { $totalLines = [Linq.Enumerable]::Count([IO.File]::ReadLines($telemetryFile)) }
      $lineNote = if ($totalLines -gt 0) { " ($totalLines linhas de telemetria)" } else { '' }
      Write-Check ok "cadastro.json e $telemetryName encontrados em $dataSetting$lineNote"
    }
    if (-not $telemetrySetting -and $telemetryName -ne 'telemetrias.jsonl') {
      # O Compose procura telemetrias.jsonl por padrão; esta subida passa o nome do .gz
      $telemetryOverride = $telemetryName
      $env:TELEMETRY_FILE = $telemetryName
      if (Test-Path -LiteralPath $envFile) {
        Write-Check aviso "Só há $telemetryName. Acrescente TELEMETRY_FILE=$telemetryName ao .env para as próximas subidas."
      }
    }
  } else {
    $nested = Get-ChildItem -LiteralPath $dataDir -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cadastro.json') } | Select-Object -First 1
    if ($nested) {
      $nestedLabel = Join-Path $dataSetting $nested.Name
      Write-Check erro "Os arquivos estão em $nestedLabel, um nível abaixo do esperado. Mova-os com: Move-Item `"$nestedLabel\*`" `"$dataSetting`""
    } else {
      Write-Check erro "Faltam os dados do desafio em ${dataSetting}: cadastro.json e telemetrias.jsonl. Copie os dois arquivos da pasta dados do desafio para lá ou aponte DATA_PATH para ela no .env."
    }
  }

  $stackRunning = $dockerReady -and [bool](docker compose ps -q --status running 2>$null)
  if ($stackRunning) {
    Write-Check ok 'A stack já está no ar e as portas são dela: a subida só atualiza o que mudou'
  } else {
    $ports = @{}
    foreach ($name in $defaultPorts.Keys) { $ports[$name] = [int](Get-Setting $name $defaultPorts[$name]) }
    $busy = @($defaultPorts.Keys | Where-Object { Test-PortInUse $ports[$_] })
    foreach ($name in $busy) {
      $next = "$name=$($ports[$name] + 1)"
      # Add-Content com -Encoding ascii: o ">" do 5.1 gravaria UTF-16, que o Compose não lê
      $change = if ($SoVerificar -and -not (Test-Path -LiteralPath $envFile)) { "troque a porta no .env, que a subida sem -SoVerificar cria ($next)" }
        else { "troque a porta no .env: Add-Content .env $next -Encoding ascii" }
      Write-Check erro "A porta $($ports[$name]) ($name) já está em uso. Feche o programa ou contêiner que a usa (docker ps lista os contêineres) ou $change."
    }
    if ($busy.Count -eq 0) {
      Write-Check ok ('Portas livres: ' + (($defaultPorts.Keys | ForEach-Object { $ports[$_] }) -join ', '))
    }
  }

  # Criado antes de conferir os erros: se o script mandar trocar uma porta no .env, ele já existe,
  # com a senha aleatória (um .env feito à mão deixaria a senha só no log do setup)
  $generatedPassword = $null
  if (-not $SoVerificar -and -not (Test-Path -LiteralPath $envFile)) {
    $lines = @(Get-Content -LiteralPath (Join-Path $root '.env.example'))
    if (-not $demoPassword) {
      $generatedPassword = Get-RandomPassword
      $lines = @($lines | ForEach-Object { if ($_ -match '^DEMO_PASSWORD=') { "DEMO_PASSWORD=$generatedPassword" } else { $_ } })
    }
    if ($telemetryOverride) { $lines += "TELEMETRY_FILE=$telemetryOverride" }
    Set-Content -LiteralPath $envFile -Value $lines -Encoding ascii
    $passwordPart = if ($generatedPassword) { ', com uma senha aleatória em DEMO_PASSWORD' } else { '' }
    Write-Check ok ".env criado a partir do .env.example$passwordPart"
  }

  Write-Host ''
  if ($script:failures -gt 0) {
    Write-Host 'Corrija o que está marcado com [erro] e rode o script de novo.' -ForegroundColor Red
    exit 1
  }
  if ($SoVerificar) {
    Write-Host 'Verificação concluída: nada impede a subida.' -ForegroundColor Green
    exit 0
  }

  Write-Host 'Subindo com docker compose up -d --build. Na primeira vez são cerca de 1 GB de download e de 3 a 6 min até o quadro final, com a ingestão.' -ForegroundColor Cyan
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'A subida falhou.' -ForegroundColor Red
    $setup = docker compose ps -a -q setup 2>$null | Select-Object -First 1
    $setupExit = if ($setup) { docker inspect -f '{{.State.ExitCode}}' $setup 2>$null }
    if ($setup -and $setupExit -ne '0') {
      Write-Host 'Últimas linhas do setup, onde costuma estar a causa:'
      docker compose logs --no-log-prefix --tail 15 setup
    }
    Write-Host 'Para investigar: docker compose ps -a e docker compose logs <serviço>.'
    exit 1
  }

  $appUrl = 'http://127.0.0.1:' + (Get-Setting 'WEB_PORT' '8080')
  Write-Host ''
  Write-Host "A aplicação já responde em $appUrl. A ingestão segue em segundo plano; Ctrl+C só para de acompanhar." -ForegroundColor Cyan
  $ingest = docker compose ps -a -q ingest 2>$null | Select-Object -First 1
  $state = ''
  $exitCode = ''
  while ($ingest) {
    $state, $exitCode, $restarts = "$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}' $ingest 2>$null)".Split('|')
    if ($state -notin 'running', 'restarting', 'created' -or [int]$restarts -ge 3) { break }
    $line = docker compose logs --no-log-prefix --tail 20 ingest 2>$null | Where-Object { $_ -cmatch '"seq":\d+' } | Select-Object -Last 1
    if ($line -cmatch '"seq":(\d+)') {
      $seq = [int]$Matches[1]
      $progress = if ($totalLines -gt 0) { '{0}% ({1} de {2} pacotes)' -f [Math]::Min(99, [Math]::Floor(100 * $seq / $totalLines)), $seq, $totalLines } else { "$seq pacotes" }
    } else {
      $progress = 'começando'
    }
    Write-Host "  ingestão: $progress"
    Start-Sleep -Seconds 5
  }
  if ($ingest) {
    if ($state -ne 'exited' -or $exitCode -ne '0') {
      Write-Host ''
      Write-Host 'A ingestão parou com erro. Últimas linhas:' -ForegroundColor Red
      docker compose logs --no-log-prefix --tail 15 ingest
      Write-Host 'Depois de corrigir, rode docker compose up -d: a ingestão retoma do ponto onde parou.'
      exit 1
    }
    $summary = docker compose logs --no-log-prefix --tail 30 ingest 2>$null | Where-Object { $_ -cmatch '"seconds":' } | Select-Object -Last 1
    if ($summary -cmatch '"packets":(\d+).*"seconds":([\d.]+)') {
      if ($Matches[1] -eq '0') { Write-Check ok 'Ingestão em dia: nada novo desde a última subida' }
      else { Write-Check ok "Ingestão concluída: $($Matches[1]) pacotes em $($Matches[2]) s" }
    }
  }

  $users = @()
  try { $users = @((Get-Content -LiteralPath $registryFile -Raw -Encoding UTF8 | ConvertFrom-Json).usuarios | Where-Object { $_.email }) } catch { $users = @() }
  $passwordNote = if ($generatedPassword) { "$generatedPassword  (gerada agora e gravada no .env; não aparece de novo)" }
    elseif ([Environment]::GetEnvironmentVariable('DEMO_PASSWORD')) { 'a de DEMO_PASSWORD definida neste terminal' }
    elseif ($dotenv['DEMO_PASSWORD']) { 'veja DEMO_PASSWORD no .env' }
    else { 'gerada pelo setup: docker compose logs setup | Select-String senha' }
  $elapsed = (Get-Date) - $started
  $duration = if ($elapsed.TotalMinutes -lt 1) { '{0} s' -f [int]$elapsed.TotalSeconds } else { '{0} min {1} s' -f [int][Math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds }
  $rule = '=' * 72

  Write-Host ''
  Write-Host $rule -ForegroundColor Green
  Write-Host " Pronto em $duration" -ForegroundColor Green
  Write-Host ''
  Write-Host (' {0,-10} {1}' -f 'Aplicação', $appUrl)
  $label = 'Usuários'
  foreach ($user in $users) {
    $role = $roleLabels[[string]$user.perfil]
    if (-not $role) { $role = $user.perfil }
    Write-Host (' {0,-10} {1} ({2})' -f $label, $user.email, $role)
    $label = ''
  }
  Write-Host (' {0,-10} {1}' -f 'Senha', $passwordNote)
  Write-Host (' {0,-10} {1}' -f 'Swagger', "$appUrl/api/docs")
  Write-Host (' {0,-10} {1}' -f 'Desligar', 'docker compose down  (com -v, apaga também os dados)')
  Write-Host $rule -ForegroundColor Green
} finally {
  Pop-Location
}
