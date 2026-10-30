-- =====================================================================
-- SmallPDVMobile — banco de dados (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode ser executado de novo sem perder dados (usa "if not exists").
-- =====================================================================

-- ---------- Tabelas ----------

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

create index if not exists vendas_produto_id_idx on public.vendas (produto_id);
create index if not exists vendas_criado_em_idx  on public.vendas (criado_em);

-- ---------- Registro de venda ----------
-- Baixa o estoque e grava a venda numa única transação:
-- ou as duas coisas acontecem, ou nenhuma.

create or replace function public.registrar_venda(
  p_produto_id     bigint,
  p_quantidade     integer,
  p_valor_unitario numeric
)
returns public.vendas
language plpgsql
set search_path = public
as $$
declare
  v_venda public.vendas;
begin
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

  insert into vendas (produto_id, quantidade, valor_unitario)
  values (p_produto_id, p_quantidade, p_valor_unitario)
  returning * into v_venda;

  return v_venda;
end;
$$;

-- ---------- Relatório de venda por produto ----------
-- Sem datas = todo o período. p_fim é exclusivo (vendas antes de p_fim).

create or replace function public.relatorio_vendas(
  p_inicio timestamptz default null,
  p_fim    timestamptz default null
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
   where (p_inicio is null or v.criado_em >= p_inicio)
     and (p_fim    is null or v.criado_em <  p_fim)
   group by p.id, p.nome
   order by sum(v.valor_total) desc, p.nome;
$$;

-- ---------- Acesso pela chave pública (anon) ----------
-- ATENÇÃO: o app não tem login. Qualquer pessoa com o link do site
-- (e, portanto, com a chave pública) consegue ler e gravar estes dados.

alter table public.produtos enable row level security;
alter table public.vendas   enable row level security;

drop policy if exists "pdv_produtos_acesso" on public.produtos;
create policy "pdv_produtos_acesso" on public.produtos
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "pdv_vendas_leitura" on public.vendas;
create policy "pdv_vendas_leitura" on public.vendas
  for select to anon, authenticated
  using (true);

drop policy if exists "pdv_vendas_insercao" on public.vendas;
create policy "pdv_vendas_insercao" on public.vendas
  for insert to anon, authenticated
  with check (true);

grant select, insert, update, delete on public.produtos to anon, authenticated;
grant select, insert                 on public.vendas   to anon, authenticated;
grant execute on function public.registrar_venda(bigint, integer, numeric)   to anon, authenticated;
grant execute on function public.relatorio_vendas(timestamptz, timestamptz) to anon, authenticated;
