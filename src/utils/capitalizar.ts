// Primera letra en mayúscula, sin tocar el resto (PO 2026-09-22): el nombre
// se guarda tal como el usuario lo escribió — si tipeó "gabriel" en minúscula,
// eso es lo que persiste. La UI es quien decide mostrarlo prolijo, sin pisar
// el dato real (no hace un .toUpperCase() del resto, que rompería nombres
// como "McKenzie" o "O'Connor" si algún día llegan de un proveedor).
export function capitalizar(nombre: string): string {
  if (!nombre) return nombre;
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}
