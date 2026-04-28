let pedidosData = [];

async function carregarAtendimento() {
  const busca = document.getElementById("input-busca")?.value || "";
  const status = document.getElementById("filtro-status")?.value || "";

  // IMPORTANTE: A barra no final '/' evita o erro 404 em muitas configurações de servidor
  const url = `/api/v1/atendimento/lista/?search=${busca}&status=${status}&t=${Date.now()}`;

  try {
    console.log("Tentando carregar lista de:", url);
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Erro HTTP: ${res.status}`);
    }

    const pedidos = await res.json();
    console.log("Pedidos recebidos:", pedidos);

    // Se a lista vier vazia, pedidosData será []
    pedidosData = pedidos;
    renderizarTabela();
  } catch (e) {
    console.error("Falha crítica ao carregar atendimento:", e);
  }
}

// Chamar ao carregar a página
document.addEventListener("DOMContentLoaded", carregarAtendimento);
// Atualizar a cada 10 segundos
setInterval(carregarAtendimento, 10000);

function renderizarTabela() {
  const body = document.getElementById("tabela-pedidos-body");
  body.innerHTML = pedidosData
    .map(
      (p) => `
        <tr class="border-b border-slate-50 hover:bg-blue-50/50 transition-colors">
            <td class="p-4 text-xs font-mono text-slate-400">${p.criado_em}</td>
            <td class="p-4 font-black text-xl text-blue-600">#${p.senha}</td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-full text-[10px] font-black ${p.tipo === "PREFERENCIAL" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600"}">
                    ${p.tipo}
                </span>
            </td>
            <td class="p-4">
                <span class="font-bold text-xs ${getStatusColor(p.status)}">${p.status}</span>
            </td>
            <td class="p-4 flex gap-2 justify-center">
                <button onclick="reimprimirCaixa('${p.id}')" class="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg" title="Recibo Caixa">🖨️ Caixa</button>
                <button onclick="reimprimirConferencia('${p.id}')" class="p-2 bg-amber-100 hover:bg-amber-200 rounded-lg">📋 Montar</button> 
                ${
                  p.status === "PENDENTE"
                    ? `
                      <button onclick="alterarStatus('${p.id}', 'PRODUCAO')" 
                              class="px-4 py-2 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 transition-all">
                          🚀 ENVIAR P/ PRODUÇÃO
                      </button>
                  `
                    : ""
                }
                    ${
                      p.status !== "CANCELADO"
                        ? `
                      <button onclick="alterarStatus('${p.id}', 'CANCELAR')" 
                              class="px-4 py-2 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100 transition-all">
                          ✕ Cancelar
                      </button>
                  `
                        : ""
                    }
            </td>
        </tr>
    `,
    )
    .join("");
}

function getStatusColor(status) {
  const cores = {
    PENDENTE: "text-amber-500",
    PRODUCAO: "text-blue-500",
    FINALIZADO: "text-green-500",
    RETIRADO: "text-slate-400",
    CANCELADO: "text-red-500",
  };
  return cores[status] || "text-slate-800";
}

// FUNÇÕES DE IMPRESSÃO
function reimprimirCaixa(id) {
  const p = pedidosData.find((x) => x.id === id);
  if (!p) return;

  // 1. Visibilidade
  const cli = document.getElementById("cupom-cliente");
  const conf = document.getElementById("cupom-conferencia");
  conf.classList.add("hidden");
  cli.classList.remove("hidden");

  // 2. Preenchimento de Dados (Sincronizado com o que a API do Atendimento envia)
  document.getElementById("cli-senha").innerText = p.senha;

  // IMPORTANTE: Se p.criado_em estiver vazio, usa a hora atual como fallback (igual no seu Caixa)
  document.getElementById("cli-data").innerText =
    p.criado_em || new Date().toLocaleTimeString();

  document.getElementById("cli-tipo").innerText = p.tipo || "NORMAL";
  document.getElementById("cli-total").innerText =
    `R$ ${parseFloat(p.total).toFixed(2)}`;

  // 3. Itens (Formato de tabela <tr><td>)
  const corpoItens = document.getElementById("cli-itens-corpo");
  corpoItens.innerHTML = p.itens
    .map(
      (item) => `
        <tr>
            <td class="py-1">${item.qtd}x ${item.nome}</td>
            <td class="text-right">R$ ${parseFloat(item.subtotal).toFixed(2)}</td>
        </tr>
    `,
    )
    .join("");

  // 4. Impressão
  setTimeout(() => {
    window.print();
    cli.classList.add("hidden");
  }, 250);
}
function dispararImpressaoFisica(p) {
  const cupomCli = document.getElementById("cupom-cliente");
  const cupomConf = document.getElementById("cupom-conferencia");
  const confSenha = document.getElementById("conf-senha");
  const confItens = document.getElementById("conf-itens");

  if (!confSenha || !confItens) {
    console.error("ERRO: Estrutura do cupom de 58mm não encontrada!");
    return;
  }

  // 1. PROTOCOLO DE VISIBILIDADE:
  // Esconde o de 80mm e libera o de 58mm para o motor de impressão
  cupomCli.classList.add("hidden");
  cupomConf.classList.remove("hidden");

  // 2. PREENCHIMENTO DOS DADOS
  confSenha.innerText = p.senha;

  const listaItens = p.itens || p.itens_resumo || [];
  const itensHTML = listaItens
    .map((i) => {
      const quantidade = i.qtd || i.quantidade || 1;
      const nome = i.nome || i.prato_nome || "Item";

      return `
      <div style="display: flex; align-items: flex-start; border-bottom: 1px solid #000; padding: 6px 0;">
        <span style="margin-right: 8px; font-size: 20px;">[ ]</span>
        <span style="flex: 1; font-size: 18px; font-weight: bold;">${quantidade}x ${nome}</span>
      </div>`;
    })
    .join("");

  confItens.innerHTML = itensHTML;

  // 3. DISPARO DA IMPRESSÃO
  setTimeout(() => {
    window.print();

    // 4. RESET: Esconde novamente para não vazar na tela após o print
    cupomConf.classList.add("hidden");
  }, 300);
}
function reimprimirConferencia(id) {
  const p = pedidosData.find((x) => x.id === id);
  if (!p) return;

  const cli = document.getElementById("cupom-cliente");
  const conf = document.getElementById("cupom-conferencia");

  // 1. Prepara os dados
  document.getElementById("conf-senha").innerText = p.senha;

  // 2. Itens de conferência
  document.getElementById("conf-itens").innerHTML = p.itens
    .map(
      (item) => `
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding: 4px 0;">
            <span style="font-size: 18px;">[ ] ${item.qtd || item.quantidade}x ${item.nome}</span>
        </div>
    `,
    )
    .join("");

  // 3. Alterna as classes
  cli.classList.add("hidden"); // Esconde caixa
  conf.classList.remove("hidden"); // Mostra conferência

  // 4. Imprime
  setTimeout(() => {
    window.print();
    conf.classList.add("hidden"); // Esconde após abrir a janela de print
  }, 250);
}

async function alterarStatus(id, acao) {
  const url = `/api/v1/atendimento/lista/${id}/`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken(),
      },
      body: JSON.stringify({ acao: acao }),
    });

    if (response.ok) {
      const dados = await response.json();
      console.log("Pedido enviado para produção:", dados);

      // Opcional: Se quiser imprimir o ticket de cozinha automaticamente ao clicar:
      // if (acao === 'PRODUCAO') imprimirTicketCozinha(dados);

      await carregarAtendimento(); // Atualiza a tabela para sumir o botão ou mudar o status
    }
  } catch (e) {
    console.error("Erro ao processar ação:", e);
  }
}

function getCsrfToken() {
  // Busca o token que o Django coloca no Cookie
  let cookieValue = null;
  if (document.cookie && document.cookie !== "") {
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, 10) === "csrftoken" + "=") {
        cookieValue = decodeURIComponent(cookie.substring(10));
        break;
      }
    }
  }
  return cookieValue;
}

let pedidosProntosConhecidos = new Set();
let primeiraCargaImpressao = false;

async function monitorarPedidosParaImpressao() {
  try {
    // Esta API deve retornar os pedidos que acabaram de ser FINALIZADOS na cozinha
    const res = await fetch("/api/v1/monitor/pedidos/");
    if (!res.ok) return;
    const data = await res.json();

    // Sincronização inicial: na primeira carga, apenas memorizamos o que já está pronto
    if (!primeiraCargaImpressao) {
      data.prontos.forEach((p) => pedidosProntosConhecidos.add(p.senha));
      primeiraCargaImpressao = true;
      return;
    }

    // Verifica se surgiu algo novo para imprimir
    data.prontos.forEach((p) => {
      if (!pedidosProntosConhecidos.has(p.senha)) {
        console.log(`Imprimindo automaticamente pedido pronto: #${p.senha}`);

        // Chamamos a função de impressão que você já possui
        dispararImpressaoFisica(p);

        // Registra para não imprimir de novo
        pedidosProntosConhecidos.add(p.senha);

        // Opcional: Atualiza a tabela de atendimento para mostrar o status novo
        carregarAtendimento();
      }
    });
  } catch (e) {
    console.error("Erro no monitor de auto-impressão:", e);
  }
}

// Inicia o monitoramento
setInterval(monitorarPedidosParaImpressao, 7000);

// Eventos de Busca
document
  .getElementById("input-busca")
  .addEventListener("input", carregarAtendimento);
document
  .getElementById("filtro-status")
  .addEventListener("change", carregarAtendimento);
setInterval(carregarAtendimento, 15000); // Refresh automático a cada 15s
