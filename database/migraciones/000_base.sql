-- =====================================================================
--  000 · Esquemas y privilegios base
--  Las migraciones las aplica el servicio Node (realtime/migrar.js) con el superusuario,
--  en orden, una sola vez cada una (tabla public._migraciones). NUNCA edites una migración
--  ya aplicada: crea una nueva con el siguiente número.
-- =====================================================================

-- app = funciones internas (no publicadas)   api = funciones que publica PostgREST (/rest/v1/rpc/...)
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION mana_owner;
CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION mana_owner;
GRANT USAGE, CREATE ON SCHEMA public TO mana_owner;

-- Los perfiles de Maná apuntan a los usuarios de GoTrue (auth.users)
GRANT USAGE ON SCHEMA auth TO mana_owner, mana_servicio;
GRANT REFERENCES ON auth.users TO mana_owner;
GRANT SELECT (id, email) ON auth.users TO mana_servicio;   -- comprobar correos repetidos en las altas

-- Ninguna función queda ejecutable por todos: se conceden una por una
ALTER DEFAULT PRIVILEGES FOR ROLE mana_owner   REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mana_auditor REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA app, api, public TO anon, authenticated, mana_auditor, mana_servicio;
