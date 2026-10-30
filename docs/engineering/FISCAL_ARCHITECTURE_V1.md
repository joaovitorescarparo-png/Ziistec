# Arquitetura fiscal V1 (NFS-e) — desenho, nada implementado

**Estado:** apenas desenho. Nenhum código, migration, credencial, certificado, contrato ou chamada a provedor foi criado. Nenhuma NFS-e foi emitida. Este documento prepara a decisão e a Fase F1 (sandbox), que **não foi executada** e exige autorização própria.

Pesquisa de provedores feita em 2026-10-28 e **corrigida em 2026-10-29 (V1.1)** só com fontes oficiais (gov.br; documentação e páginas públicas de cada provedor). Preços, limites e prazos mudam; o que não está provado em fonte oficial está marcado **PENDENTE** ou *não confirmado* e não foi estimado.

**Correções da V1.1 em relação à primeira versão:** (1) a data do padrão nacional deixou de ser "fonte secundária, 01/09/2026" e passou a ser 01/11/2026 em fonte oficial (§8); (2) Spedy: multi-CNPJ, certificado A1, sandbox, cancelamento, PDF/XML e bloco IBS/CBS da NFS-e passaram de *não confirmado* a confirmados na documentação oficial; NFS-e Nacional aparece como provedor, sem página dedicada; (3) Focus: certificado A1, webhook de `nfsen`, `ref` e a exigência de CNPJ real na homologação foram conferidos na documentação oficial; a afirmação anterior sobre "validação ativa de IBS/CBS desde 2026-04-01" não foi reconfirmada e saiu; (4) a recomendação deixou de apontar um provedor (§10).

## 1. Princípios

1. **Comprovante de Serviço ≠ NFS-e.** O `service_receipts` (migration 0100, `zt_issue_service_receipt`, "CS-0001") é documento **não fiscal**, só do dono, não gera lançamento financeiro e continua assim. A NFS-e vive em tabelas próprias (`fiscal_documents`), nunca reaproveita `service_receipts` e a interface nunca chama o comprovante de "nota".
2. **Banco é a autoridade.** Valores, tomador, serviço, regras e transições de estado são resolvidos e validados no banco/servidor; o navegador só mostra a prévia e confirma.
3. **Nunca emitir sozinho.** Nenhuma emissão automática ao concluir a OS. O dono escolhe, vê a prévia, confirma.
4. **Provedor é detalhe de adaptador.** O domínio fala `FiscalProvider`; Spedy e Focus NFe são adaptadores. Nenhum nome de provedor no domínio, nas tabelas de negócio ou nas telas.
5. **Dado fiscal vem da empresa e do contador, nunca de IA.** A IA do app não sugere, preenche nem corrige código de serviço, alíquota, CNAE ou regime.
6. **Receita não duplica.** A NFS-e referencia o lançamento que já existe (`work_orders.billing_entry_id` → `financial_entries`); emitir ou cancelar nota não cria, apaga nem baixa receita nem pagamento.

## 2. Fluxo

```
OS concluída (billing_entry já existe)
  → dono escolhe "Emitir NFS-e"
  → prévia (tomador, serviço, valor, retenções, alíquota; origem de cada campo)
  → validações (bloqueiam; ver §6)
  → confirmação explícita (gera request_id + preview_hash)
  → fila (queued) → despacho (dispatching) → provedor
  → processing (aguarda webhook ou consulta)
  → authorized  (número, código de verificação, PDF, XML)
  → rejected    (código e mensagem normalizados; corrige e cria nova tentativa)
  → cancelamento quando permitido: cancel_requested → cancelled
```

Cancelar a NFS-e **não** cancela o pagamento nem o lançamento. Rejeição não bloqueia a OS nem o financeiro.

## 3. Dados propostos

Rascunho de modelo, para a futura migration (próximo número livre na época; não reservar agora). Todas as tabelas com RLS ligada, sem `GRANT` de escrita ao navegador; escrita só por RPC `SECURITY DEFINER` com `search_path = ''` e pelo handler de webhook com chave de serviço. FKs de tenant sempre compostas `(id, company_id)`.

