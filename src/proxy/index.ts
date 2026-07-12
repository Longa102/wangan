/**
 * MCP Security Proxy — 模块入口
 * 负责人：C
 *
 * 导出代理核心类，供外部启动脚本使用。
 * 集成示例见 scripts/start.ts
 */

export { McpSecurityProxy } from './middleware';
export type { ProxyConfig } from './middleware';
export { RequestInterceptor } from './request-interceptor';
export { ResponseInterceptor } from './response-interceptor';
export type { ToolCallContext } from './request-interceptor';
export type { ToolResponseContext } from './response-interceptor';
