-- =====================================================================
-- SmallPDVMobile — banco de dados (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode ser executado de novo sem perder dados: serve para instalar do
-- zero e também para atualizar um banco criado por uma versão anterior.
--
-- Acesso:
--   * só usuários logados (Supabase Auth) usam o app;
--   * admin   → cadastra fornecedores e produtos, vê o relatório, registra vendas;
--   * demais  → apenas registram vendas.
-- =====================================================================

-- ---------- Perfis (nome de exibição e papel de cada usuário) ----------

create table if not exists public.perfis (
  id        uuid        primary key references auth.users(id) on delete cascade,
  nome      text        not null check (length(trim(nome)) > 0),
  admin     boolean     not null default false,
  criado_em timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário é adicionado no Supabase.
-- Nome inicial = parte do e-mail antes do "@" (dá para trocar no Table Editor).
create or replace function public.criar_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- Usuários que já existiam antes deste script também ganham perfil.
insert into public.perfis (id, nome)
select u.id, split_part(u.email, '@', 1)
  from auth.users u
on conflict (id) do nothing;

-- O usuário logado é admin?
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select admin from public.perfis where id = auth.uid()), false);
$$;

-- ---------- Tabelas ----------

create table if not exists public.fornecedores (
  id        bigint generated always as identity primary key,
  nome      text        not null check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now()
);

-- Não deixa cadastrar o mesmo fornecedor duas vezes ("Loja X" = "loja x ").
create unique index if not exists fornecedores_nome_unico on public.fornecedores (lower(trim(nome)));

create table if not exists public.produtos (
  id          bigint generated always as identity primary key,
  nome        text          not null check (length(trim(nome)) > 0),
  estoque     integer       not null default 0 check (estoque >= 0),
  valor_venda numeric(10,2) not null check (valor_venda >= 0),
  criado_em   timestamptz   not null default now()
);

create table if not exists public.vendas (
  id             bigint generated always as identity primary key,
  -- "restrict": um produto que já teve venda não pode ser excluído
  produto_id     bigint        not null references public.produtos(id) on delete restrict,
  quantidade     integer       not null check (quantidade > 0),
  valor_unitario numeric(10,2) not null check (valor_unitario >= 0),
  valor_total    numeric(12,2) generated always as (quantidade * valor_unitario) stored,
  criado_em      timestamptz   not null default now()
);

-- Fornecedor do produto (opcional por enquanto). "restrict": fornecedor
-- com produtos vinculados não pode ser excluído.
alter table public.produtos
  add column if not exists fornecedor_id bigint references public.fornecedores(id) on delete restrict;

create index if not exists produtos_fornecedor_id_idx on public.produtos (fornecedor_id);

-- Quem registrou a venda (vendas anteriores ao login ficam sem vendedor).
alter table public.vendas
  add column if not exists usuario_id uuid references public.perfis(id) on delete set null;

create index if not exists vendas_produto_id_idx on public.vendas (produto_id);
create index if not exists vendas_criado_em_idx  on public.vendas (criado_em);
create index if not exists vendas_usuario_id_idx on public.vendas (usuario_id);

-- ---------- Registro de venda ----------
-- Baixa o estoque e grava a venda numa única transação. Roda com
-- privilégios do dono (security definer) porque o vendedor não pode
-- alterar produtos diretamente; o vendedor gravado é sempre o usuário
-- logado, então ninguém registra venda em nome de outra pessoa.

create or replace function public.registrar_venda(
  p_produto_id     bigint,
  p_quantidade     integer,
  p_valor_unitario numeric
)
returns public.vendas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venda public.vendas;
begin
  if auth.uid() is null or not exists (select 1 from perfis where id = auth.uid()) then
    raise exception 'Faça login para registrar vendas.';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if p_valor_unitario is null or p_valor_unitario < 0 then
    raise exception 'O valor não pode ser negativo.';
  end if;

  update produtos
     set estoque = estoque - p_quantidade
   where id = p_produto_id
     and estoque >= p_quantidade;

  if not found then
    if not exists (select 1 from produtos where id = p_produto_id) then
      raise exception 'Produto não encontrado.';
    end if;
    raise exception 'Estoque insuficiente para essa quantidade.';
  end if;

  insert into vendas (produto_id, quantidade, valor_unitario, usuario_id)
  values (p_produto_id, p_quantidade, p_valor_unitario, auth.uid())
  returning * into v_venda;

  return v_venda;
end;
$$;

-- ---------- Relatório de venda por produto ----------
-- Sem datas = todo o período. p_fim é exclusivo (vendas antes de p_fim).
-- p_usuario_id = null → todos os vendedores.
-- p_fornecedor_id = null → todos os fornecedores (usa o fornecedor atual
-- do produto). Só o admin recebe linhas.

