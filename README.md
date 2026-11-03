# SmallPDVMobile

PDV simples para o celular: cadastra fornecedores e produtos (com código de barras), registra
pedidos com vários itens, calcula o troco, baixa o estoque e mostra o relatório de vendas por produto.

- **Front-end:** HTML, CSS e JavaScript puros — sem frameworks, sem npm, sem build.
- **Banco:** Supabase (PostgreSQL), acessado direto pela API REST.
- **Hospedagem:** Vercel, como site estático.

## Telas

| Arquivo | Tela | Quem acessa | O que faz |
|---|---|---|---|
| `login.html` | Login | todos | E-mail e senha cadastrados pelo admin. |
| `index.html` | Registro de Venda | todos | Monta o **pedido**: escolhe o produto (na lista ou pelo botão da câmera, que lê o código de barras) → o valor de venda já vem preenchido (dá para alterar) → quantidade → "Adicionar ao pedido". Os itens vão somando no total; dá para mudar a quantidade (− / +) ou remover. "Recebido em dinheiro" calcula o troco. "Registrar venda" finaliza o pedido. Abaixo ficam os pedidos já feitos: toque num deles para editar ou cancelar. |
| `produtos.html` | Cadastro de Produto | admin | Nome, código de barras (opcional, digitado ou lido pela câmera), fornecedor (opcional), quantidade em estoque e valor de venda. Toque num produto da lista para editar ou excluir. |
| `fornecedores.html` | Cadastro de Fornecedor | admin | Nome do fornecedor. Toque num fornecedor da lista para editar ou excluir. |
| `relatorio.html` | Relatório de Venda por Produto | admin | Nome do produto, quantidade vendida e valor total, com filtros por vendedor, por fornecedor e por período (Hoje / 7 dias / Mês / Tudo). Com um fornecedor escolhido, o "Valor total" é o total vendido daquele fornecedor. |

Vendedores (não admin) veem só a tela de venda e só os próprios pedidos; as abas de navegação
aparecem apenas para o admin, que vê e edita os pedidos de todos.

O pedido em montagem fica guardado no celular: se a página recarregar, os itens continuam lá.

Regras que ficam no banco (`supabase/schema.sql`):

- Cada pedido grava quem o registrou — sempre o usuário logado, definido pelo próprio banco.
  Editar um pedido mantém o vendedor e a data originais.
- Vendedor só lê produtos e registra vendas; fornecedores, produtos e relatório são só do admin.
  Isso é garantido pelas permissões do banco (RLS), não apenas escondendo telas.
- O pedido baixa o estoque de todos os itens na mesma transação; se faltar estoque de um item,
  o pedido inteiro é recusado. Editar devolve ao estoque os itens antigos e baixa os novos;
  cancelar devolve tudo e tira o pedido do relatório.
- Cada vendedor só edita/cancela os próprios pedidos (o admin, qualquer um).
- Dois produtos não podem ter o mesmo código de barras.
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

O `schema.sql` pode ser executado de novo por cima: ele cria o que falta (perfis, fornecedores,
pedidos, código de barras) e troca as permissões públicas pelas de usuário logado. Cada venda
avulsa das versões anteriores vira um pedido de um item, com o mesmo vendedor e a mesma data.
Vendas registradas antes do login ficam sem vendedor — aparecem em "Todos os vendedores", mas em
nenhum vendedor específico.

## 2. Rodar no computador

Dê dois cliques em `iniciar-servidor.bat` (precisa do Python) e acesse <http://localhost:5660>.

Para testar no celular na mesma rede Wi-Fi, use o IP do computador: `http://192.168.x.x:5660`.
A câmera (leitor de código de barras) só abre em `https://` ou em `localhost` — pelo IP da rede ela
fica bloqueada; para testar o leitor no celular, use o site publicado na Vercel.

## Leitor de código de barras

- **Android (Chrome):** usa o leitor embutido do navegador.
- **iPhone e demais:** usa a biblioteca [ZXing](https://github.com/zxing-js/browser) 0.2.1 (licença
  MIT), guardada em `js/vendor/` e carregada só quando o navegador não tem leitor próprio.
- Lê EAN-13/EAN-8 (o código dos produtos no Brasil), UPC, Code 128, Code 39, ITF e QR Code.
- Na primeira vez, o navegador pede permissão para usar a câmera.

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
css/estilo.css     visual de todas as telas (claro/escuro automático)
js/config.js       URL e chave pública do Supabase  ← preencher
js/api.js          login/sessão (Supabase Auth) e chamadas à API REST
js/comum.js        formatação de R$, leitura de números, avisos, checagem de login
js/leitor.js       leitor de código de barras pela câmera
js/vendor/         biblioteca ZXing (leitor no iPhone) e licença
js/login.js | venda.js | produtos.js | fornecedores.js | relatorio.js   lógica de cada tela
supabase/schema.sql  tabelas, perfis, pedidos, funções e permissões (rode de novo a cada atualização)
```
