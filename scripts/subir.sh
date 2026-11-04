#!/bin/sh
# Sobe o Celsius 360 Lite em um comando, conferindo antes o que costuma dar errado: Docker, .env,
# dados do desafio e portas. Se o .env não existir, cria um a partir do .env.example com uma senha
# aleatória. Depois roda docker compose up -d --build, acompanha a ingestão a cada 5 s e termina com
# o endereço, os usuários e de onde vem a senha.
#
#   sh scripts/subir.sh                 sobe a stack
#   sh scripts/subir.sh --so-verificar  só confere (sem Docker, as checagens dele viram avisos)
set -u

check_only=false
case "${1:-}" in
  '') ;;
  --so-verificar) check_only=true ;;
  -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
  *) printf 'Opção desconhecida: %s (use --so-verificar ou --help)\n' "$1" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.." || exit 1
started=$(date +%s)
failures=0
if [ -t 1 ]; then
  red=$(printf '\033[31m') green=$(printf '\033[32m') yellow=$(printf '\033[33m') cyan=$(printf '\033[36m') reset=$(printf '\033[0m')
else
  red='' green='' yellow='' cyan='' reset=''
fi

check() {
  case "$1" in
    ok) color=$green ;;
    aviso) color=$yellow ;;
    *) color=$red; failures=$((failures + 1)) ;;
  esac
  printf '  %s%-7s%s %s\n' "$color" "[$1]" "$reset" "$2"
}

# Como no Compose: a variável do terminal tem prioridade sobre o .env
setting() {
  eval "value=\${$1:-}"
  if [ -z "$value" ] && [ "$env_readable" = true ]; then
    value=$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env | tail -n 1 | tr -d '\r' |
      sed "s/[[:space:]]*\$//; s/^[\"']//; s/[\"']\$//")
  fi
  printf '%s' "${value:-$2}"
}

# Uma conexão aceita em 127.0.0.1 é o que faria o Compose falhar ao publicar a porta
port_in_use() {
  if command -v bash >/dev/null 2>&1; then
    bash -c ": > /dev/tcp/127.0.0.1/$1" 2>/dev/null
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" 2>/dev/null
  else
    return 2
  fi
}

printf '\n%sCelsius 360 Lite: conferindo o ambiente%s\n' "$cyan" "$reset"
docker_level=erro
[ "$check_only" = true ] && docker_level=aviso

docker_ready=false
if ! command -v docker >/dev/null 2>&1; then
  check "$docker_level" 'Docker não encontrado. Instale o Docker Desktop 4.x ou o Docker Engine com o Compose v2: https://docs.docker.com/get-docker/'
