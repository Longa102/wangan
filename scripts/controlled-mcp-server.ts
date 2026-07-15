/** Start the repository-local controlled MCP upstream for Agent integration tests. */
import { createControlledMcpServer } from '../src/lab/controlled-mcp-server';

const port = Number(process.env.CONTROLLED_MCP_PORT ?? 9100);
const { server, sandboxRoot, auditLogPath } = createControlledMcpServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`[Controlled MCP] listening on http://127.0.0.1:${port}`);
  console.log(`[Controlled MCP] sandbox root: ${sandboxRoot}`);
  console.log(`[Controlled MCP] audit log: ${auditLogPath}`);
  console.log('[Controlled MCP] exec and net.fetch are dry-run only.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
