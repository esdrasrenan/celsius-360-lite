# Sistema visual

A identidade da Diel (o símbolo, o degradê ciano → celsius, Inter e Fira Code do site oficial) foi aplicada como um sistema, e não como cores soltas. Toda cor é um token, todo texto é um estilo da escala, e duas checagens automáticas impedem que o código fuja disso.

O código está em `apps/web/src/styles.css`, `apps/web/src/lib/states.ts`, `apps/web/src/lib/format.ts` e `apps/web/src/components/`.

## Princípios

1. **A cor só aparece para estado, dado ou interação.** O normal fica silencioso: ambiente online e na faixa não vira pílula verde. Toda exceção tem um segundo sinal além da cor (ícone, seta, hachura ou texto).
2. **A hierarquia vem da tipografia e do espaço.** Borda só onde há agrupamento ou interação, sem cartão dentro de cartão.
3. **Exceção primeiro.** A visão da rede ordena por gravidade e abre as lojas com problema.
4. **Uma cor, um significado.** Um único mapa (`lib/states.ts`) liga cada estado ao rótulo, ao tom, ao ícone e à dica. Lista, badge, gráfico, legenda e filtros leem dele.
5. **Todo número tem unidade, contexto e definição.** A unidade vai junto do valor, a comparação vai na linha de contexto, e a fórmula fica num popover que também funciona no toque.
6. **O horário da loja é a verdade.** Eixos, dicas e rótulos do detalhe usam o fuso da loja, declarado na tela ("horário de Recife (UTC−3)").

## Tokens em três camadas

| Camada     | Exemplos                                                                                                         | Quem usa                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Primitivas | `--p-tinta`, `--p-celsius`, `--p-ciano`, neutros `--p-n0` a `--p-n900` puxados para a tinta                      | só `styles.css`                                                        |
| Semânticas | `fundo`, `superficie`, `texto`, `texto-3`, `borda-controle`, `acento`, `alerta-texto`, `quente`, `frio`, `faixa` | componentes, via classes do Tailwind (`bg-superficie`, `text-texto-3`) |
| Gráfico    | `--grafico-temperatura`, `--grafico-faixa`, `--grafico-sem-dados`, `--grafico-externa`                           | o ECharts, que as lê com `getComputedStyle` (`lib/chart-theme.ts`)     |

As escalas padrão do Tailwind (cores, tamanhos de texto, raios, sombras, larguras) foram zeradas com `--color-*: initial` e similares. Fora dos tokens, nada existe: uma classe como `text-gray-500` simplesmente não gera CSS.

### Estados

Cada tom tem quatro variantes: sólido (ponto, barra, ícone), texto, fundo e borda.

| Tom                | Significa                                                           | Nunca usar para                |
| ------------------ | ------------------------------------------------------------------- | ------------------------------ |
| `ok`               | online, melhora                                                     | "na faixa" (o normal é neutro) |
| `alerta`           | severidade média: falha no sensor, fora da meta, leitura descartada | direção térmica                |
| `falha`            | offline, conforto crítico, erro                                     | —                              |
| `neutro`           | sem dados, sem leitura                                              | lacuna (lacuna é hachura)      |
| `quente` / `frio`  | direção térmica: acima ou abaixo da faixa                           | severidade                     |
| `acento` (celsius) | interação: link, seleção, foco, zoom                                | estado                         |

O âmbar do alerta e o laranja do quente colidem para quem tem deuteranopia (ΔE 1,4). A solução é de canal: quente sempre tem seta ↑ e alerta sempre tem △. Os dois nunca dividem o mesmo elemento.

### Contraste verificado

`apps/web/src/styles/contrast.test.ts` lê o `styles.css`, resolve os tokens e confere a fórmula do WCAG 2: 4,5:1 para texto, 3:1 para objeto gráfico e borda de controle. Alguns pares:

| Par                                                   | Razão                                                 |
| ----------------------------------------------------- | ----------------------------------------------------- |
| texto / branco                                        | 17,34                                                 |
| texto-3 (rótulos, eixos) / branco · gelo              | 5,66 · 5,26                                           |
| borda de controle / branco                            | 3,42                                                  |
| alerta-texto / alerta-fundo                           | 5,56                                                  |
| quente-texto / quente-fundo · frio-texto / frio-fundo | 5,26 · 5,86                                           |
| limites da faixa no gráfico / branco                  | 4,27 (o ciano da marca dá 2,38, por isso só preenche) |

## Tipografia

Inter com `cv11` e `ss01`, três pesos (400, 500 e 600) e uma escala de dez estilos. O mínimo é 12 px. Números tabulares (`num`) aparecem em KPI, coluna, contador e dica.

| Estilo                        | Tamanho e entrelinha  | Uso                                                  |
| ----------------------------- | --------------------- | ---------------------------------------------------- |
| `text-legenda`                | 12/16                 | badge, eixo, cabeçalho de tabela, contexto de KPI    |
| `text-apoio`                  | 13/18                 | rótulo de KPI, breadcrumb, metadado                  |
| `text-corpo`                  | 14/20                 | padrão da interface                                  |
| `text-corpo-lg`               | 16/24                 | introdução e inputs no celular (evita o zoom do iOS) |
| `text-titulo-3` / `-2` / `-1` | 16, 20, 24 (peso 600) | cartão, seção, página                                |
| `text-kpi`                    | 28/32                 | valor de indicador                                   |
| `text-destaque`               | 40/44                 | última leitura no detalhe                            |
| `text-display`                | 36 a 44               | só a manchete do login                               |

