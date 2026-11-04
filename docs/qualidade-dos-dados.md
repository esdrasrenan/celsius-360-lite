# Qualidade dos dados

Como a telemetria do desafio foi avaliada, o que apareceu e como cada caso é tratado. Os números abaixo saem do relatório que a ingestão grava ao terminar. Há três formas de consultá-lo:

- **Na aplicação:** a página **Qualidade dos dados** (`http://127.0.0.1:8080/qualidade`), visível para o administrador (`ana.ribeiro@diel.example`). Ela mostra os indicadores, as anomalias com evidência, os episódios de sensor travado e as lacunas com link para o gráfico, e exporta cada tabela em CSV.
- **Recalculando, sem precisar de Bun na máquina:**

  ```bash
  docker compose run --rm ingest bun run apps/ingest/src/main.ts quality
  ```

- **Pela API**, entrando como administrador. A senha é a `DEMO_PASSWORD` do `.env` ou a que o setup mostrou na primeira subida.

  ```powershell
  # Windows PowerShell 5.1 ou 7
  $senha = Read-Host 'Senha'
  Invoke-RestMethod http://127.0.0.1:8080/api/v1/auth/login -Method Post -ContentType 'application/json' -SessionVariable sessao -Body (@{ email = 'ana.ribeiro@diel.example'; password = $senha } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod http://127.0.0.1:8080/api/v1/quality -WebSession $sessao | ConvertTo-Json -Depth 6
  ```

  ```bash
  # bash ou zsh
  printf 'Senha: '; read -rs SENHA; echo
  curl -s -c cookies.txt -H 'content-type: application/json' -d "{\"email\":\"ana.ribeiro@diel.example\",\"password\":\"$SENHA\"}" http://127.0.0.1:8080/api/v1/auth/login > /dev/null
  curl -s -b cookies.txt http://127.0.0.1:8080/api/v1/quality
  ```

## Como a avaliação foi feita

