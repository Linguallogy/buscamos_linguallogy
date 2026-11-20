-- Permisos para que la función de Netlify (clave secreta / service_role) pueda guardar candidaturas.
-- En los proyectos nuevos de Supabase las tablas creadas por SQL no siempre reciben estos permisos.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.candidaturas to service_role;
grant select on table public.candidaturas_ranking to service_role;
grant usage, select on all sequences in schema public to service_role;
