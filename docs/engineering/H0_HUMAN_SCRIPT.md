# H0 — roteiro de teste humano (Fase 1)

Link do H0 (Preview): `https://ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app`
Banco: projeto `ziistec-h0`, migrations até 0112. Ambiente só de teste: dados inventados, nada de cliente real.
Estado do ambiente e limites: `H0_ENVIRONMENT.md`. Este roteiro **não foi executado por IA**: quem marca PASSOU/FALHOU é a pessoa que testou, no aparelho dela.

Aparelhos: **Proprietário A** = computador (e Android para rotas/PDF) · **Técnico A** = iPhone · **Proprietário B** = computador (janela anônima).

## Antes do TESTE 1 (preparação do proprietário, uma vez)

1. Abra o link acima já logado na Vercel (conta do time `js-connect`). Se pedir login da Vercel, é a proteção do Preview; no iPhone do técnico use o mesmo login ou o botão Compartilhar da Vercel.
2. No painel do Supabase, projeto **ziistec-h0** → Authentication → URL Configuration: Site URL = o link acima; em Redirect URLs, o mesmo link com `/` no fim.
3. Authentication → Users → Add user → Create new user, **três vezes**, marcando **Auto Confirm User**: proprietário A, técnico A, proprietário B. Escolha as senhas e guarde no gerenciador de senhas. **Não mande senha por aqui.**
4. Mande só os **três e-mails**. Eu preparo os convites beta e os dados de teste; depois aviso que pode começar.

Marque cada teste: **PASSOU**, **FALHOU** (anote o que viu e tire foto) ou **NÃO TESTÁVEL**. Falha que perde dado, mostra dado de outra empresa ou mostra preço ao técnico = P0. Falha que trava o fluxo = P1. Incômodo sem travar = P2.

---

**TESTE 1 — Entrar e criar a empresa (Proprietário A, computador)**
- Onde clicar: abra o link → Entrar.
- O que fazer: entre com o e-mail e a senha do proprietário A. Na primeira vez, crie a empresa com o nome `H0 Demo A`.
- Resultado esperado: abre o Início da empresa. Nenhuma tela mostra palavras como migration, RPC, RLS ou "preview". (Opcional: "Esqueci a senha"; o e-mail pode não chegar, o e-mail embutido do Supabase é limitado — se não chegar, marque NÃO TESTÁVEL.)

**TESTE 2 — Cadastros básicos (Proprietário A, computador)**
- Onde clicar: Clientes → **Novo cliente**; depois **Serviços e produtos** → **Novo serviço** / **Novo produto**.
- O que fazer: crie o cliente `Cliente H0 Um` com endereço (rua, número, cidade). Crie outro, `Cliente H0 Sem Endereço`, sem endereço. Em Serviços e produtos crie o serviço `Serviço H0` (R$ 200) e o produto `Produto H0` (R$ 50, estoque 5, mínimo 2).
- Resultado esperado: tudo aparece nas listas depois de salvar; sem mensagem de erro técnica.

**TESTE 3 — Orçamento → aprovação → ordem de serviço (Proprietário A, computador)**
- Onde clicar: Orçamentos → Novo orçamento.
- O que fazer: escolha `Cliente H0 Um`, adicione o serviço e o produto, dê desconto de R$ 10, salve, clique em **Aprovar orçamento** e depois em **Gerar OS** (técnico: deixe sem técnico por enquanto).
- Resultado esperado: a OS nasce na lista de Ordens de serviço com o **mesmo valor aprovado** do orçamento.

**TESTE 4 — Convidar o técnico (Proprietário A, computador)**
- Onde clicar: Equipe → **Adicionar colaborador**.
- O que fazer: informe o **e-mail do técnico A** com a função técnico.
- Resultado esperado: o convite fica salvo como pendente. O e-mail do convite pode não ser enviado neste ambiente (não faz parte do H0); isso não é falha. O técnico entra direto na etapa seguinte.

**TESTE 5 — Agendar (Proprietário A, computador)**
- Onde clicar: Ordens de serviço → abra a OS → **Agendar**; depois Agenda.
- O que fazer: marque amanhã, 10:00, técnico A. Abra a Agenda (semana e mês).
- Resultado esperado: a OS aparece no dia certo; trocar o horário (Reagendar) atualiza a Agenda.

