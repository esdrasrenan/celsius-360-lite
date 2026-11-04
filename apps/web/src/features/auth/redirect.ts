/**
 * Destino depois do login (P0 #5). Só caminho interno: "//host" e "/\host" são outro site para o
 * navegador (e derrubavam a tela com "External navigation is not allowed"). Caractere de controle
 * também sai, porque o navegador o descarta e "/\t/host" viraria "//host".
 */
export function safeRedirect(value: string | null | undefined): string {
  return value && /^\/(?![/\\])\P{Cc}*$/u.test(value) ? value : '/'
}

/** /entrar com o caminho de volta; com a sessão expirada, o login mostra o aviso. */
export function loginPath(from: string, expired: boolean): string {
  const params = new URLSearchParams()
  if (from !== '/') params.set('voltar', from)
  if (expired) params.set('motivo', 'expirada')
  const query = params.toString()
  return query ? `/entrar?${query}` : '/entrar'
}