drop function if exists public.relatorio_vendas(timestamptz, timestamptz);
drop function if exists public.relatorio_vendas(timestamptz, timestamptz, uuid);

create or replace function public.relatorio_vendas(
  p_inicio        timestamptz default null,
  p_fim           timestamptz default null,
  p_usuario_id    uuid        default null,
  p_fornecedor_id bigint      default null
)
returns table (
  produto_id         bigint,
  nome               text,
  quantidade_vendida bigint,
  valor_total        numeric
)
language sql
stable
set search_path = public
as $$
  select p.id,
         p.nome,
         sum(v.quantidade)::bigint,
         sum(v.valor_total)
    from vendas v
    join produtos p on p.id = v.produto_id
   where eh_admin()
     and (p_inicio     is null or v.criado_em >= p_inicio)
     and (p_fim        is null or v.criado_em <  p_fim)
     and (p_usuario_id    is null or v.usuario_id    = p_usuario_id)
     and (p_fornecedor_id is null or p.fornecedor_id = p_fornecedor_id)
   group by p.id, p.nome
   order by sum(v.valor_total) desc, p.nome;
$$;

-- ---------- Permissões ----------

alter table public.perfis       enable row level security;
alter table public.fornecedores enable row level security;
alter table public.produtos     enable row level security;
alter table public.vendas       enable row level security;

-- Remove as políticas da versão sem login (acesso público).
drop policy if exists "pdv_produtos_acesso" on public.produtos;
drop policy if exists "pdv_vendas_leitura"  on public.vendas;
drop policy if exists "pdv_vendas_insercao" on public.vendas;

-- Perfis: cada um vê o próprio; o admin vê todos (para o filtro do relatório).
drop policy if exists "pdv_perfis_leitura" on public.perfis;
create policy "pdv_perfis_leitura" on public.perfis
  for select to authenticated
  using (id = auth.uid() or eh_admin());

-- Fornecedores: só o admin vê e altera.
drop policy if exists "pdv_fornecedores_admin" on public.fornecedores;
create policy "pdv_fornecedores_admin" on public.fornecedores
  for all to authenticated
  using (eh_admin()) with check (eh_admin());

-- Produtos: todo usuário logado vê (para vender); só o admin altera.
drop policy if exists "pdv_produtos_leitura" on public.produtos;
create policy "pdv_produtos_leitura" on public.produtos
  for select to authenticated
  using (true);

drop policy if exists "pdv_produtos_admin_inclui" on public.produtos;
create policy "pdv_produtos_admin_inclui" on public.produtos
  for insert to authenticated
  with check (eh_admin());

drop policy if exists "pdv_produtos_admin_altera" on public.produtos;
create policy "pdv_produtos_admin_altera" on public.produtos
  for update to authenticated
  using (eh_admin()) with check (eh_admin());

drop policy if exists "pdv_produtos_admin_exclui" on public.produtos;
create policy "pdv_produtos_admin_exclui" on public.produtos
  for delete to authenticated
  using (eh_admin());

-- Vendas: gravadas só pela função registrar_venda; o vendedor vê as
-- próprias e o admin vê todas.
drop policy if exists "pdv_vendas_leitura_logado" on public.vendas;
create policy "pdv_vendas_leitura_logado" on public.vendas
  for select to authenticated
  using (usuario_id = auth.uid() or eh_admin());

revoke all on public.perfis, public.fornecedores, public.produtos, public.vendas from anon;
revoke all on public.perfis, public.fornecedores, public.produtos, public.vendas from authenticated;
grant select                         on public.perfis       to authenticated;
grant select, insert, update, delete on public.fornecedores to authenticated;
grant select, insert, update, delete on public.produtos     to authenticated;
grant select                         on public.vendas       to authenticated;

-- Funções: no PostgreSQL toda função nasce executável por qualquer um
-- (PUBLIC); aqui fica só para quem está logado.
revoke execute on function public.criar_perfil()                                          from public, anon, authenticated;
revoke execute on function public.eh_admin()                                              from public, anon;
revoke execute on function public.registrar_venda(bigint, integer, numeric)               from public, anon;
revoke execute on function public.relatorio_vendas(timestamptz, timestamptz, uuid, bigint) from public, anon;
grant  execute on function public.eh_admin()                                              to authenticated;
grant  execute on function public.registrar_venda(bigint, integer, numeric)               to authenticated;
grant  execute on function public.relatorio_vendas(timestamptz, timestamptz, uuid, bigint) to authenticated;

-- =====================================================================
-- Depois de criar o seu usuário em Authentication → Users, torne-o admin
-- trocando o e-mail abaixo e rodando só esta linha:
--
--   update public.perfis set admin = true
--    where id = (select id from auth.users where email = 'seu-email@exemplo.com');
-- =====================================================================
