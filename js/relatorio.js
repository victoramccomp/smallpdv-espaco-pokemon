// Tela: Relatório de Venda por Produto (somente admin)
(function () {
  const filtros = document.querySelectorAll('.filtros button');
  const campoVendedor = document.getElementById('vendedor');
  const corpo = document.getElementById('corpo-tabela');
  const totalItens = document.getElementById('total-itens');
  const totalValor = document.getElementById('total-valor');
  let periodoAtual = 'tudo';
  let ultimoCarregamento = 0;

  // Início do período no horário local do aparelho (null = desde sempre).
  function inicioDoPeriodo(periodo) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (periodo === 'hoje') return hoje;
    if (periodo === '7dias') return new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6);
    if (periodo === 'mes') return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return null;
  }

  async function carregarVendedores() {
    try {
      const vendedores = await Api.listarVendedores();
      for (const v of vendedores) campoVendedor.add(new Option(v.nome, v.id));
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  async function carregar() {
    filtros.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.periodo === periodoAtual)));
    corpo.innerHTML = '<tr><td colspan="3" class="vazio">Carregando…</td></tr>';

    const esteCarregamento = ++ultimoCarregamento;
    let linhas;
    try {
      linhas = await Api.relatorioVendas(inicioDoPeriodo(periodoAtual), null, campoVendedor.value);
      if (esteCarregamento !== ultimoCarregamento) return; // outro filtro foi tocado depois
    } catch (erro) {
      if (esteCarregamento !== ultimoCarregamento) return;
      corpo.innerHTML = '<tr><td colspan="3" class="vazio">Não foi possível carregar o relatório.</td></tr>';
      totalItens.textContent = '–';
      totalValor.textContent = '–';
      avisar(erro.message, 'erro');
      return;
    }

    const somaItens = linhas.reduce((s, l) => s + Number(l.quantidade_vendida), 0);
    const somaValor = linhas.reduce((s, l) => s + Number(l.valor_total), 0);
    totalItens.textContent = somaItens.toLocaleString('pt-BR');
    totalValor.textContent = formatarDinheiro(somaValor);

    if (!linhas.length) {
      corpo.innerHTML = '<tr><td colspan="3" class="vazio">Nenhuma venda neste período.</td></tr>';
      return;
    }
    corpo.innerHTML = linhas.map((l) =>
      '<tr><td>' + escaparHtml(l.nome) + '</td>' +
      '<td class="num">' + Number(l.quantidade_vendida).toLocaleString('pt-BR') + '</td>' +
      '<td class="num">' + formatarDinheiro(l.valor_total) + '</td></tr>'
    ).join('');
  }

  filtros.forEach((b) => b.addEventListener('click', () => {
    periodoAtual = b.dataset.periodo;
    carregar();
  }));
  campoVendedor.addEventListener('change', carregar);

  iniciarPagina({ somenteAdmin: true }).then(() => {
    carregarVendedores();
    carregar();
  });
})();
