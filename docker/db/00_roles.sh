#!/bin/sh
# Se ejecuta UNA sola vez, cuando el volumen de PostgreSQL está vacío.
# Crea los roles que usan GoTrue, PostgREST y el servicio Node. Las tablas, políticas RLS
# y funciones las crean las migraciones (database/migraciones), que aplica el servicio Node.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
  ALTER DATABASE mana SET timezone TO 'America/Bogota';

  -- Roles que PostgREST asume según el JWT (claim "role")
  CREATE ROLE anon          NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS;

  -- Usuario con el que PostgREST se conecta (solo puede "convertirse" en anon/authenticated)
  CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${AUTHENTICATOR_PASSWORD}';
  GRANT anon, authenticated TO authenticator;

  -- GoTrue guarda los usuarios y contraseñas cifradas en su propio esquema "auth"
  CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE PASSWORD '${AUTH_DB_PASSWORD}';
  CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
  GRANT CREATE, CONNECT ON DATABASE mana TO supabase_auth_admin;
  ALTER ROLE supabase_auth_admin SET search_path = auth;

  -- Dueño de las tablas (NO es superusuario: con FORCE ROW LEVEL SECURITY también obedece RLS)
  CREATE ROLE mana_owner NOLOGIN;
  -- Dueño de las funciones auxiliares que deben leer el perfil del usuario sin pasar por RLS
  CREATE ROLE mana_auditor NOLOGIN BYPASSRLS;
  -- Servicio Node (tareas programadas, alta de restaurantes y empleados, tiempo real)
  CREATE ROLE mana_servicio LOGIN BYPASSRLS PASSWORD '${SERVICIO_DB_PASSWORD}';
EOSQL
