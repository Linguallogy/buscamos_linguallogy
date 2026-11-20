-- Ejecutar una vez (ya existe la tabla): añade el CV en PDF
alter table public.candidaturas add column if not exists cv_path text;

create or replace view public.candidaturas_ranking with (security_invoker = true) as
select id, created_at, estado, score, modalidad, flags,
       case when score >= 70 then 'llamar'
            when score >= 60 then 'leer situación'
            else 'ranking' end as revisar,
       nombre, email, contacto, idioma_ensena, nivel, ele, anos, zonas, clases_posibles, volumen,
       tarifa, enlaces, situacion, comentario, bolsa, cv_path
from public.candidaturas
order by score desc, created_at desc;

-- Las filas con CV las borra la función nocturna de Netlify (borra antes el PDF); aquí solo las que no tienen CV
select cron.unschedule('borrar-candidaturas-caducadas');
select cron.schedule(
  'borrar-candidaturas-caducadas',
  '15 3 * * *',
  $$ delete from public.candidaturas
     where cv_path is null
       and ((bolsa = false and created_at < now() - interval '3 months')
        or (created_at < now() - interval '12 months')) $$
);
