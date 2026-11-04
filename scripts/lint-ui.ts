/**
 * Guarda do sistema visual (critério 8.1 da especificação): procura no front o que os tokens
 * proíbem. Roda igual em PowerShell, cmd e bash:
 *
 *   bun run scripts/lint-ui.ts
 *
 * Imprime arquivo:linha: regra: trecho e sai com código 1 se achar alguma ocorrência.
 */
import { resolve } from 'node:path'

interface Rule {
  name: string
  pattern: RegExp
}

const RULES: Rule[] = [
  // A sintaxe -(--token) é permitida: a regra só pega o colchete
  { name: 'valor arbitrário do Tailwind', pattern: /(?<![\w&])[a-z][a-z0-9-]*-\[[^\]\s]+\]/g },
  { name: 'variante arbitrária', pattern: /\[&/g },
  { name: 'cor hexadecimal fora de styles.css', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'cor funcional fora de styles.css', pattern: /\b(rgba?|hsla?|oklch)\(/g },
  { name: 'caixa alta por CSS', pattern: /\buppercase\b|text-transform/g },
  { name: '<select> nativo', pattern: /<select\b/g },
  { name: 'transition all', pattern: /transition-all|transition:\s*all/g },
]

// title= em elemento intrínseco (<span title=…>); props de componente (<EmptyState title=…>) passam
const INTRINSIC_TITLE = /<([a-z][a-z0-9]*)(?=[\s/>])[^<>]*?\stitle=/g

const root = resolve(import.meta.dir, '..')
const base = resolve(root, 'apps/web/src')
const glob = new Bun.Glob('**/*.{ts,tsx}')

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

const findings: string[] = []
for await (const path of glob.scan({ cwd: base })) {
  const file = path.replaceAll('\\', '/')
  if (/\.test\.tsx?$/.test(file)) continue
  const text = await Bun.file(resolve(base, path)).text()
  const report = (index: number, rule: string, excerpt: string) =>
    findings.push(`apps/web/src/${file}:${lineOf(text, index)}: ${rule}: ${excerpt.trim().slice(0, 80)}`)

  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) report(match.index, rule.name, match[0])
  }
  for (const match of text.matchAll(INTRINSIC_TITLE)) {
    const at = match.index + match[0].lastIndexOf('title=')
    report(at, `atributo title em <${match[1]}>`, 'title=')
  }
}

findings.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
for (const line of findings) console.info(line)
if (findings.length > 0) {
  console.error(`\n${findings.length} ocorrência(s). Use os tokens e utilitários de apps/web/src/styles.css.`)
  process.exit(1)
}
console.info('lint-ui: nenhuma ocorrência.')
