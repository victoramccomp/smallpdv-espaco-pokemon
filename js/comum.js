// Funções usadas pelas três telas.

const formatoReal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarDinheiro(valor) {
  return formatoReal.format(Number(valor) || 0);
}

// Converte o que foi digitado ("12,50", "R$ 1.234,5", "12.5") em número. Inválido → NaN.
function lerDinheiro(texto) {
  let t = String(texto || '').replace(/R\$|\s/g, '');
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100) / 100;
}

// Número → texto para campo de digitação ("7,50").
function valorParaCampo(valor) {
  return Number(valor).toFixed(2).replace('.', ',');
}

// Inteiro ≥ mínimo a partir do texto do campo. Inválido → NaN.
function lerInteiro(texto, minimo) {
  const t = String(texto || '').trim();
  if (!/^\d+$/.test(t)) return NaN;
  const n = parseInt(t, 10);
  return n >= minimo ? n : NaN;
}

let temporizadorAviso;
function avisar(mensagem, tipo) {
  const caixa = document.getElementById('aviso');
  caixa.textContent = mensagem;
  caixa.className = 'aviso visivel ' + (tipo || '');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caixa.className = 'aviso'; }, tipo === 'erro' ? 6000 : 3500);
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Faixa de aviso quando o js/config.js ainda não foi preenchido.
if (!Api.configurado) {
  document.addEventListener('DOMContentLoaded', () => {
    const faixa = document.createElement('p');
    faixa.className = 'faixa-config';
    faixa.textContent = 'Configure o Supabase no arquivo js/config.js para começar (veja o README).';
    document.querySelector('main').prepend(faixa);
  });
}

// Confere o login antes de a tela carregar os dados.
// somenteAdmin: quem não é admin é levado para a tela de venda.
// Resolve com o perfil ({ nome, admin }) ou não resolve (a página está saindo).
async function iniciarPagina(opcoes = {}) {
  if (!Api.configurado) return new Promise(() => {});
  if (!Api.sessao()) {
    location.replace('login.html');
    return new Promise(() => {});
  }

  let perfil;
  try {
    perfil = await Api.carregarPerfil();
  } catch (erro) {
    // Sem internet: segue com o perfil guardado no último acesso.
    perfil = Api.sessao() && Api.sessao().perfil;
    if (!perfil) {
      avisar(erro.message, 'erro');
      return new Promise(() => {});
    }
  }

  if (opcoes.somenteAdmin && !perfil.admin) {
    location.replace('index.html');
    return new Promise(() => {});
  }

  document.body.classList.toggle('admin', perfil.admin);
  const caixaUsuario = document.getElementById('usuario-topo');
  caixaUsuario.innerHTML = '<span>' + escaparHtml(perfil.nome) + '</span>' +
    '<button type="button" class="botao-sair">Sair</button>';
  caixaUsuario.querySelector('button').addEventListener('click', () => Api.sair());
  return perfil;
}