**`fiscal_settings`** (1 por empresa; só dono): CNPJ, inscrição municipal, regime tributário, CNAE, código de serviço municipal, item da LC 116, alíquota de ISS, retenções (ISS/IR/PIS/COFINS/CSLL/INSS) por padrão, natureza da operação, série/RPS, ambiente (`sandbox` | `production`), referência da empresa no provedor, quem validou e quando, `status` (`incomplete` | `ready`). Origem: formulário do dono com orientação do contador. Produção só habilita após validação explícita e depois de uma emissão de sandbox bem-sucedida.

**`fiscal_documents`**: `company_id`, `work_order_id`, `billing_entry_id` (FKs compostas), `kind = 'nfse'`, `status`, `request_id`, `preview_hash`, `provider` (texto do adaptador), `provider_ref` (id/ref no provedor), `environment`, `snapshot` jsonb (tomador, serviço, valores, tributos usados — imutável após `queued`), `number`, `verification_code`, `issued_at`, caminhos de XML/PDF no Storage privado, `error_code`/`error_message` normalizados, `cancel_reason`, auditoria (quem pediu, quando). Índices: `unique(company_id, request_id)` e **uma NFS-e ativa por OS** (`unique(work_order_id) where status in ('queued','dispatching','processing','authorized','cancel_requested')`).

**`fiscal_webhook_events`**: `provider`, `event_id` (único por provedor), `received_at`, `signature_ok`, hash do corpo bruto, `processed_at`. Serve a repetição segura e a auditoria; sem segredo, sem PII além do necessário.

Segredos **não** ficam no banco: chave do provedor só em variável de ambiente do servidor (Vercel), por ambiente.

## 4. Estados e transições

`draft → queued → dispatching → processing → authorized | rejected`; `authorized → cancel_requested → cancelled` (ou volta a `authorized` se o cancelamento for negado). `rejected` e `cancelled` são finais para aquele registro; nova tentativa é novo registro com novo `request_id`. Transições só por função de servidor, que checa o estado de origem (`update … where status = origem`) e ignora transição fora de ordem, inclusive a causada por webhook repetido ou atrasado. `dispatching` sem resposta por mais que o limite passa a `processing` **depois** de consultar o provedor, nunca por suposição.

## 5. Interface `FiscalProvider`

Contrato neutro (descrito em TypeScript; implementação em JavaScript, só no servidor; o navegador nunca importa adaptador):

```ts
/** @typedef {'queued'|'processing'|'authorized'|'rejected'|'cancel_requested'|'cancelled'} FiscalStatus */
/** @typedef {{ code:string, message:string, retryable:boolean, field?:string }} FiscalError */

interface FiscalProvider {
  capabilities(): { nfseMunicipal:boolean, nfseNacional:boolean, multiCnpj:boolean, sandbox:boolean,
                    webhookSignature:'hmac'|'token'|'none', idempotencyKey:'header'|'field'|'none',
                    cancellation:boolean, pdf:boolean, xml:boolean }
  upsertCompany(company)                       // cadastra/atualiza o prestador no provedor
  configureTaxProfile(companyRef, settings)    // regime, serviço, alíquotas
  uploadCertificate(companyRef, pfx, password) // só se o provedor exigir; ver §6
  issueServiceInvoice(companyRef, invoice, idempotencyKey) // -> { providerRef, status }
  getServiceInvoice(companyRef, providerRef)   // -> { status, number?, verificationCode?, error? }
  cancelServiceInvoice(companyRef, providerRef, reason, idempotencyKey)
  downloadXml(companyRef, providerRef)         // -> bytes
  downloadPdf(companyRef, providerRef)         // -> bytes
  verifyWebhook({ rawBody, headers, now })     // -> { ok, eventId, providerRef } (tempo constante)
  mapStatus(providerStatus): FiscalStatus
  mapError(providerError): FiscalError
}
```

Regras: o adaptador **traduz** (status, erro, campos) e não decide negócio; nenhuma resposta de provedor entra no banco sem passar por `mapStatus`/`mapError`; `capabilities()` decide o que a tela oferece (por exemplo, esconder cancelamento se o provedor não suportar).

## 6. Segurança

