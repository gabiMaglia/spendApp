-- ADR-004 fase B — resolver las claves de una persona, no de un proveedor.
--
-- PROBLEMA
-- `device_keys.account_id` es el `sub` del proveedor OAuth, así que la MISMA
-- persona con Google en un teléfono y Apple en otro registra sus dos claves
-- bajo dos `account_id` distintos. Un lector que sólo conoce uno de ellos no
-- encuentra la clave del otro dispositivo y, al encender el rechazo, descarta
-- sobres perfectamente legítimos.
--
-- SOLUCIÓN
-- `owner` es el usuario de Supabase, no el proveedor: cuando Supabase pudo
-- vincular las dos identidades, los dos dispositivos comparten `owner` aunque
-- difieran en `account_id`. Resolver por `owner` cubre ese caso solo.
--
-- LO QUE ESTO **NO** ARREGLA
-- Apple manda el claim `email` sólo en la primera autorización. Sin email
-- Supabase no puede vincular, y esa persona termina siendo OTRO `owner`. Ese
-- borde sigue abierto y es la razón por la que la fase B debe arrancar en modo
-- AVISO y no en modo rechazo: hay que medir cuánto pega antes de descartar
-- nada. Ver `docs/ADR-004-identidad-por-cuenta.md`.
--
-- SOBRE LA PRIVACIDAD
-- No expone nada nuevo. La política de lectura de `device_keys` ya es
-- `using (true)` y la tabla ya trae `owner`, así que cualquiera con la anon key
-- podía hacer este mismo join a mano. La regla del PO se respeta: acá hay
-- cuentas y claves públicas, nunca gastos.

create or replace function public.account_keys(p_account_id text)
returns table (public_key text)
language sql
stable
-- SIN `security definer` a propósito: la política de select ya es abierta, así
-- que los permisos del invocante alcanzan. Un definer acá sería superficie de
-- ataque regalada.
set search_path = public
as $$
  select distinct dk.public_key
  from public.device_keys dk
  where dk.account_id = p_account_id
     -- Los demás dispositivos de la misma persona, aunque hayan entrado por
     -- otro proveedor.
     or dk.owner in (
       select o.owner
       from public.device_keys o
       where o.account_id = p_account_id
     );
$$;

-- Verificar una firma no requiere sesión: por eso también anon.
grant execute on function public.account_keys(text) to anon, authenticated;
