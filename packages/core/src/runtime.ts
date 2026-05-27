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
export { getProfile } from './store/profile.ts';
export type { Profile } from './store/profile.ts';
export { getApplication, listEventsForApplication } from './store/application.ts';
export type { Application, ApplicationEvent, ApplicationStatus } from './store/application.ts';

// Discovery alerts (saved searches + notifications)
export { createSavedSearch, listSavedSearches, getSavedSearch, deleteSavedSearch, setSavedSearchAutoApply } from './store/savedSearch.ts';
export type { SavedSearch, SavedSearchFilters, SearchSource } from './store/savedSearch.ts';
export { runWatch } from './services/watchEngine.ts';
export type { WatchRunResult, WatchSearchOutcome } from './services/watchEngine.ts';
export { listNotifications, unreadCount, markAllRead } from './store/notification.ts';
export type { Notification } from './store/notification.ts';
export { refreshSavedSearch, refreshAllSavedSearches } from './services/savedSearchEngine.ts';

// Recruiter email routing
export { getEmailAccount, setEmailAccount, listInboundEmails } from './store/email.ts';
export type { EmailAccount, InboundEmail } from './store/email.ts';
export { routeEmail } from './services/emailRouter.ts';
export type { IncomingEmail, RouteResult } from './services/emailRouter.ts';

// Autonomous apply ("apply on my behalf")
export { autoApply } from './services/autoApplyEngine.ts';
export type { AutoApplyOptions, AutoApplyOutcome, AutoApplySummary } from './services/autoApplyEngine.ts';

// Role-based discovery across thousands of companies + bulk registry growth
export { searchRoles } from './services/roleSearch.ts';
export type { RoleSearchOptions, RoleSearchJob, RoleSearchResult } from './services/roleSearch.ts';
export { importCompanies, countCompanies, listAllCompanies, KNOWN_ATS } from './store/company.ts';
export type { CompanyImportEntry, Company } from './store/company.ts';
