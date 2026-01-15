// Initialize infrastructure knowledge with common commands
// Run once with: npx ts-node src/work/tools/infra-init.ts

import { addKnowledge } from '../storage/infrastructure.js';

async function initializeKnowledge() {
  console.log('Initializing infrastructure knowledge...\n');

  // === TSH (Teleport) Commands ===
  
  await addKnowledge('command', 'tsh-kube-ls', 'tsh kube ls', {
    context: 'List available Kubernetes environments. Requires login - if expired, user needs to complete interactive login.',
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'tsh-kube-login', 'tsh kube login <env>', {
    context: 'Login to a specific Kubernetes environment',
    examples: ['tsh kube login example-staging-region-1'],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'tsh-db-ls', 'tsh db ls --search <query>', {
    context: 'Search for available databases in Teleport',
    examples: ['tsh db ls --search mydb', 'tsh db ls --search example-env'],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'tsh-db-login', 'tsh db login <db> --db-user <user> --db-name <db-name>', {
    context: 'Login to a database. Must be done before proxying.',
    examples: [
      'tsh db login mydb-abc12345-staging-1 --db-user db-admin@staging-1.iam --db-name myappdb'
    ],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'tsh-proxy-db', 'tsh proxy db <db> --port=<port>', {
    context: 'Proxy a database to localhost. Run after tsh db login. Keep terminal open while using.',
    examples: ['tsh proxy db mydb-abc12345-region-1 --port=54321'],
    learnedFrom: 'initial setup',
  });

  // === Kubectl Commands ===

  await addKnowledge('command', 'kubectl-get-pods', 'kubectl get pods -n <namespace> | grep <service>', {
    context: 'List pods in a namespace, optionally filtering by service name',
    examples: [
      'kubectl get pods -n default | grep api-service',
      'kubectl get pods -n production | grep api'
    ],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'kubectl-port-forward', 'kubectl port-forward pod/<pod> <local-port>:<remote-port> -n <namespace>', {
    context: 'Port forward to a specific pod. Ports vary between services and environments.',
    examples: ['kubectl port-forward pod/api-service-a1b2c3d4e-xyz12 8080:8080'],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('command', 'kubectl-logs', 'kubectl logs <pod> -n <namespace> --tail=<lines>', {
    context: 'Get logs from a pod. Add -f to follow.',
    examples: [
      'kubectl logs api-service-a1b2c3d4e-xyz12 -n default --tail=100',
      'kubectl logs api-service-a1b2c3d4e-xyz12 -n default -f'
    ],
    learnedFrom: 'initial setup',
  });

  // === API Service Info ===

  await addKnowledge('service', 'api-namespace', 'default', {
    context: 'API service runs in the default namespace',
    learnedFrom: 'initial setup',
  });

  await addKnowledge('service', 'app-pod-pattern', 'api-service-v1', {
    context: 'API pods follow this naming pattern',
    learnedFrom: 'initial setup',
  });

  await addKnowledge('database', 'app-db-name', 'myappdb', {
    context: 'Main database name for connection',
    learnedFrom: 'initial setup',
  });

  await addKnowledge('database', 'app-staging-db', 'mydb-abc12345-staging-1', {
    context: 'Main database in staging environment',
    examples: [
      'tsh db login mydb-abc12345-staging-1 --db-user db-admin@staging-1.iam --db-name myappdb'
    ],
    learnedFrom: 'initial setup',
  });

  await addKnowledge('credential', 'app-staging-db-user', 'db-admin@staging-region-1.iam', {
    context: 'DB user for staging environment',
    learnedFrom: 'initial setup',
  });

  // === General Notes ===

  await addKnowledge('kubernetes', 'namespace-convention', 'Most services use "default" namespace, some have dedicated namespaces', {
    context: 'Check service documentation or ask if unsure about namespace',
    learnedFrom: 'initial setup',
  });

  await addKnowledge('kubernetes', 'port-variation', 'Service ports vary between services and environments', {
    context: 'Always verify the correct port for the specific service and environment. Common ports: 8080, 3000, 5000',
    learnedFrom: 'initial setup',
  });

  console.log('✅ Infrastructure knowledge initialized!\n');
  console.log('The assistant now knows:');
  console.log('- TSH commands (kube ls, kube login, db ls, db login, proxy db)');
  console.log('- Kubectl commands (get pods, port-forward, logs)');
  console.log('- API service details (namespace, pod pattern, DB info)');
  console.log('\nYou can teach it more as you work together!');
}

initializeKnowledge().catch(console.error);


