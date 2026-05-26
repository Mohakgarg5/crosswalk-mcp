/**
 * Library entry consumed by the web surface (apps/web) via `crosswalk-mcp/runtime`.
 * Importing this module self-registers every ATS adapter (side-effect imports),
 * mirroring what src/server.ts does for the MCP surface.
 */
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

export { openDb } from './store/db.ts';
export type { Db } from './store/db.ts';
export { seedRegistryIfEmpty } from './registryBoot.ts';
export { SamplingClient } from './sampling/client.ts';
export type { CompleteOpts } from './sampling/client.ts';
export { ApiSamplingBackend, DEFAULT_MODEL } from './sampling/apiBackend.ts';
export type { AnthropicLike, ApiSamplingBackendOpts } from './sampling/apiBackend.ts';
export { LazyPlaywrightBrowser } from './services/browser/playwright.ts';
export { toolDefinitions } from './tools/index.ts';
export type { ToolCtx } from './tools/index.ts';
export { paths } from './config.ts';
export { getConfig, setConfig, DEFAULT_APP_CONFIG } from './store/appConfig.ts';
export type { AppConfig, SubmitPolicy } from './store/appConfig.ts';
