// Edge Function "calendar": devuelve tus vencimientos pendientes como calendario (.ics) para suscribirse
// desde el celular. URL: https://<proyecto>.supabase.co/functions/v1/calendar?token=...&before=1
// Debe publicarse SIN verificación de JWT (los calendarios no pueden enviar credenciales); el acceso lo
// protege el token secreto de la tabla calendar_feed.

type Payment = {
  id: string; title: string; due_date: string; recurrence: string;
  amount: number | string | null; notes: string | null; paid_dates: string[] | null;
};
type Occ = { id: string; title: string; amount: number | null; notes: string; date: string };

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Vencimientos PENDIENTES entre from y to (misma lógica que la app: los mensuales caen el mismo día
// de cada mes, o el último día si el mes es más corto).
export function pending(payments: Payment[], from: string, to: string): Occ[] {
  const out: Occ[] = [];
  for (const p of payments) {
    const paid = new Set((p.paid_dates || []).map(String));
    const push = (date: string) => {
      if (paid.has(date)) return;
      out.push({ id: p.id, title: p.title, amount: p.amount === null || p.amount === undefined ? null : Number(p.amount), notes: p.notes || "", date });
    };
    if (p.recurrence !== "monthly") {
      if (p.due_date >= from && p.due_date <= to) push(p.due_date);
      continue;
    }
    const day = +p.due_date.slice(8, 10);
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const ty = +to.slice(0, 4), tm = +to.slice(5, 7);
    for (let g = 0; g < 600 && (y < ty || (y === ty && m <= tm)); g++) {
      const date = iso(y, m, Math.min(day, daysIn(y, m)));
      if (date >= p.due_date && date >= from && date <= to) push(date);
      if (++m > 12) { m = 1; y++; }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const money = (v: number) => "$" + new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v);

// Plegado de líneas a 75 bytes (RFC 5545), sin cortar caracteres UTF-8 a la mitad.
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ""; bytes = 0; limit = 74; }
    cur += ch; bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// before: además del aviso de las 9:00 del día, un aviso N días antes a las 9:00 (0 = ninguno).
export function buildICS(payments: Payment[], today: string, before: number, now = new Date()): string {
  const occ = pending(payments, addDays(today, -30), addDays(today, 400));
  const L: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Finanzas personales//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Pagos", "X-WR-TIMEZONE:America/Argentina/Buenos_Aires",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const o of occ) {
    const d = o.date.replace(/-/g, "");
    const alarm = (trigger: string) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc("Vence hoy o pronto: " + o.title)}`, `TRIGGER:${trigger}`, "END:VALARM"];
    L.push(
      "BEGIN:VEVENT", `UID:${o.id}-${d}@finanzas-personales`, `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(o.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${esc("Pagar: " + o.title + (o.amount !== null ? " (" + money(o.amount) + ")" : ""))}`,
      ...(o.notes ? [`DESCRIPTION:${esc(o.notes)}`] : []),
      "TRANSP:TRANSPARENT",
      ...alarm("PT9H"),                                           // 09:00 del día del vencimiento
      ...(before > 0 ? alarm(`-PT${24 * before - 9}H`) : []),     // 09:00, N días antes
      "END:VEVENT",
    );
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

// ---- servidor ----
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const notFound = () => new Response("Not found", { status: 404 });
  if (token.length < 32) return notFound();

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: feed } = await sb.from("calendar_feed").select("user_id").eq("token", token).maybeSingle();
  if (!feed) return notFound();

  const { data, error } = await sb.from("payments")
    .select("id,title,due_date,recurrence,amount,notes,paid_dates").eq("user_id", feed.user_id);
  if (error) return new Response("Error", { status: 500 });

  const before = Math.min(7, Math.max(0, parseInt(url.searchParams.get("before") || "0", 10) || 0));
  const ar = new Date(Date.now() - 3 * 3600 * 1000); // hoy en Argentina (UTC-3, sin horario de verano)
  const today = iso(ar.getUTCFullYear(), ar.getUTCMonth() + 1, ar.getUTCDate());
  return new Response(buildICS(data as Payment[], today, before), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache", "content-disposition": 'inline; filename="pagos.ics"' },
  });
});