1. **Perfil do arquivo:** esquema de cada linha, tipos, formatos de horário, valores de `GMT`, `samplingTime`, tamanho do vetor de amostras, presença de `saved_data`, dispositivos contra o cadastro.
2. **Ordem de chegada:** para cada pacote, quanto ele está atrás do maior horário já recebido no momento em que chegou (marca d'água). É assim que se separa atraso de transmissão de lacuna de verdade.
3. **Por dispositivo, no tempo:** intervalo entre pacotes, lacunas, sobreposição de amostras, duplicatas e conflitos (mesmo instante com valores diferentes).
4. **Valores:** distribuição, códigos de erro conhecidos do sensor, picos em relação às vizinhas, sequências de valor idêntico.

## O que foi encontrado

| Item                     | Quantidade                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| Pacotes (linhas)         | 180.951, todos com JSON e esquema válidos                                        |
| Período                  | 12/01/2026 00:05 a 10/02/2026 23:59 (horário local, `GMT` -3 em todos)           |
| Dispositivos             | 25 do cadastro, cerca de 7.200 pacotes cada, mais o **IOT099**, fora do cadastro |
| Formato                  | sempre 12 amostras de 30 s por pacote (6 minutos)                                |
| Amostras únicas na série | 2.152.464                                                                        |

### Anomalias

| Anomalia                         | Ocorrências                                          | Evidência                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pacote duplicado exato           | 1.099 (0,6%)                                         | mesmo dispositivo, horário e conteúdo; nenhum conflito de valor                                                                                                                            |
| Pacote atrasado com `saved_data` | 247, dos quais 239 chegaram de 15 min a 5,7 h depois | IOT003, IOT006, IOT011, IOT017, IOT022 e IOT024 ficaram sem comunicação e enviaram o que tinham guardado ao voltar; nenhum pacote sem `saved_data` chegou atrasado                         |
| Código -127                      | 286 amostras, 9 pacotes inteiros                     | valor do DS18B20 com o sensor desconectado                                                                                                                                                 |
| Código 85                        | 47 amostras, todas na primeira posição do pacote     | valor de power-on do DS18B20: cada dispositivo reiniciou ao menos uma vez, e na maioria dos reinícios a fase da amostragem mudou junto (intervalo entre pacotes fora do múltiplo de 6 min) |
| Sensor travado                   | 2 episódios, 2.613 amostras                          | IOT009 em 23,2 °C por 10 h 54 min (21 para 22/01) e IOT014 em 22,8 °C por 10 h 52 min (30 para 31/01), terminando num salto de 3,9 °C. Fora disso, nenhuma sequência idêntica chega a 1 h  |
| Dispositivo fora do cadastro     | IOT099, 481 pacotes em 01 e 02/02                    |                                                                                                                                                                                            |
| Lacuna sem dado                  | 6 trechos de 2,4 a 5,9 h                             | IOT004, IOT007, IOT010, IOT014, IOT020 e IOT023, sem `saved_data` para cobrir                                                                                                              |
| Pacote perdido isolado           | cerca de 370                                         | intervalo de 12 min entre pacotes consecutivos                                                                                                                                             |

Não apareceram:
- JSON inválido;
- horário malformado ou adiantado;
- pacote fora de ordem sem `saved_data`;
- amostras sobrepostas com valores diferentes;
- valores fisicamente impossíveis além dos códigos de erro;
- picos isolados. A maior variação entre amostras de 30 s é de 3,9 °C, no fim de um travamento.

As regras para esses casos existem e são testadas mesmo assim, porque a produção vai trazê-los.

## Como cada caso é tratado

| Caso                                                                                                                    | Onde              | Tratamento                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linha inválida (JSON, esquema, data)                                                                                    | ingestão          | vai para o cru com `valid = false` e o motivo; não derruba a ingestão                                                                                    |
| Relógio adiantado (mais de 10 min à frente do "agora", sem outro dispositivo cadastrado confirmando um horário próximo) | ingestão          | vai para o cru com `error = 'timestamp_futuro'`; fica fora da série e não adianta o "agora", e aparece no relatório (regra defensiva; não ocorreu)       |
| Duplicata                                                                                                               | série             | chave (dispositivo, instante): a primeira gravação vence; o cru guarda todas as chegadas                                                                 |
| Pacote atrasado                                                                                                         | série e agregados | amostras entram no instante correto; os agregados contínuos daquele trecho são recalculados; o contato do dispositivo é registrado no "agora" da chegada |
| Código -127 ou 85                                                                                                       | série             | `quality = 1` (erro do sensor)                                                                                                                           |
| Fora da faixa física (abaixo de -20 °C ou acima de 60 °C)                                                               | série             | `quality = 2` (regra defensiva; não ocorreu)                                                                                                             |
| Pico isolado (3 °C ou mais acima ou abaixo das duas vizinhas válidas)                                                   | série             | `quality = 3` (regra defensiva; não ocorreu). Degraus, quando o valor muda e permanece, não são picos                                                    |
| Sensor travado (valor idêntico por 60 min ou mais)                                                                      | série             | `quality = 4`, inclusive o começo da sequência, já gravado (remarcado no banco)                                                                          |
| Dispositivo fora do cadastro                                                                                            | estado            | quarentena em `state.unknown_device`; não entra na série nem nos indicadores                                                                             |
| Lacuna                                                                                                                  | consulta          | trecho de 10 min ou mais sem leitura válida vira indisponibilidade "sem dados" ou "leitura descartada", com o motivo predominante                        |

Nenhuma leitura é apagada. As descartadas ficam na série com o código de qualidade, e os agregados contam cada motivo à parte. Assim o gráfico mostra o porquê de cada buraco, e uma mudança de regra pode ser reprocessada (`replay --rebuild`).

## Efeito nos indicadores

- Conforto é calculado só sobre leituras válidas no horário de funcionamento; lacunas não contam como dentro nem fora da faixa.
- A **cobertura** mostra quanto do horário de funcionamento teve leitura válida. Ela deixa explícito quando um percentual de conforto vale para pouco tempo de dado.
- Um sensor travado deixa o dispositivo em **falha no sensor** no próprio pacote em que o travamento é detectado. Ele continua comunicando, mas a última leitura válida volta para a de antes da sequência travada.
