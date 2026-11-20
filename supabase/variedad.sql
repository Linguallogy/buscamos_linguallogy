-- Variedad / acento del profesor (opcional, no puntúa)
alter table public.candidaturas add column if not exists variedad text;

drop view if exists public.candidaturas_ranking;
create view public.candidaturas_ranking with (security_invoker = true) as
select id, created_at, estado, score, modalidad, flags,
       case when score >= 70 then 'llamar'
            when score >= 60 then 'revisar a mano'
            else 'ranking' end as revisar,
       nombre, email, contacto, idioma_ensena, variedad, nivel, ele, anos, zonas, clases_posibles, volumen,
       tarifa, enlaces, situacion, comentario, bolsa, cv_path
from public.candidaturas
order by score desc, created_at desc;

grant select on table public.candidaturas_ranking to service_role;
