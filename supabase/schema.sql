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

-- Fornecedor do produto (opcional por enquanto). "restrict": fornecedor
-- com produtos vinculados não pode ser excluído.
alter table public.produtos
  add column if not exists fornecedor_id bigint references public.fornecedores(id) on delete restrict;

create index if not exists produtos_fornecedor_id_idx on public.produtos (fornecedor_id);

-- Código de barras (opcional); dois produtos não podem ter o mesmo.
alter table public.produtos
  add column if not exists codigo_barras text check (length(trim(codigo_barras)) > 0);

create unique index if not exists produtos_codigo_barras_unico
  on public.produtos (codigo_barras) where codigo_barras is not null;

-- Pedido = uma venda ao cliente, com um ou mais itens.
create table if not exists public.pedidos (
  id            bigint generated always as identity primary key,
  -- quem registrou (pedidos anteriores ao login ficam sem vendedor)
  usuario_id    uuid        references public.perfis(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists pedidos_criado_em_idx  on public.pedidos (criado_em);
create index if not exists pedidos_usuario_id_idx on public.pedidos (usuario_id);

-- Itens dos pedidos (cada linha é um produto vendido dentro de um pedido).
create table if not exists public.vendas (
  id             bigint generated always as identity primary key,
  pedido_id      bigint        not null references public.pedidos(id) on delete cascade,
  -- "restrict": um produto que já teve venda não pode ser excluído
  produto_id     bigint        not null references public.produtos(id) on delete restrict,
  quantidade     integer       not null check (quantidade > 0),
  valor_unitario numeric(10,2) not null check (valor_unitario >= 0),
  valor_total    numeric(12,2) generated always as (quantidade * valor_unitario) stored,
  criado_em      timestamptz   not null default now()
);

-- Atualização de bancos da versão anterior, em que cada venda era avulsa
-- e guardava o vendedor: cada venda antiga vira um pedido de um item só.
alter table public.vendas
  add column if not exists pedido_id bigint references public.pedidos(id) on delete cascade;

do $$
declare
  r        record;
  v_pedido bigint;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendas' and column_name = 'usuario_id') then
    for r in execute 'select id, usuario_id, criado_em from public.vendas where pedido_id is null order by id' loop
      insert into public.pedidos (usuario_id, criado_em, atualizado_em)
      values (r.usuario_id, r.criado_em, r.criado_em)
      returning id into v_pedido;
      update public.vendas set pedido_id = v_pedido where id = r.id;
    end loop;
  end if;
end;
$$;

alter table public.vendas alter column pedido_id set not null;

-- O vendedor agora fica no pedido.
drop policy if exists "pdv_vendas_leitura_logado" on public.vendas;
alter table public.vendas drop column if exists usuario_id;

create index if not exists vendas_pedido_id_idx  on public.vendas (pedido_id);
create index if not exists vendas_produto_id_idx on public.vendas (produto_id);

-- ---------- Pedidos: registrar, editar e cancelar ----------
-- Rodam com privilégios do dono (security definer) porque o vendedor não
-- pode alterar estoque nem gravar itens diretamente. Cada função é uma
-- transação: se um item falhar (ex.: estoque insuficiente), nada muda.
--
-- p_itens: [{"produto_id": 1, "quantidade": 2, "valor_unitario": 7.5}, ...]

-- Baixa o estoque e grava os itens de um pedido (uso interno).
create or replace function public.pdv_gravar_itens(p_pedido_id bigint, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item    record;
  v_produto public.produtos;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_itens) as x(produto_id bigint, quantidade integer, valor_unitario numeric)
  loop
    if v_item.quantidade is null or v_item.quantidade <= 0 then
      raise exception 'A quantidade precisa ser maior que zero.';
    end if;
    if v_item.valor_unitario is null or v_item.valor_unitario < 0 then
      raise exception 'O valor não pode ser negativo.';
    end if;

    update produtos
       set estoque = estoque - v_item.quantidade
     where id = v_item.produto_id
       and estoque >= v_item.quantidade;

    if not found then
      select * into v_produto from produtos where id = v_item.produto_id;
      if not found then
        raise exception 'Produto não encontrado.';
      end if;
      raise exception 'Estoque insuficiente de "%" (disponível: %).', v_produto.nome, v_produto.estoque;
    end if;

    insert into vendas (pedido_id, produto_id, quantidade, valor_unitario)
    values (p_pedido_id, v_item.produto_id, v_item.quantidade, v_item.valor_unitario);
  end loop;
end;
$$;

-- Devolve ao estoque os itens de um pedido e apaga esses itens (uso interno).
create or replace function public.pdv_devolver_itens(p_pedido_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update produtos p
     set estoque = p.estoque + s.quantidade
    from (select produto_id, sum(quantidade) as quantidade
            from vendas where pedido_id = p_pedido_id group by produto_id) s
   where p.id = s.produto_id;
  delete from vendas where pedido_id = p_pedido_id;
$$;

-- Trava o pedido e confere se o usuário logado pode mexer nele (uso interno).
create or replace function public.pdv_pedido_do_usuario(p_pedido_id bigint)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido public.pedidos;
begin
  if auth.uid() is null then
    raise exception 'Faça login para continuar.';
  end if;
  select * into v_pedido from pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_pedido.usuario_id is distinct from auth.uid() and not eh_admin() then
    raise exception 'Você só pode alterar os seus próprios pedidos.';
  end if;
  return v_pedido;
end;
$$;

-- Registra um pedido novo em nome do usuário logado. Devolve o id.
create or replace function public.registrar_pedido(p_itens jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido_id bigint;
begin
  if auth.uid() is null or not exists (select 1 from perfis where id = auth.uid()) then
    raise exception 'Faça login para registrar vendas.';
  end if;

  insert into pedidos (usuario_id) values (auth.uid()) returning id into v_pedido_id;
  perform pdv_gravar_itens(v_pedido_id, p_itens);
  return v_pedido_id;
end;
$$;

-- Troca todos os itens de um pedido (o vendedor e a data continuam os mesmos).
create or replace function public.editar_pedido(p_pedido_id bigint, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pdv_pedido_do_usuario(p_pedido_id);
  perform pdv_devolver_itens(p_pedido_id);
  perform pdv_gravar_itens(p_pedido_id, p_itens);
  update pedidos set atualizado_em = now() where id = p_pedido_id;
end;
$$;

-- Cancela o pedido: devolve o estoque e apaga o pedido.
create or replace function public.cancelar_pedido(p_pedido_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pdv_pedido_do_usuario(p_pedido_id);
  perform pdv_devolver_itens(p_pedido_id);
  delete from pedidos where id = p_pedido_id;
end;
$$;

-- Compatibilidade: telas antigas ainda abertas no celular registram um
-- pedido de um item só.
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
  v_pedido_id bigint;
  v_venda     public.vendas;
begin
  v_pedido_id := registrar_pedido(jsonb_build_array(jsonb_build_object(
    'produto_id', p_produto_id, 'quantidade', p_quantidade, 'valor_unitario', p_valor_unitario)));
  select * into v_venda from vendas where pedido_id = v_pedido_id;
  return v_venda;
end;
$$;

-- ---------- Relatório de venda por produto ----------
-- Sem datas = todo o período (data do pedido). p_fim é exclusivo.
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
    join pedidos  pe on pe.id = v.pedido_id
    join produtos p  on p.id  = v.produto_id
   where eh_admin()
     and (p_inicio        is null or pe.criado_em   >= p_inicio)
     and (p_fim           is null or pe.criado_em   <  p_fim)
     and (p_usuario_id    is null or pe.usuario_id  =  p_usuario_id)
     and (p_fornecedor_id is null or p.fornecedor_id = p_fornecedor_id)
   group by p.id, p.nome
   order by sum(v.valor_total) desc, p.nome;
$$;

-- ---------- Permissões ----------

alter table public.perfis       enable row level security;
alter table public.fornecedores enable row level security;
alter table public.produtos     enable row level security;
alter table public.pedidos      enable row level security;
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

-- Pedidos e itens: gravados só pelas funções de pedido; o vendedor vê os
-- próprios e o admin vê todos.
drop policy if exists "pdv_pedidos_leitura" on public.pedidos;
create policy "pdv_pedidos_leitura" on public.pedidos
  for select to authenticated
  using (usuario_id = auth.uid() or eh_admin());

drop policy if exists "pdv_vendas_leitura" on public.vendas;
create policy "pdv_vendas_leitura" on public.vendas
  for select to authenticated
  using (exists (select 1 from public.pedidos pe
                  where pe.id = pedido_id and (pe.usuario_id = auth.uid() or eh_admin())));

revoke all on public.perfis, public.fornecedores, public.produtos, public.pedidos, public.vendas from anon;
revoke all on public.perfis, public.fornecedores, public.produtos, public.pedidos, public.vendas from authenticated;
grant select                         on public.perfis       to authenticated;
grant select, insert, update, delete on public.fornecedores to authenticated;
grant select, insert, update, delete on public.produtos     to authenticated;
grant select                         on public.pedidos      to authenticated;
grant select                         on public.vendas       to authenticated;

-- Funções: no PostgreSQL toda função nasce executável por qualquer um
-- (PUBLIC); aqui fica só para quem está logado. As "pdv_*" são internas.
revoke execute on function public.criar_perfil()                                          from public, anon, authenticated;
revoke execute on function public.pdv_gravar_itens(bigint, jsonb)                         from public, anon, authenticated;
revoke execute on function public.pdv_devolver_itens(bigint)                              from public, anon, authenticated;
revoke execute on function public.pdv_pedido_do_usuario(bigint)                           from public, anon, authenticated;
revoke execute on function public.eh_admin()                                              from public, anon;
revoke execute on function public.registrar_pedido(jsonb)                                 from public, anon;
revoke execute on function public.editar_pedido(bigint, jsonb)                            from public, anon;
revoke execute on function public.cancelar_pedido(bigint)                                 from public, anon;
revoke execute on function public.registrar_venda(bigint, integer, numeric)               from public, anon;
revoke execute on function public.relatorio_vendas(timestamptz, timestamptz, uuid, bigint) from public, anon;
grant  execute on function public.eh_admin()                                              to authenticated;
grant  execute on function public.registrar_pedido(jsonb)                                 to authenticated;
grant  execute on function public.editar_pedido(bigint, jsonb)                            to authenticated;
grant  execute on function public.cancelar_pedido(bigint)                                 to authenticated;
grant  execute on function public.registrar_venda(bigint, integer, numeric)               to authenticated;
grant  execute on function public.relatorio_vendas(timestamptz, timestamptz, uuid, bigint) to authenticated;

-- =====================================================================
-- Depois de criar o seu usuário em Authentication → Users, torne-o admin
-- trocando o e-mail abaixo e rodando só esta linha:
--
--   update public.perfis set admin = true
--    where id = (select id from auth.users where email = 'seu-email@exemplo.com');
-- =====================================================================
