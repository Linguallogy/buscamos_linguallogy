-- Linguallogy · buscamos.linguallogy.com
-- Ejecutar una vez en Supabase > SQL Editor (proyecto en región UE).

create table if not exists public.candidaturas (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  estado          text not null default 'nueva',   -- nueva / llamar / descartada / colabora ...
  score           int  not null,
  modalidad       text,                              -- oficina / online / oficina+online (no puntúa)
  flags           text[] default '{}',
  desglose        jsonb,
  nombre          text not null,
  email           text not null,
  contacto        text,
  comentario      text,
  lang_form       text,
  idioma_ensena   text,
  idioma_extra    text[],
  nivel           text,
  ele             text,
  anos            text,
  autonomo        text,
  tarifa          text,
  disponibilidad  jsonb,
  clases_posibles int,
  clases_finde    int,
  volumen         text,
  zonas           text[],
  clientes        text,
  corporativo     text,
  niveles         text[],
  online          text,
  tools           text[],
  idiomas         text[],
  idiomas_otros   text,
  b2c             text,
  b2c_tarifa      numeric,
  dele            text,
  situacion       text,
  enlaces         text,
  fuente          text,
  bolsa           boolean not null default false,
  notas           text,                              -- notas internas de Ilya
  cv_path         text                               -- archivo en el bucket privado «cv»
);

-- Nadie entra desde el navegador: solo la función de Netlify con la service key.
alter table public.candidaturas enable row level security;

-- Solo la clave secreta (service_role) puede leer y escribir
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.candidaturas to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ranking para revisar (Table Editor > candidaturas_ranking)
create or replace view public.candidaturas_ranking with (security_invoker = true) as
select id, created_at, estado, score, modalidad, flags,
       case when score >= 70 then 'llamar'
            when score >= 60 then 'revisar a mano'
            else 'ranking' end as revisar,
       nombre, email, contacto, idioma_ensena, nivel, ele, anos, zonas, clases_posibles, volumen,
       tarifa, enlaces, situacion, comentario, bolsa, cv_path
from public.candidaturas
order by score desc, created_at desc;

-- Borrado automático: 3 meses sin casilla de bolsa, 12 meses con ella.
create extension if not exists pg_cron;
select cron.schedule(
  'borrar-candidaturas-caducadas',
  '15 3 * * *',
  $$ delete from public.candidaturas
     where cv_path is null
       and ((bolsa = false and created_at < now() - interval '3 months')
        or (created_at < now() - interval '12 months')) $$
);
