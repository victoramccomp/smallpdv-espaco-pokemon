// Tela: Registro de Venda
(function () {
  const form = document.getElementById('form-venda');
  const campoProduto = document.getElementById('produto');
  const campoValor = document.getElementById('valor');
  const campoQuantidade = document.getElementById('quantidade');
  const infoEstoque = document.getElementById('info-estoque');
  const saidaTotal = document.getElementById('total');
  const botao = document.getElementById('btn-registrar');

  let produtos = [];

  async function carregarProdutos() {
    try {
      produtos = await Api.listarProdutos();
    } catch (erro) {
      campoProduto.innerHTML = '<option value="">Não foi possível carregar</option>';
      avisar(erro.message, 'erro');
      return;
    }

    campoProduto.innerHTML = '';
    campoProduto.add(new Option(produtos.length ? 'Selecione um produto' : 'Nenhum produto cadastrado', ''));
    for (const p of produtos) {
      const opcao = new Option(p.nome + ' — ' + p.estoque + ' em estoque', p.id);
      if (p.estoque <= 0) {
        opcao.text = p.nome + ' — sem estoque';
        opcao.disabled = true;
      }
      campoProduto.add(opcao);
    }
  }

  function produtoSelecionado() {
    return produtos.find((p) => String(p.id) === campoProduto.value);
  }

  function atualizarTotal() {
    const valor = lerDinheiro(campoValor.value);
    const quantidade = lerInteiro(campoQuantidade.value, 1);
    const total = Number.isFinite(valor) && Number.isFinite(quantidade) ? valor * quantidade : 0;
    saidaTotal.textContent = formatarDinheiro(total);
  }

  function mostrarEstoque(p) {
    campoQuantidade.max = p ? p.estoque : '';
    infoEstoque.textContent = p ? 'Disponível em estoque: ' + p.estoque : '';
  }

  // Ao escolher o produto, o valor de venda já vem preenchido (e continua editável).
  campoProduto.addEventListener('change', () => {
    const p = produtoSelecionado();
    campoValor.value = p ? valorParaCampo(p.valor_venda) : '';
    mostrarEstoque(p);
    campoValor.removeAttribute('aria-invalid');
    atualizarTotal();
    if (p) campoQuantidade.focus();
  });

  campoValor.addEventListener('input', () => { campoValor.removeAttribute('aria-invalid'); atualizarTotal(); });
  campoQuantidade.addEventListener('input', () => { campoQuantidade.removeAttribute('aria-invalid'); atualizarTotal(); });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const p = produtoSelecionado();
    const valor = lerDinheiro(campoValor.value);
    const quantidade = lerInteiro(campoQuantidade.value, 1);

    if (!p) {
      avisar('Selecione um produto.', 'erro');
      campoProduto.focus();
      return;
    }
    if (!Number.isFinite(valor)) {
      campoValor.setAttribute('aria-invalid', 'true');
      avisar('Digite um valor válido, ex.: 12,50', 'erro');
      campoValor.focus();
      return;
    }
    if (!Number.isFinite(quantidade)) {
      campoQuantidade.setAttribute('aria-invalid', 'true');
      avisar('Digite a quantidade (número inteiro maior que zero).', 'erro');
      campoQuantidade.focus();
      return;
    }
    if (quantidade > p.estoque) {
      campoQuantidade.setAttribute('aria-invalid', 'true');
      avisar('Só há ' + p.estoque + ' em estoque de ' + p.nome + '.', 'erro');
      campoQuantidade.focus();
      return;
    }

    botao.disabled = true;
    botao.textContent = 'Registrando…';
    try {
      await Api.registrarVenda(p.id, quantidade, valor);
      avisar('Venda registrada: ' + quantidade + '× ' + p.nome + ' — ' + formatarDinheiro(valor * quantidade), 'ok');
      form.reset();
      mostrarEstoque(null);
      atualizarTotal();
      await carregarProdutos();
    } catch (erro) {
      avisar(erro.message, 'erro');
      // Recarrega o estoque (pode ter mudado em outro aparelho) mantendo o que foi digitado.
      await carregarProdutos();
      const atual = produtos.find((x) => x.id === p.id && x.estoque > 0);
      campoProduto.value = atual ? String(atual.id) : '';
      mostrarEstoque(atual);
    } finally {
      botao.disabled = false;
      botao.textContent = 'Registrar venda';
    }
  });

  iniciarPagina().then(carregarProdutos);
})();
