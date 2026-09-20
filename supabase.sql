-- Rode isto uma vez no Supabase: menu SQL Editor > New query > Run.
-- Cria a tabela de leads e tranca o acesso: só o servidor (service_role) entra.

create table if not exists public.leads (
  id                bigint generated always as identity primary key,
  criado_em         timestamptz not null default now(),
  nome              text        not null,
  whatsapp          text        not null,   -- como a pessoa digitou: (47) 99930-7777
  whatsapp_digitos  text        not null,   -- só números, para deduplicar
  empresa           text,
  atividade         text,
  faturamento_mes   numeric,
  consentimento     boolean     not null default false,
  origem            text
);

create index if not exists leads_criado_em_idx on public.leads (criado_em desc);

-- Row Level Security ligado e nenhuma policy criada de propósito:
-- a chave pública (anon) não lê nem grava nada. Só a service_role,
-- que fica na função da Vercel, tem acesso.
alter table public.leads enable row level security;
