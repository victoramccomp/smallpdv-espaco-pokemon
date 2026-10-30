# SmallPDVMobile

PDV simples para o celular: cadastra produtos, registra vendas (com baixa automática de
estoque) e mostra o relatório de vendas por produto.

- **Front-end:** HTML, CSS e JavaScript puros — sem frameworks, sem npm, sem build.
- **Banco:** Supabase (PostgreSQL), acessado direto pela API REST.
- **Hospedagem:** Vercel, como site estático.

## Telas

| Arquivo | Tela | O que faz |
|---|---|---|
| `index.html` | Registro de Venda | Escolhe o produto → o valor de venda já vem preenchido (dá para alterar) → digita a quantidade → registra. Mostra o total e o estoque disponível. |
| `produtos.html` | Cadastro de Produto | Nome, quantidade em estoque e valor de venda. Toque num produto da lista para editar ou excluir. |
| `relatorio.html` | Relatório de Venda por Produto | Nome do produto, quantidade vendida e valor total, com filtro Hoje / 7 dias / Mês / Tudo. |

Regras que ficam no banco (`supabase/schema.sql`):

- A venda baixa o estoque na mesma transação; se não houver estoque suficiente, a venda é recusada.
- Cada venda guarda o valor unitário usado naquele momento — mudar o preço do produto depois
  não altera vendas antigas.
- Produto que já tem vendas não pode ser excluído (para não sumir do relatório).

## 1. Criar o banco no Supabase

1. Crie um projeto em <https://supabase.com> (o plano gratuito serve).
2. No painel do projeto, abra **SQL Editor → New query**, cole todo o conteúdo de
   [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
3. Em **Project Settings → API** (ou no botão **Connect**), copie:
   - **Project URL**
   - a chave pública: **Publishable key** (`sb_publishable_...`) ou a antiga **anon public**
4. Cole os dois valores em [`js/config.js`](js/config.js).

> Nunca use a *secret key* / *service_role* no `config.js`: tudo nesse arquivo fica visível no navegador.

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

## Segurança — leia antes de divulgar o link

O app **não tem login**. As permissões do `schema.sql` liberam leitura e escrita para a chave
pública, então quem tiver o link do site consegue ver e alterar produtos e registrar vendas.
Serve bem para uso pessoal com o link guardado só com você. Se o link for circular, o próximo passo
é adicionar login (Supabase Auth com e-mail e senha) e trocar as políticas para `authenticated`.

## Estrutura

```
index.html         Registro de Venda
produtos.html      Cadastro de Produto
relatorio.html     Relatório de Venda por Produto
css/estilo.css     visual das três telas (claro/escuro automático)
js/config.js       URL e chave pública do Supabase  ← preencher
js/api.js          chamadas à API REST do Supabase
js/comum.js        formatação de R$, leitura de números, avisos
js/venda.js | produtos.js | relatorio.js   lógica de cada tela
supabase/schema.sql  tabelas, funções e permissões
```