Fira Code aparece só em identificadores (`IOT014`, `requestId`) e em comandos de terminal.

## Raios, sombras e movimento

- **Raios aninhados:** o interno é o externo menos o padding. Cartão 20 (o raio da proposta de site da Diel), popover 12, controle 8, segmento 6, barra 4.
- **Sombras tingidas de tinta, nunca preto.** Elas vêm em camadas, com um anel de 1 px no lugar da borda.
- **Movimento curto e com ease-out.**
  - Durações: 100 ms no hover, 150 ms na entrada de popover, 200 ms em gaveta e chevron.
  - Troca de período, filtro e ordenação não anima.
  - Pulso contínuo só no ponto "Ao vivo".
  - Com `prefers-reduced-motion`, ficam só opacidade e cor, e o gráfico desliga a animação.

## Assinaturas da marca

O degradê ciano → celsius aparece em seis lugares e só neles:

- o painel do login e os logotipos;
- a barra de 3 px do KPI herói "Conforto da rede";
- o traço sob o item de navegação ativo;
- a barra de progresso da recarga;
- a faixa de conforto, em ciano;
- a alça do zoom do gráfico, no formato da régua do site.

Nunca vai em número, texto de dado ou série do gráfico.

## Texto

- **Sentence case em tudo.** Caixa alta só em nome próprio, sigla ou identificador. Nenhum `text-transform` no CSS.
- **Botões com verbo e objeto:** "Limpar filtros", "Baixar CSV", "Ver no gráfico".
- **Números com `Intl` (`lib/format.ts`):**
  - temperatura com espaço inseparável: "24,5 °C";
  - faixa com meia-risca: "21–25 °C";
  - desvio com sinal tipográfico: "−0,6 °C".
- **Percentuais:**
  - arredondados para baixo, para "100%" aparecer só quando é exato;
  - "<0,1%" em vez de um zero que não é zero.
- **Durações:**
  - nunca "1 h 60 min";
  - nunca em "dias" para tempo de expediente, que aparece em horas.
- **Ausência:** "—", com a dica "Sem leitura válida no período". Ausência nunca vira 0.

## Componentes

Os primitivos com teclado, foco e ARIA vêm do [Base UI](https://base-ui.com) 1.9 (versão exata). O visual é todo nosso, sobre os tokens:

| Componente         | Base             | Detalhe                                                                                           |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| `Select`           | Base UI Select   | Chevron a 12 px da borda, prefixo ("Ordenar por") e texto auxiliar à direita.                     |
| `Combobox`         | Base UI Combobox | Busca sem acento. Entra no lugar do Select de cliente quando há mais de 7 clientes.               |
| `Hint`             | Base UI Tooltip  | Complementa: informação essencial nunca fica só na dica.                                          |
| `TruncatedText`    | —                | Mostra a dica só quando o texto foi cortado. Com `wrapOnMobile`, quebra a linha abaixo de 768 px. |
| `Definition`       | Base UI Popover  | Fórmula dos indicadores, com hover e toque.                                                       |
| `Menu`             | Base UI Menu     | Exportação e menu do usuário.                                                                     |
| `Sheet`            | Base UI Dialog   | Gaveta de filtros no celular.                                                                     |
| `SegmentedControl` | rádios nativos   | Período, com pré-carga no hover.                                                                  |
| `Kpi`              | —                | Rótulo, definição, valor com unidade e contexto; variante que filtra a lista.                     |
| `ComfortBar`       | —                | Na faixa, abaixo e acima, com a marca da meta e o aviso de cobertura baixa.                       |
| `EmptyState`       | —                | Sempre com o próximo passo.                                                                       |
| `ErrorState`       | —                | Mensagem em português por status, "Tentar de novo" e o `requestId` para copiar.                   |

## Gráfico de temperatura

Em ECharts, montado em camadas. Cada camada é uma série nomeada que a legenda liga e desliga:

- loja fechada;
- faixa de conforto, só dentro do expediente;
- sem dados e leitura descartada, cada uma com sua hachura;
- variação mín–máx;
- período anterior;
- temperatura externa;
- temperatura, com cor por situação: tinta na faixa, laranja acima, azul abaixo, cinza com a loja fechada.

Abaixo do plot, uma tira mostra a situação ao longo do tempo. O tooltip é montado com `textContent`, porque nomes e motivos vêm da API. Ele mostra o intervalo do bucket, o desvio da faixa e o motivo de cada lacuna.

Os ticks do eixo são calculados no fuso da loja, não no do navegador. O zoom só responde a Ctrl + rolagem, para não prender a rolagem da página. O gráfico responde ao teclado e tem um resumo em texto para leitor de tela.

## Garantias verificáveis

| Comando                        | O que garante                                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint:ui`              | Reprova o front se encontrar qualquer um destes: valor arbitrário do Tailwind (`text-[13px]`), cor fora do `styles.css`, `uppercase`, atributo `title`, `<select>` nativo ou `transition: all`. |
| `bun test apps/web/src/styles` | Contraste dos pares da tabela acima.                                                                                                                                                            |
| `bun test apps/web/src/lib`    | Formatação de números, durações, datas e plurais.                                                                                                                                               |
| `bun run test:e2e`             | Em 320, 390, 768, 820 e 1440 px: sem rolagem horizontal, sem texto abaixo de 12 px, sem caixa alta e sem `title`.                                                                               |
