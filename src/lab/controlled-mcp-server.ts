/**
 * 受控 MCP 测试上游。
 *
 * 这是给真实 Agent 集成演示使用的 HTTP JSON-RPC MCP Server：
 * - 所有文件路径必须相对 sandboxRoot，且会被限制在该目录内；
 * - fs.write 仅允许写入 sandboxRoot/output；
 * - 对外工具带 wangan_lab 前缀，避免被 Agent 的内置工具同名覆盖；
 * - simulate_command / simulate_request 永远只返回 dry-run 结果，不执行命令、不访问网络；
 * - 每次请求都会写入本地审计日志，方便证明被安全代理拦截的请求没有抵达上游。
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { JsonRpcRequest, JsonRpcResponse, MCP_ERROR_CODES, MCP_METHODS, McpTransport } from '../proxy/mcp-transport';

export interface ControlledMcpOptions {
  sandboxRoot?: string;
  auditLogPath?: string;
}

export interface ControlledMcpServer {
  server: http.Server;
  sandboxRoot: string;
  auditLogPath: string;
}

const TOOL_DEFINITIONS = [
  {
    name: 'wangan_lab.read_fixture',
    description: 'WANGAN LAB ONLY: read a UTF-8 fixture relative to the controlled sandbox root. Use for integration demonstrations, never use an editor built-in Read tool.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'wangan_lab.write_artifact',
    description: 'WANGAN LAB ONLY: write a UTF-8 test artifact below output/ only. This controlled server cannot write outside its sandbox.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'wangan_lab.simulate_command',
    description: 'WANGAN LAB ONLY: submit a command to the wangan security proxy. The controlled upstream never executes it; use this tool to demonstrate ALLOW or BLOCK decisions.',
    inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
  {
    name: 'wangan_lab.simulate_request',
    description: 'WANGAN LAB ONLY: submit a network request to the wangan security proxy. The controlled upstream never sends network traffic.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' }, method: { type: 'string' }, body: { type: 'string' } },
      required: ['url'],
    },
  },
];

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

function errorResponse(id: string | number, code: number, message: string): JsonRpcResponse {
  return McpTransport.createErrorResponse(id, code, message);
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    request.on('error', reject);
  });
}

function writeAudit(auditLogPath: string, event: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
  fs.appendFileSync(auditLogPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, 'utf-8');
}

function resolveSandboxPath(sandboxRoot: string, requestedPath: unknown): string {
  if (typeof requestedPath !== 'string' || requestedPath.trim() === '') {
    throw new Error('path must be a non-empty relative path');
  }
  if (path.isAbsolute(requestedPath) || /^[a-zA-Z]:[\\/]/.test(requestedPath)) {
    throw new Error('absolute paths are not allowed in the controlled sandbox');
  }

  const resolved = path.resolve(sandboxRoot, requestedPath);
  const relative = path.relative(sandboxRoot, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('path escapes the controlled sandbox');
  }
  return resolved;
}

function isBelow(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function handleRequest(
  request: JsonRpcRequest,
  sandboxRoot: string,
  auditLogPath: string,
): Promise<JsonRpcResponse> {
  const params = request.params ?? {};

  if (request.method === MCP_METHODS.INITIALIZE) {
    return McpTransport.createSuccessResponse(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'wangan-controlled-mcp', version: '1.0.0' },
    });
  }

  if (request.method === MCP_METHODS.TOOLS_LIST) {
    return McpTransport.createSuccessResponse(request.id, { tools: TOOL_DEFINITIONS });
  }

  if (request.method !== MCP_METHODS.TOOLS_CALL) {
    return errorResponse(request.id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unsupported method: ${request.method}`);
  }

  const toolName = params.name;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (typeof toolName !== 'string') {
    return errorResponse(request.id, MCP_ERROR_CODES.INVALID_PARAMS, 'tools/call requires params.name');
  }

  try {
    switch (toolName) {
      case 'wangan_lab.read_fixture':
      case 'fs.read': {
        const filePath = resolveSandboxPath(sandboxRoot, args.path);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          throw new Error(`test fixture not found: ${String(args.path)}`);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        writeAudit(auditLogPath, { tool: toolName, status: 'allowed', path: args.path });
        return McpTransport.createSuccessResponse(request.id, textResult(content));
      }

      case 'wangan_lab.write_artifact':
      case 'fs.write': {
        const filePath = resolveSandboxPath(sandboxRoot, args.path);
        const outputRoot = path.join(sandboxRoot, 'output');
        if (!isBelow(filePath, outputRoot)) {
          throw new Error('fs.write is restricted to the output/ directory in the controlled sandbox');
        }
        if (typeof args.content !== 'string') {
          throw new Error('content must be a string');
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content, 'utf-8');
        writeAudit(auditLogPath, { tool: toolName, status: 'allowed', path: args.path, bytes: Buffer.byteLength(args.content) });
        return McpTransport.createSuccessResponse(request.id, textResult(`[controlled-mcp] Wrote test artifact: ${args.path}`));
      }

      case 'wangan_lab.simulate_command':
      case 'exec': {
        writeAudit(auditLogPath, { tool: toolName, status: 'dry-run', command: String(args.command ?? '') });
        return McpTransport.createSuccessResponse(request.id, textResult(`[controlled-mcp] DRY-RUN: command was not executed: ${String(args.command ?? '')}`));
      }

      case 'wangan_lab.simulate_request':
      case 'net.fetch': {
        writeAudit(auditLogPath, { tool: toolName, status: 'dry-run', url: String(args.url ?? ''), method: String(args.method ?? 'GET') });
        return McpTransport.createSuccessResponse(request.id, textResult(`[controlled-mcp] DRY-RUN: no network request was sent to ${String(args.url ?? '')}`));
      }

      default:
        return errorResponse(request.id, MCP_ERROR_CODES.METHOD_NOT_FOUND, `Unknown controlled tool: ${toolName}`);
    }
  } catch (error) {
    writeAudit(auditLogPath, { tool: toolName, status: 'rejected-by-sandbox', detail: String(error) });
    return errorResponse(request.id, MCP_ERROR_CODES.INVALID_PARAMS, String(error));
  }
}

export function createControlledMcpServer(options: ControlledMcpOptions = {}): ControlledMcpServer {
  const sandboxRoot = path.resolve(options.sandboxRoot ?? path.join(process.cwd(), 'sandbox'));
  const auditLogPath = path.resolve(options.auditLogPath ?? path.join(process.cwd(), 'logs', 'controlled-mcp-audit.jsonl'));
  fs.mkdirSync(path.join(sandboxRoot, 'output'), { recursive: true });

  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'POST only' }));
      return;
    }

    let rpcRequest: JsonRpcRequest;
    try {
      rpcRequest = JSON.parse(await readBody(request)) as JsonRpcRequest;
      if (rpcRequest.jsonrpc !== '2.0' || rpcRequest.id === undefined || typeof rpcRequest.method !== 'string') {
        throw new Error('Invalid JSON-RPC 2.0 request');
      }
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(errorResponse(0, MCP_ERROR_CODES.PARSE_ERROR, String(error))));
      return;
    }

    const rpcResponse = await handleRequest(rpcRequest, sandboxRoot, auditLogPath);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(rpcResponse));
  });

  return { server, sandboxRoot, auditLogPath };
}