else
  if ! info=$(docker info --format '{{.OSType}}|{{.MemTotal}}|{{.ServerVersion}}' 2>/dev/null) || [ -z "$info" ]; then
    check "$docker_level" 'O Docker não respondeu. Abra o Docker Desktop e espere aparecer "Engine running" (no Linux: sudo systemctl start docker).'
  else
    os_type=${info%%|*}
    rest=${info#*|}
    memory=${rest%%|*}
    if [ "$os_type" != linux ]; then
      check "$docker_level" 'O Docker está no modo de contêineres Windows. No ícone do Docker Desktop, escolha "Switch to Linux containers".'
    else
      docker_ready=true
      check ok "Docker ${rest#*|} respondendo"
    fi
    if [ -n "$memory" ] && [ "$memory" -lt 3758096384 ]; then
      check aviso "O Docker tem $(awk "BEGIN { printf \"%.1f\", $memory / 1073741824 }") GB de memória; o recomendado são 4 GB (Docker Desktop: Settings > Resources)."
    fi
  fi
  if compose_version=$(docker compose version --short 2>/dev/null); then
    check ok "Docker Compose $compose_version"
  else
    docker_ready=false
    check "$docker_level" 'Falta o Docker Compose v2 (o comando "docker compose"). Atualize o Docker Desktop ou instale o docker-compose-plugin.'
  fi
fi

env_readable=false
if [ ! -f .env ]; then
  check ok '.env ainda não existe: a subida cria um a partir do .env.example, com uma senha aleatória'
elif [ "$(od -An -tx1 -N2 .env | tr -d ' \n')" = fffe ]; then
  check erro 'O .env está em UTF-16 (o ">" do PowerShell 5.1 grava assim) e o Compose não lê esse formato. No PowerShell, converta com: (Get-Content .env) | Set-Content .env -Encoding ascii'
else
  env_readable=true
  check ok '.env encontrado'
fi
demo_password=$(setting DEMO_PASSWORD '')
if [ -n "$demo_password" ] && [ ${#demo_password} -lt 8 ]; then
  check erro 'DEMO_PASSWORD tem menos de 8 caracteres e o setup vai recusá-la. Use uma senha maior ou deixe vazia para o setup gerar uma.'
fi
jwt_secret=$(setting JWT_SECRET '')
if [ -n "$jwt_secret" ] && [ ${#jwt_secret} -lt 32 ]; then
  check erro 'JWT_SECRET tem menos de 32 caracteres e a API não sobe com ele. Use um maior ou apague a linha para o setup gerar um.'
fi

data_dir=$(setting DATA_PATH dados)
telemetry_setting=$(setting TELEMETRY_FILE '')
telemetry=''
for name in ${telemetry_setting:-telemetrias.jsonl telemetrias.jsonl.gz}; do
  if [ -f "$data_dir/$name" ]; then telemetry=$name; break; fi
done
telemetry_override=''
total_lines=0
if [ -f "$data_dir/cadastro.json" ] && [ -n "$telemetry" ]; then
  if [ ! -s "$data_dir/$telemetry" ]; then
    check erro "$telemetry está vazio em $data_dir. Copie de novo o arquivo da pasta dados do desafio."
  else
    case "$telemetry" in
      *.gz) line_note='' ;;
      *) total_lines=$(wc -l < "$data_dir/$telemetry" | tr -d ' '); line_note=" ($total_lines linhas de telemetria)" ;;
    esac
    check ok "cadastro.json e $telemetry encontrados em $data_dir$line_note"
  fi
  if [ -z "$telemetry_setting" ] && [ "$telemetry" != telemetrias.jsonl ]; then
    # O Compose procura telemetrias.jsonl por padrão; esta subida passa o nome do .gz
    telemetry_override=$telemetry
    TELEMETRY_FILE=$telemetry
    export TELEMETRY_FILE
    if [ -f .env ]; then
      check aviso "Só há $telemetry. Acrescente TELEMETRY_FILE=$telemetry ao .env para as próximas subidas."
    fi
  fi
else
  nested=''
  for dir in "$data_dir"/*/; do
    if [ -f "${dir}cadastro.json" ]; then nested=${dir%/}; break; fi
  done
  if [ -n "$nested" ]; then
    check erro "Os arquivos estão em $nested, um nível abaixo do esperado. Mova-os com: mv \"$nested\"/* \"$data_dir\"/"
  else
    check erro "Faltam os dados do desafio em $data_dir: cadastro.json e telemetrias.jsonl. Copie os dois arquivos da pasta dados do desafio para lá ou aponte DATA_PATH para ela no .env."
  fi
fi

if [ "$docker_ready" = true ] && [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]; then
  check ok 'A stack já está no ar e as portas são dela: a subida só atualiza o que mudou'
else
  free_ports=''
  busy=0
  unchecked=false
  for pair in WEB_PORT:8080 API_PORT:3000 POSTGRES_PORT:55432 CLICKHOUSE_PORT:58123 INGEST_METRICS_PORT:9464; do
    name=${pair%%:*}
    port=$(setting "$name" "${pair#*:}")
    port_in_use "$port"
    case $? in
      0)
        busy=$((busy + 1))
        next="$name=$((port + 1))"
        if [ "$check_only" = true ] && [ ! -f .env ]; then
          change="troque a porta no .env, que a subida sem --so-verificar cria ($next)"
        else
          change="troque a porta no .env: echo $next >> .env"
        fi
        check erro "A porta $port ($name) já está em uso. Feche o programa ou contêiner que a usa (docker ps lista os contêineres) ou $change." ;;
      1) free_ports="$free_ports${free_ports:+, }$port" ;;
      *) unchecked=true ;;
    esac
  done
  if [ "$unchecked" = true ]; then
    check aviso 'Não deu para conferir as portas (falta bash ou nc); se alguma estiver ocupada, o Compose avisa ao subir.'
  elif [ "$busy" -eq 0 ]; then
    check ok "Portas livres: $free_ports"
  fi
fi

# Criado antes de conferir os erros: se o script mandar trocar uma porta no .env, ele já existe,
# com a senha aleatória (um .env feito à mão deixaria a senha só no log do setup)
generated_password=''
if [ "$check_only" != true ] && [ ! -f .env ]; then
  password_part=''
  if [ -z "$demo_password" ]; then
    generated_password=$(LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom | head -c 16)
    sed "s/^DEMO_PASSWORD=.*/DEMO_PASSWORD=$generated_password/" .env.example > .env
    password_part=', com uma senha aleatória em DEMO_PASSWORD'
  else
    cp .env.example .env
  fi
  if [ -n "$telemetry_override" ]; then printf 'TELEMETRY_FILE=%s\n' "$telemetry_override" >> .env; fi
  env_readable=true
  check ok ".env criado a partir do .env.example$password_part"
fi

printf '\n'
if [ "$failures" -gt 0 ]; then
  printf '%sCorrija o que está marcado com [erro] e rode o script de novo.%s\n' "$red" "$reset"
  exit 1
fi
if [ "$check_only" = true ]; then
  printf '%sVerificação concluída: nada impede a subida.%s\n' "$green" "$reset"
  exit 0
fi

printf '%sSubindo com docker compose up -d --build. Na primeira vez são cerca de 1 GB de download e de 3 a 6 min até o quadro final, com a ingestão.%s\n' "$cyan" "$reset"
if ! docker compose up -d --build; then
  printf '\n%sA subida falhou.%s\n' "$red" "$reset"
  setup_id=$(docker compose ps -a -q setup 2>/dev/null | head -n 1)
  if [ -n "$setup_id" ] && [ "$(docker inspect -f '{{.State.ExitCode}}' "$setup_id" 2>/dev/null)" != 0 ]; then
    printf 'Últimas linhas do setup, onde costuma estar a causa:\n'
    docker compose logs --no-log-prefix --tail 15 setup
  fi
  printf 'Para investigar: docker compose ps -a e docker compose logs <serviço>.\n'
  exit 1
fi

app_url="http://127.0.0.1:$(setting WEB_PORT 8080)"
printf '\n%sA aplicação já responde em %s. A ingestão segue em segundo plano; Ctrl+C só para de acompanhar.%s\n' \
  "$cyan" "$app_url" "$reset"
ingest_id=$(docker compose ps -a -q ingest 2>/dev/null | head -n 1)
state=''
exit_code=''
while [ -n "$ingest_id" ]; do
  status=$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}' "$ingest_id" 2>/dev/null)
  state=${status%%|*}
  rest=${status#*|}
  exit_code=${rest%%|*}
  restarts=${rest#*|}
  case "$state" in running | restarting | created) ;; *) break ;; esac
  if [ "${restarts:-0}" -ge 3 ]; then break; fi
  current=$(docker compose logs --no-log-prefix --tail 20 ingest 2>/dev/null | sed -n 's/.*"seq":\([0-9][0-9]*\).*/\1/p' | tail -n 1)
  if [ -z "$current" ]; then
    progress='começando'
  elif [ "$total_lines" -gt 0 ]; then
    percent=$((current * 100 / total_lines))
    if [ "$percent" -gt 99 ]; then percent=99; fi
    progress="$percent% ($current de $total_lines pacotes)"
  else
    progress="$current pacotes"
  fi
  printf '  ingestão: %s\n' "$progress"
  sleep 5
done
if [ -n "$ingest_id" ]; then
  if [ "$state" != exited ] || [ "$exit_code" != 0 ]; then
    printf '\n%sA ingestão parou com erro. Últimas linhas:%s\n' "$red" "$reset"
    docker compose logs --no-log-prefix --tail 15 ingest
    printf 'Depois de corrigir, rode docker compose up -d: a ingestão retoma do ponto onde parou.\n'
    exit 1
  fi
  summary=$(docker compose logs --no-log-prefix --tail 30 ingest 2>/dev/null | grep '"seconds":' | tail -n 1)
  packets=$(printf '%s' "$summary" | sed -n 's/.*"packets":\([0-9][0-9]*\).*/\1/p')
  seconds=$(printf '%s' "$summary" | sed -n 's/.*"seconds":\([0-9.][0-9.]*\).*/\1/p')
  if [ "$packets" = 0 ]; then
    check ok 'Ingestão em dia: nada novo desde a última subida'
  elif [ -n "$packets" ]; then
    check ok "Ingestão concluída: $packets pacotes em $seconds s"
  fi
fi

if [ -n "$generated_password" ]; then
  password_note="$generated_password  (gerada agora e gravada no .env; não aparece de novo)"
elif [ -n "${DEMO_PASSWORD:-}" ]; then
  password_note='a de DEMO_PASSWORD definida neste terminal'
elif [ -n "$demo_password" ]; then
  password_note='veja DEMO_PASSWORD no .env'
else
  password_note='gerada pelo setup: docker compose logs setup | grep -i senha'
fi
elapsed=$(($(date +%s) - started))
if [ "$elapsed" -lt 60 ]; then duration="$elapsed s"; else duration="$((elapsed / 60)) min $((elapsed % 60)) s"; fi
rule='========================================================================'

printf '\n%s%s\n Pronto em %s%s\n\n' "$green" "$rule" "$duration" "$reset"
printf ' Aplicação  %s\n' "$app_url"
# Usuários do cadastro sem depender de jq: um objeto por linha, e-mail e perfil de cada um
label='Usuários  '
tr -d '\r\n' < "$data_dir/cadastro.json" | sed 's/.*"usuarios"[[:space:]]*:[[:space:]]*\[//' | tr '{' '\n' |
  sed -n 's/.*"email"[[:space:]]*:[[:space:]]*"\([^"]*\)".*"perfil"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1 \2/p' |
  while read -r email role || [ -n "$email" ]; do
    case "$role" in
      admin_diel) role='administrador da Diel' ;;
      gestor_cliente) role='gestor do cliente' ;;
      gerente_loja) role='gerente de loja' ;;
    esac
    printf ' %s %s (%s)\n' "$label" "$email" "$role"
    label='          '
  done
printf ' Senha      %s\n' "$password_note"
printf ' Swagger    %s\n' "$app_url/api/docs"
printf ' Desligar   docker compose down  (com -v, apaga também os dados)\n'
printf '%s%s%s\n' "$green" "$rule" "$reset"
