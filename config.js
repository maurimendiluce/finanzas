// Completar con los datos de tu proyecto (Supabase > Project Settings > API).
// La anon key es pública por diseño: la seguridad la da RLS (ver supabase/schema.sql).
window.CONFIG = {
  SUPABASE_URL: "https://gebxenbehwtmyrajoevr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlYnhlbmJlaHd0bXlyYWpvZXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjM0MjAsImV4cCI6MjEwNzEzOTQyMH0.a0viDPJAKtxWbGDwAJXEkLqoMv-1YTWBnR9vjCA79mo",

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
