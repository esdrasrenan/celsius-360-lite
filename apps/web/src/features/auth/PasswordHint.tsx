import { CopyButton } from '../../components/CopyButton'

/*
 * De onde vem a senha: a DEMO_PASSWORD do .env (os scripts de subida a criam) ou, sem ela, a que o
 * setup gera e mostra no log. Cada comando cobre os dois casos e roda no Windows PowerShell 5.1 e
 * no bash, na pasta do projeto.
 */
const COMMANDS = [
  {
    shell: 'PowerShell',
    command: "Select-String '^DEMO_PASSWORD=.' .env; docker compose logs setup | Select-String senha",
  },
  {
    shell: 'bash ou zsh',
    command: "grep '^DEMO_PASSWORD=.' .env; docker compose logs setup | grep -i senha",
  },
] as const

const Code = ({ children }: { children: string }) => (
  <code className="id-tecnico text-texto-2">{children}</code>
)

/** Bloco "onde está a senha" do login (seção 4.1, item 7). */
export function PasswordHint() {
  return (
    // Sem nome acessível próprio: um bloco rotulado com "senha" disputaria o getByLabel('Senha')
    <div className="flex flex-col gap-3 rounded-md bg-superficie-3 p-3 text-apoio text-texto-2">
      <p>
        A senha é a mesma para todos os perfis: a <Code>DEMO_PASSWORD</Code> do seu <Code>.env</Code> ou a
        gerada na primeira subida. Para vê-la, na pasta do projeto:
      </p>
      <ul className="flex flex-col gap-2">
        {COMMANDS.map(({ shell, command }) => (
          <li key={shell} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-legenda text-texto-3">{shell}</span>
              <CopyButton text={command} label="Copiar comando" showLabel className="-me-1" />
            </div>
            <code className="id-tecnico block rounded-sm bg-superficie px-2.5 py-2 text-texto-2 ring-1 ring-borda ring-inset">
              {command}
            </code>
          </li>
        ))}
      </ul>
      <p className="text-texto-3">
        Para trocar, defina <Code>DEMO_PASSWORD</Code> no <Code>.env</Code> (8 caracteres ou mais) e rode{' '}
        <Code>docker compose up -d</Code>.
      </p>
    </div>
  )
}
