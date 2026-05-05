#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { openDb } from './store/db.ts';
import { seedRegistryIfEmpty } from './registryBoot.ts';
import { SamplingClient } from './sampling/client.ts';
import { toolDefinitions, type ToolCtx } from './tools/index.ts';
import { listResources, readResource } from './resources/index.ts';
import { pathToFileURL } from 'node:url';
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';
import './ats/workable.ts';
import './ats/smartrecruiters.ts';
import './ats/bamboohr.ts';
import './ats/recruitee.ts';
import './ats/personio.ts';
import './ats/workday.ts';
import './ats/icims.ts';

export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.6.0';

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

  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: listResources()
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async req => {
    const out = await readResource(req.params.uri, { db });
    return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: out.text }] };
  });

  return { db, server, sampling };
}

export async function main() {
  const { server } = bootstrap();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
