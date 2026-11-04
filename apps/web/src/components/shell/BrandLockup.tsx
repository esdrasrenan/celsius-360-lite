/** Logotipo Diel (24 px), divisória e lockup Celsius 360 (16 px), como no cabeçalho. */
export function BrandLockup() {
  return (
    <span className="flex shrink-0 items-center gap-3">
      <img src="/marca/diel-logotipo.svg" alt="" className="h-6 w-auto" />
      <span aria-hidden="true" className="h-5 w-px bg-borda-forte" />
      <img src="/marca/celsius-360.svg" alt="" className="h-4 w-auto" />
    </span>
  )
}

// Sem repetir "Visão da rede": o item da navegação é o único link com esse nome
export const BRAND_HOME_LABEL = 'Celsius 360, início'
