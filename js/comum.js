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