- **Somente dono** vê, configura, emite e cancela. Técnico não lê `fiscal_*`. Anônimo e usuário sem empresa, nada. Membro desativado, nada. RLS + RPC são a autoridade.
- **Chave do provedor** só no servidor; nunca em `VITE_*`, resposta de API, log ou banco.
- **Certificado digital** nunca passa pelo navegador. Preferir o provedor guardar o certificado (upload direto do dono ao provedor, ou pelo servidor sem persistir); **não armazenar PFX nem senha**. Se o servidor tiver de repassar, é em memória, uma requisição, sem log. Validade do certificado é informada pelo provedor e avisada ao dono. Ambos os provedores recebem o A1 (`.pfx`/`.p12`) por API (§9); certificado de matriz não serve para filial.
- **Webhook**: assinatura obrigatória quando o provedor assina; verificar sobre o **corpo bruto**, comparação em tempo constante, janela de tempo curta (replay), `event_id` único (repetição devolve 200 sem reprocessar). Para provedor que só envia token estático em cabeçalho, o token é segredo por ambiente **e** o handler nunca confia no corpo: ele só usa o `providerRef` para **consultar o provedor** (`getServiceInvoice`) e grava o resultado da consulta.
- **Logs** sem CNPJ completo, CPF, e-mail ou valores de tomador; ids e hashes bastam.
- **Isolamento entre empresas no provedor:** o desenho não pode depender de cadastro de clientes/produtos compartilhado no provedor (ver risco da Spedy no §9). O tomador vai no corpo de cada emissão, a partir do `snapshot`; nenhum catálogo do provedor é fonte de verdade.
- **Validações que bloqueiam a emissão:** `fiscal_settings.status = ready`; ambiente coerente; OS concluída; tomador com documento válido e endereço; `billing_entry_id` existente e sem NFS-e ativa; valor e itens iguais ao `preview_hash` confirmado; serviço mapeado para um código municipal/LC 116 cadastrado. Material interno ou custo nunca entra no valor do serviço (regra de dinheiro do produto).

## 7. Idempotência e falhas

- `request_id` gerado na confirmação; `unique(company_id, request_id)` devolve o mesmo registro em reenvio. O mesmo `request_id` vira a chave de idempotência enviada ao provedor.
- `preview_hash` (hash do snapshot confirmado) impede emitir algo diferente do que o dono viu: se OS, tomador ou valor mudarem antes do despacho, a emissão para e pede nova prévia.
- Timeout, queda de rede ou resposta perdida: **consultar o provedor primeiro** (`getServiceInvoice` pela mesma chave); só repetir o envio, com a **mesma** chave, se o provedor disser que não conhece o pedido. Nunca gerar chave nova para "tentar de novo".
- Uma NFS-e ativa por OS (índice parcial) e transições condicionais ao estado de origem tornam webhook duplicado, fora de ordem e duplo clique inofensivos.

## 8. Contexto regulatório (fontes oficiais, conferidas em 2026-10-29)

