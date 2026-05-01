#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { openDb } from './store/db.ts';
import { seedRegistryIfEmpty } from './registryBoot.ts';
import { SamplingClient } from './sampling/client.ts';
import { toolDefinitions, type ToolCtx } from './tools/index.ts';
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';

export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.0.1';

export function bootstrap() {
  const db = openDb();
  seedRegistryIfEmpty(db);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } } // sampling is a CLIENT capability
  );
  const sampling = new SamplingClient(server as unknown as ConstructorParameters<typeof SamplingClient>[0]);
  const ctx: ToolCtx = { db, sampling };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as object
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const def = toolDefinitions.find(t => t.name === req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await def.run(req.params.arguments ?? {}, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return { db, server, sampling };
}

export async function main() {
  const { server } = bootstrap();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