**TESTE 6 — Executar em campo (Técnico A, iPhone)**
- Onde clicar: abra o link no iPhone → Entrar (e-mail e senha do técnico A) → **Meu dia**.
- O que fazer: abra a OS → **Iniciar atendimento** → tire 2 fotos com a câmera → preencha causa e solução (use **Ditar** em um campo; se negar o microfone, o texto não pode sumir) → **Finalizar atendimento** → informe o nome de quem recebeu → concluir. Toque em concluir duas vezes seguidas.
- Resultado esperado: cronômetro "Em atendimento" depois de iniciar; fotos anexadas; a OS conclui **uma só vez**; nenhum erro técnico.

**TESTE 7 — Técnico nunca vê preço (Técnico A, iPhone)**
- Onde clicar: na OS concluída e em Meu dia.
- O que fazer: percorra a OS, os itens, o relato e o menu.
- Resultado esperado: **nenhum valor em R$**, nenhum pagamento, nenhum Financeiro, nenhum botão de Comprovante de Serviço. (Se aparecer qualquer preço: P0.)

**TESTE 8 — Cobrança e pagamento (Proprietário A, computador)**
- Onde clicar: Financeiro.
- O que fazer: ache a cobrança da OS concluída; **Registrar pagamento** (Pix).
- Resultado esperado: a cobrança aparece com o valor aprovado e passa para **Recebido**; o total confere.

**TESTE 9 — Comprovante de Serviço (Proprietário A, computador e Android)**
- Onde clicar: Ordens de serviço → OS concluída → **Comprovante de Serviço**.
- O que fazer: **Emitir comprovante** → **Baixar PDF** (no Android, abra o PDF no celular) → **Compartilhar** ou Enviar pelo WhatsApp → feche e emita de novo → depois **Reemitir comprovante** com um motivo.
- Resultado esperado: o PDF traz "Comprovante de serviço — documento não fiscal.", empresa, cliente, data, serviço, itens, valor, técnico e a OS; emitir de novo devolve o **mesmo** comprovante; reemitir cria nova versão e mantém **Versões anteriores**.

**TESTE 10 — Histórico do cliente (Proprietário A, computador)**
- Onde clicar: Clientes → `Cliente H0 Um` → **Histórico de serviços**.
- O que fazer: veja o histórico; crie uma nova OS para o mesmo cliente e abra o histórico dentro dela.
- Resultado esperado: a OS concluída aparece com data e valor (só o proprietário vê valor).

**TESTE 11 — Rotas (Android e iPhone)**
- Onde clicar: na OS do `Cliente H0 Um` → **Abrir rota**; depois **Abrir com outro app**.
- O que fazer: abra a rota; troque de aplicativo; abra uma OS do cliente **sem endereço**.
- Resultado esperado: abre o app escolhido com o endereço inteiro; na OS sem endereço o botão fica desligado com "Este atendimento ainda não possui um endereço disponível para abrir a rota."; a escolha de app continua depois de sair e entrar.

**TESTE 12 — Outra empresa não vê nada (Proprietário B, computador, janela anônima)**
- Onde clicar: abra o link → Entrar com o e-mail do proprietário B → crie a empresa `H0 Demo B`.
- O que fazer: veja Clientes, Ordens de serviço, Financeiro.
- Resultado esperado: tudo **vazio**; nada de `H0 Demo A`. (Se aparecer dado da empresa A: P0.)

**TESTE 13 — Celular e tablet (Android, iPhone, tablet se tiver)**
- Onde clicar: Clientes → **Novo cliente**; Ordens de serviço → criar ordem de serviço.
- O que fazer: role as telas e preencha formulários (o teclado não pode cobrir o campo). Digite algo sem salvar e tente fechar/voltar. Ative o modo avião, salve, desligue o modo avião e tente de novo.
- Resultado esperado: perguntam antes de descartar; o rascunho volta ao recarregar; salvar sem rede dá mensagem amigável e **não duplica** o registro.

**TESTE 14 — Desativar colaborador (Proprietário A, computador; depois Técnico A, iPhone)**
- Onde clicar: Equipe → técnico A → desativar.
- O que fazer: no iPhone, recarregue a página do técnico.
- Resultado esperado: o técnico **perde o acesso na hora**.

---

Devolva uma lista: `TESTE N — PASSOU/FALHOU/NÃO TESTÁVEL — aparelho — observação ou foto`. Falhas viram P0/P1/P2 e voltam para correção; só depois de todos os testes sem P0/P1 aberto a Fase 1 pode virar READY.