| Fato | Fonte oficial |
|---|---|
| ME e EPP **optantes do Simples Nacional** prestadoras de serviço sujeitas à NFS-e devem emitir pelo **Emissor Nacional** (modalidades web, aplicativo móvel e API) a partir de **01/11/2026**. A Resolução CGSN nº 191, de 04/08/2026, prorrogou a data anterior (01/09/2026, Resolução CGSN nº 189, revogada). Não altera as regras do MEI e não alcança operações sujeitas só a ICMS. | [Receita Federal — Simples Nacional: NFS-e Nacional será obrigatória para ME e EPP a partir de 1º de novembro de 2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026); [Portal da NFS-e — CGSN prorroga a obrigatoriedade](https://www.gov.br/nfse/pt-br/noticias/comite-gestor-do-simples-nacional-prorroga-a-obrigatoriedade-de-emissao-de-notas-fiscais-de-servico-pelo-emissor-nacional-da-nfs-e) |
| Município pode **antecipar** o uso do Emissor Nacional para os optantes pelo Painel Administrativo Municipal; prazo municipal anterior a 01/11/2026 precisa de ato próprio. | [Portal da NFS-e — Painel Administrativo Municipal](https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-no-painel-administrativo-municipal-permite-antecipar-a-adocao-do-emissor-nacional-para-optantes-pelo-simples-nacional) |
| **CBS/IBS para optantes do Simples:** efeitos a partir de **01/01/2027**, para quem optar pelo destaque de IBS/CBS em setembro de 2026; entre 01/11 e 31/12/2026 vale a regra atual. A ausência das informações de IBS/CBS na NFS-e até 31/12/2026 não gera rejeição pelo sistema nacional. | [CGNFS-e — prazos para destaque de IBS/CBS](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico); a notícia da Receita acima |

Implicação para o ZiisTec: a partir de 01/11/2026 todo prestador do Simples (ME/EPP) precisa emitir NFS-e pelo Emissor Nacional, seja direto no portal, seja por um provedor que fale com o ambiente nacional. **Suporte à NFS-e Nacional é requisito eliminatório**, não diferencial. Enquanto a integração fiscal não existe, o Comprovante de Serviço continua sendo documento **não fiscal** e a tela não pode sugerir o contrário. A janela de CBS/IBS (01/01/2027) torna o bloco de IBS/CBS da NFS-e requisito do leiaute logo depois. Datas da opção pelo regime regular de IBS/CBS mudaram mais de uma vez em 2026 (Resoluções CGSN 186 e 194); conferir a vigente no Portal do Simples Nacional antes de qualquer decisão operacional.

## 9. Comparativo técnico: Candidato A Spedy × Candidato B Focus NFe

Só entra o que está provado em documentação oficial dos provedores (2026-10-29). Fontes: [Spedy — documentação](https://docs.spedy.com.br/llms.txt), [Spedy — preços](https://spedy.com.br/precos), [Spedy — API](https://spedy.com.br/api); [Focus NFe — documentação](https://doc.focusnfe.com.br/), [Focus NFe — preços](https://focusnfe.com.br/precos/), [Focus NFe — NFSe Nacional](https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/). **PENDENTE** = a página oficial não informa; não foi estimado.

| Critério | Candidato A — Spedy | Candidato B — Focus NFe |
|---|---|---|
| NFS-e municipal | Sim: `POST /v1/service-invoices`; cada município é atendido por um provedor; consulta de configuração por código IBGE; município não integrado devolve `404` e a Spedy não emite | Sim: `/v2/nfse` |
| NFS-e Nacional (emissão) | **Parcial.** A documentação trata o Ambiente Nacional/Emissor Nacional como um dos provedores possíveis (DPS; método `annfs`); o provedor certo depende do regime tributário da empresa. **Não há página dedicada** nem lista de campos própria; as páginas de Nacional lidas tratam de NFS-e *recebidas* | **Sim, endpoint dedicado:** `POST /v2/nfsen?ref=…` (produção e homologação), com consulta, cancelamento e reenvio. `habilita_nfsen_producao` **não pode** estar ativo junto com `habilita_nfse` na mesma empresa |
| Multi-CNPJ (SaaS) | Sim: conta titular cria empresas por `POST /v1/companies` com a chave da titular; **cada empresa tem a própria `X-Api-Key`**, certificado, séries e configurações. **Clientes e produtos são da conta e compartilhados entre todas as empresas** (risco de isolamento, §6) | Sim: empresas cadastradas por API com o **token mestre**; cada empresa tem token de produção e de homologação. Documentação não informa limite de empresas. Planos "Growth/Enterprise" indicados para muitos CNPJs; plano para software house/revenda **não publicado** |
| Sandbox / homologação | Sim: `sandbox-api.spedy.com.br`, mesma interface. Se exige CNPJ real/certificado: **PENDENTE** (não informado) | Sim: `homologacao.focusnfe.com.br`, sem validade jurídica. A documentação de cadastro diz que é obrigatório CNPJ real e A1 válido, "mesmo para homologação"; a página de Nacional não detalha. Nem todo município tem homologação de NFS-e. Plano de testes: 30 dias |
| Autenticação | `X-Api-Key` por empresa | HTTP Basic, token da empresa como usuário e senha vazia |
| Idempotência | `integrationId` / `transactionId` informado pelo cliente | `ref` obrigatório e único: repetido devolve 422 ("Já existe um DPS com esta referência"). O que acontece além disso **não é descrito**; tratar como "consultar antes de reenviar" |
| Webhook | Padrão *Standard Webhooks*: HMAC-SHA256 (`webhook-signature`), segredo `whsec_` **da conta**, rotação com janela de sobreposição (0–72 h). Um webhook por conta recebe eventos de todas as empresas | Evento `nfsen` (e `nfsen_recebida`); cabeçalho de autorização estático configurável (`authorization`/`authorization_header`); **sem HMAC do corpo**. Novas tentativas por até 48 h; depois, consultar por GET |
| Certificado A1 | `.pfx` por `POST /v1/companies/{id}/certificates`; um ativo por empresa; Spedy **guarda** o certificado; exigido conforme o provedor do município (outros usam usuário/senha ou token da prefeitura) | `arquivo_certificado_base64` (PFX/P12) + `senha_certificado` no cadastro da empresa; certificado específico da empresa (matriz ≠ filial). Se o Focus guarda o certificado: **não declarado** nas páginas lidas |
| Cancelamento, PDF, XML | Cancelamento `DELETE /v1/service-invoices/{id}` com `reason` (prazo e regras da prefeitura); sem carta de correção nem inutilização; PDF (DANFSe) e XML por API; `check-status` para reconciliar | Cancelamento aceito em todas as cidades aderentes ao Nacional; NFS-e substituta aceita; consulta e reenvio de e-mail/notificação |
| Limites de taxa | 5 req/s e 100 req/min por chave | **PENDENTE** (não informado) |
| Reforma Tributária (IBS/CBS) | NFS-e tem bloco `ibsCbs` no nível da nota (`cst`, classificação, indicador de operação); sem bloco de IS; a API expõe os campos independentemente da fase; datas "conforme cronograma oficial vigente" | O guia "IBS e CBS" da API cobre **NF-e e NFC-e**; para a NFS-e Nacional a documentação lida **não mostra** campos de IBS/CBS (o acompanhamento das NTs aparece só em artigos do blog). **Não confirmado** na API |
| Cobertura de municípios | Lista só pela API/app (`Cidades integradas`); **não conferida** para as cidades reais; nada foi presumido | Aderência ao padrão nacional consultável no painel do governo; município novo fora da cobertura: taxa fixa de R$ 199 (FAQ); cidades reais **não conferidas** |
| Suporte | **Não avaliado** | **Não avaliado** |

**Preço e custo (somente o que as páginas oficiais publicam):**

| Item | Candidato A — Spedy | Candidato B — Focus NFe |
|---|---|---|
| Custo por CNPJ | **PENDENTE:** a página de preços não informa quantos CNPJs cada plano cobre nem regra para CNPJ adicional | Solo R$ 94,90/mês (1 CNPJ); Start R$ 119,90/mês (3 CNPJs) + R$ 39,90 por CNPJ extra; Growth R$ 572,00/mês (CNPJs ilimitados). *Derivado dos números públicos:* até 14 CNPJs o Start é mais barato que o Growth; a partir de 15, o Growth |
| Custo por documento | Planos do produto (cobrança anual): Essencial R$ 890 (1.800 notas/ano, extra R$ 0,62), Avançado R$ 1.890 (7.200, extra R$ 0,44), Profissional R$ 2.490 (24.000, extra R$ 0,35); Enterprise "sob consulta". A página não diz se NFS-e conta como "nota" nem se esses valores valem para a API. **PREÇO DA API: PENDENTE** | Incluídos: 100 (Solo), 100 por CNPJ (Start), 4.000 (Growth); extra R$ 0,11 (Solo/Start) e R$ 0,125 (Growth). Documento emitido **ou recebido** conta como uma unidade. NFS-e divide o mesmo pacote de NF-e/NFC-e |
| Custo inicial | Sem taxa de adesão; sem período de teste (há 7 dias para pedir reembolso). Texto de `/api`: "Sem taxa de setup. O plano é por volume de notas, igual ao do produto" — não diz se a API está incluída | Sem taxa de setup e sem fidelidade; 30 dias de teste |
| Enterprise / revenda / software house | Enterprise "sob consulta"; nenhuma menção a revenda, SaaS multiempresa ou parceiros | Enterprise "Consulte"; plano de software house/revenda não publicado |

Leitura honesta dos números: o custo do Focus é calculável com dados públicos; o da Spedy para o uso do ZiisTec (API, várias empresas na mesma conta, NFS-e) **não é conhecido** e só uma cotação resolve. Nenhum valor foi estimado para a Spedy.

## 10. Recomendação (sem escolha definitiva)

**Spedy adequada: PARCIAL.** Fortes: webhook com HMAC e rotação, chave por empresa, sandbox com a mesma interface, bloco IBS/CBS da NFS-e documentado, limites de taxa claros. Pendências: preço da API e regra de CNPJ por plano; emissão pelo Ambiente Nacional sem página dedicada; clientes compartilhados entre as empresas da conta; cobertura das cidades reais. **Preço da API conhecido: NÃO.**

**Focus NFe adequada: SIM nos requisitos eliminatórios provados** (NFS-e Nacional dedicada, multi-CNPJ por API, homologação, `ref` único, A1 por empresa, preço público), **com lacunas desejáveis:** sem HMAC no webhook (compensada pelo desenho do §6: reconsultar sempre), IBS/CBS da NFS-e Nacional não confirmado na API, CNPJ real e A1 exigidos até na homologação, limites de taxa não informados. **Preço conhecido: SIM.**

**Para o sandbox (F1): ainda inconclusivo.** O Candidato B leva vantagem nos itens provados e no preço calculável; o Candidato A tem a segurança de webhook e a documentação de IBS/CBS melhores, mas não pode ser comparado em custo. A decisão depende de duas coisas que nenhuma página pública resolve: **(1)** cotação da Spedy para API com várias empresas e NFS-e; **(2)** teste de sandbox das cidades reais dos primeiros clientes e do isolamento de clientes na conta da Spedy. Como tudo passa por `FiscalProvider`, nenhuma das duas escolhas é irreversível. Nenhuma conta, contratação ou credencial foi criada.

## 11. Fase F1 — sandbox (planejada, **não executada**)

Pré-condições: H0 concluída; decisão de provedor (ou decisão de comparar os dois); contador valida os campos de `fiscal_settings`; autorização expressa.

0. Antes de qualquer código: pedir cotação de API à Spedy (empresas múltiplas, NFS-e, volume) e confirmar com cada provedor, por escrito, se a homologação exige CNPJ real e certificado. Definir de quem é o CNPJ/certificado de teste (nunca o de cliente sem consentimento).
1. Conta de **sandbox** do(s) provedor(es) escolhido(s) (credencial só em variável de ambiente do ambiente de homologação; nunca em repositório).
2. Migration de `fiscal_settings`, `fiscal_documents`, `fiscal_webhook_events` e RPCs, **só no Staging descartável**, com teste SQL rollback-safe (isolamento por empresa, só dono, índice de NFS-e ativa, transições, idempotência, técnico sem acesso).
3. Adaptador mínimo + testes contratuais com cliente falso (assinatura/token inválido, replay, evento repetido, timeout seguido de consulta, erro normalizado, status fora de ordem). A mesma bateria vale para os dois adaptadores.
4. Empresa fictícia de teste: emitir, receber webhook, baixar PDF/XML, cancelar, rejeição forçada; conferir as cidades reais e o leiaute com IBS/CBS.
5. Critério de saída: nenhum documento duplicado em 100 repetições de envio e de webhook; nenhum segredo em log, bundle ou resposta; chave de produção ausente do ambiente; tomador de uma empresa nunca visível a outra.
6. Produção fiscal fica para outra decisão, depois de piloto com um cliente e contador.

## 12. Fora de escopo agora e perguntas em aberto

Escopo fora: emissão real, certificado real, tela de emissão, NFS-e em lote, NF-e de produto, conciliação fiscal, retenções calculadas automaticamente além dos campos informados.

Em aberto: quais municípios os clientes reais usam e se estão no padrão nacional; regime e CNAE dos primeiros clientes; se o certificado fica no provedor; modelo de repasse de custo ao cliente; regra de cancelamento por prazo/município; campos de IBS/CBS exigidos no leiaute vigente da NFS-e Nacional; preço da API da Spedy; limites de taxa do Focus.

**Fiscal readiness: PASS (desenho).** Fronteira com o comprovante não fiscal definida, interface neutra, estados e idempotência especificados, segurança de segredos/certificado/webhook especificada, regulatório conferido em fonte oficial, plano de sandbox escrito e não executado.
