// Completar con los datos de tu proyecto (Supabase > Project Settings > API).
// La anon key es pública por diseño: la seguridad la da RLS (ver supabase/schema.sql).
window.CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU-ANON-KEY",

  // Estructura de la planilla (filas que siempre se muestran)
  INGRESOS: ["UBA", "CONICET", "FACULTAD", "Paula", "Extra"],
  FIJOS: ["Pañales", "Split", "Ana", "Celular", "Prestamo", "Servicios"],
  TARJETAS: ["Visa Galicia", "Visa Santander", "Visa Nacion", "Master Nacion",
             "Mercado Pago", "Master Galicia", "Visa Ciudad"],
  TARJETA_FILAS: ["Gasto unico", "En cuotas"],

  // Facturas de servicios y qué fracción paga la otra persona (hoja "Servicios")
  FACTURAS: ["Luz", "Agua", "Gas", "ABL"],
  PARTE_OTRA: { Luz: 4 / 7, Agua: 0.5, Gas: 4 / 7, ABL: 0.5 },
  MI_PARTE_DE_LA_CASA: 0.5, // la fila fija "Servicios" = (total casa) * esto
};
