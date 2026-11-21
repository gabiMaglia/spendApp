/** Ruta de «Ver todos»: el mes viaja por parámetro porque Personal lo guarda en estado local. */
export function rutaVerTodos(month: string) {
  return { pathname: '/personal/movimientos', params: { month } } as const;
}

/** Un param ausente o mal formado (deep link) cae al mes corriente en vez de romper. */
export function mesDeParams(param: string | string[] | undefined, corriente: string): string {
  const v = Array.isArray(param) ? param[0] : param;
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : corriente;
}
