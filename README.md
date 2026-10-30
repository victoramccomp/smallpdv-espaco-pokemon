# SmallPDVMobile

PDV simples para o celular: cadastra fornecedores e produtos, registra vendas (com baixa
automática de estoque) e mostra o relatório de vendas por produto.

- **Front-end:** HTML, CSS e JavaScript puros — sem frameworks, sem npm, sem build.
- **Banco:** Supabase (PostgreSQL), acessado direto pela API REST.
- **Hospedagem:** Vercel, como site estático.

## Telas

| Arquivo | Tela | Quem acessa | O que faz |
|---|---|---|---|
| `login.html` | Login | todos | E-mail e senha cadastrados pelo admin. |
| `index.html` | Registro de Venda | todos | Escolhe o produto → o valor de venda já vem preenchido (dá para alterar) → digita a quantidade → registra. Mostra o total e o estoque disponível. |
| `produtos.html` | Cadastro de Produto | admin | Nome, fornecedor (opcional), quantidade em estoque e valor de venda. Toque num produto da lista para editar ou excluir. |
| `fornecedores.html` | Cadastro de Fornecedor | admin | Nome do fornecedor. Toque num fornecedor da lista para editar ou excluir. |
| `relatorio.html` | Relatório de Venda por Produto | admin | Nome do produto, quantidade vendida e valor total, com filtros por vendedor, por fornecedor e por período (Hoje / 7 dias / Mês / Tudo). Com um fornecedor escolhido, o "Valor total" é o total vendido daquele fornecedor. |

Vendedores (não admin) veem só a tela de venda; as abas de navegação aparecem apenas para o admin.

Regras que ficam no banco (`supabase/schema.sql`):

- Cada venda grava quem a registrou — sempre o usuário logado, definido pelo próprio banco.
- Vendedor só lê produtos e registra vendas; fornecedores, produtos e relatório são só do admin.
  Isso é garantido pelas permissões do banco (RLS), não apenas escondendo telas.
- A venda baixa o estoque na mesma transação; se não houver estoque suficiente, a venda é recusada.
- Cada venda guarda o valor unitário usado naquele momento — mudar o preço do produto depois
  não altera vendas antigas.
- Produto que já tem vendas não pode ser excluído (para não sumir do relatório).
- Fornecedor com produtos vinculados não pode ser excluído, e não há dois fornecedores com o mesmo
  nome (maiúsculas/minúsculas e espaços nas pontas não contam).
- O filtro por fornecedor usa o fornecedor **atual** de cada produto: se um produto trocar de
  fornecedor, as vendas antigas dele passam a contar para o novo.

## 1. Criar o banco no Supabase

1. Crie um projeto em <https://supabase.com> (o plano gratuito serve).
2. No painel do projeto, abra **SQL Editor → New query**, cole todo o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Project Settings → API** (ou no botão **Connect**), copie:
   - **Project URL**
   - a chave pública: **Publishable key** (`sb_publishable_...`) ou a antiga **anon public**
4. Cole os dois valores em [`js/config.js`](js/config.js).

> Nunca use a *secret key* / *service_role* no `config.js`: tudo nesse arquivo fica visível no navegador.

### Usuários

1. **Feche o cadastro público:** *Authentication → Sign In / Providers* → desligue
   **Allow new users to sign up**. Sem isso, qualquer pessoa cria uma conta e entra no app.
2. **Crie cada usuário:** *Authentication → Users → Add user → Create new user*, com e-mail e
   senha e a opção **Auto Confirm User** marcada. O perfil é criado sozinho, com o nome igual ao
   começo do e-mail.
3. **Torne-se admin** (uma vez), no SQL Editor, com o seu e-mail:
   ```sql
   update public.perfis set admin = true
    where id = (select id from auth.users where email = 'seu-email@exemplo.com');
   ```
4. **Nome que aparece no app e no filtro do relatório:** *Table Editor → perfis* → edite a coluna `nome`.

Para tirar o acesso de alguém, prefira **Ban user** (em *Authentication → Users*) a excluir: as
vendas da pessoa continuam atribuídas a ela no relatório.

### Atualizando um banco de uma versão anterior

O `schema.sql` pode ser executado de novo por cima: ele cria o que falta (perfis, fornecedores, coluna do
vendedor) e troca as permissões públicas pelas de usuário logado. Vendas registradas antes do
login ficam sem vendedor — aparecem em "Todos os vendedores", mas em nenhum vendedor específico.

## 2. Rodar no computador

Dê dois cliques em `iniciar-servidor.bat` (precisa do Python) e acesse <http://localhost:5660>.

Para testar no celular na mesma rede Wi-Fi, use o IP do computador: `http://192.168.x.x:5660`.

## 3. Publicar na Vercel

**Opção A — pelo GitHub (recomendado):** suba a pasta para um repositório, depois em
<https://vercel.com/new> importe o repositório. Em *Framework Preset* deixe **Other**, sem
comando de build e sem *Output Directory*. Cada `git push` publica de novo.

**Opção B — pela linha de comando:**

```bash
npm i -g vercel
vercel        # primeira vez: faz login e cria o projeto (prévia)
vercel --prod # publica na URL definitiva
```

O `.vercelignore` impede que `supabase/`, este README e o `.bat` sejam publicados.

## Segurança

- Sem login, a chave pública não lê nem grava nada: todas as permissões exigem usuário logado.
- O login dura enquanto o celular estiver usando o app: o acesso do Supabase vence a cada hora e é
  renovado automaticamente. "Sair" encerra a sessão naquele aparelho.
- Mantenha o cadastro público desligado (veja *Usuários* acima).

## Estrutura

```
login.html         Login
index.html         Registro de Venda
produtos.html      Cadastro de Produto
fornecedores.html  Cadastro de Fornecedor
relatorio.html     Relatório de Venda por Produto
css/estilo.css     visual das três telas (claro/escuro automático)
js/config.js       URL e chave pública do Supabase  ← preencher
js/api.js          login/sessão (Supabase Auth) e chamadas à API REST
js/comum.js        formatação de R$, leitura de números, avisos, checagem de login
js/login.js | venda.js | produtos.js | fornecedores.js | relatorio.js   lógica de cada tela
supabase/schema.sql  tabelas, perfis, funções e permissões (rode de novo a cada atualização)
```
