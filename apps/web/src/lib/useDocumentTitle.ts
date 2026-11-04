import { useEffect } from 'react'

const APP_TITLE = 'Celsius 360'

/** "Visão da rede · Celsius 360"; partes vazias (dado ainda carregando) ficam de fora. */
export function documentTitle(...parts: Array<string | null | undefined>): string {
  return [...parts.filter(Boolean), APP_TITLE].join(' · ')
}

/**
 * Título da aba por tela (seção 3.14): "Salão de vendas - Vitrine · Loja Boa Viagem · Celsius 360".
 * Sem limpeza ao sair: toda rota define o próprio título, e restaurar o anterior aqui sobrescreveria
 * o <title> que o React 19 põe à frente no <head> quando a tela seguinte usa o elemento.
 */
export function useDocumentTitle(...parts: Array<string | null | undefined>) {
  const title = documentTitle(...parts)
  useEffect(() => {
    document.title = title
  }, [title])
}
