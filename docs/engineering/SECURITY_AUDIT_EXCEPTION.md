# Exceção temporária da auditoria de desenvolvimento

O gate `npm run security:audit` continua executando `npm audit` contra o registry,
primeiro com `--omit=dev`, depois com todas as dependências. Runtime não admite
nenhuma vulnerabilidade HIGH/CRITICAL. Falhas de execução, rede, JSON, schema ou
contagens inconsistentes bloqueiam o gate.

A única exceção é [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
stack exhaustion em `braces`, exclusivamente na cadeia de desenvolvimento do
Tailwind 3. A exceção cobre o advisory exato e seu impacto transitivo, validando
todos os caminhos `via` e exigindo `dev: true` no lockfile para cada nó afetado.
Não permite outro advisory HIGH/CRITICAL, presença no relatório runtime, pacote
sem comprovação de uso exclusivo em desenvolvimento ou advisory elevado a CRITICAL.

Motivo: não há versão corrigida de `braces` para esse advisory na verificação desta
rodada. A sugestão atual de `npm audit` é migrar Tailwind para a versão 4, mudança
major de arquitetura/build fora do escopo desta consolidação. Essa sugestão não
representa uma versão corrigida de `braces`. O gate aceita somente ausência de
correção ou sugestão explícita de migração major do Tailwind; uma correção de
`braces` ou outro formato de remediação bloqueia a exceção para revisão.

Remover a exceção assim que houver versão corrigida: atualizar seletivamente a
dependência/lockfile, confirmar a remoção do advisory nas duas auditorias, executar
verify/build e retirar a permissão do gate e esta documentação. Reavaliar também
se a cadeia deixar de ser exclusivamente de desenvolvimento ou Tailwind for
migrado em tarefa própria. Não processar padrões não confiáveis com as ferramentas
afetadas durante esse período. A exceção não altera CodeQL, não desabilita audit e
não permite ignorar falhas de outros gates.
