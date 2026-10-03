import 'reflect-metadata';
import Samble from './core/samble';
export {
  HttpGet,
  HttpPost,
  HttpDelete,
  HttpPut,
  HttpPatch,
  HttpQuery,
} from './decorators/http.decorator';
export { Body, Params, Query } from './decorators/request.decorator';
export { Group } from './decorators/group.decorator';
export type { GroupOptions, GroupMetadata } from './decorators/group.decorator';
export { Priority } from './decorators/priority.decorator';
export { Cron } from './decorators/cron.decorator';
export type { CronMetadata, CronOptions } from './decorators/cron.decorator';
export { Use } from './decorators/use.decorator';
export type { MiddlewareFn, UseMetadata } from './decorators/use.decorator';
export {
  ApiTag,
  ApiSummary,
  ApiDescription,
  ApiResponse,
  ApiHidden,
} from './decorators/openapi.decorator';
export { Deprecated } from './decorators/deprecated.decorator';
export type {
  DeprecatedOptions,
  DeprecatedMetadata,
} from './decorators/deprecated.decorator';
export { Output, view, pdf, csv, file } from './outputs';
export type {
  FileContent,
  FileOptions,
  PdfOptions,
  CsvColumn,
  CsvOptions,
} from './outputs';
export { OpenAPIGenerator } from './services/openapi-generator';
export type {
  OpenAPIInfo,
  OpenAPIDocument,
} from './services/openapi-generator';
export { defineModule } from './modules/define-module';
export {
  MODULE_LAYOUT,
  ModuleDefinitionError,
} from './modules/module-manifest';
export {
  resolveModules,
  ModuleResolutionError,
} from './modules/resolve-modules';
export { reconcileModules } from './modules/reconcile-modules';
export { ModuleStore } from './modules/module-store';
export {
  ModuleMigrator,
  ModuleMigrationError,
  orderMigrations,
} from './modules/module-migrator';
export type { AppliedMigration, Migration } from './modules/module-migrator';
export {
  loadModules,
  loadModuleEndpoints,
  loadModuleRoutines,
  loadModuleStrategies,
  toEndpointReaders,
  resolveModulePattern,
} from './modules/module-loader';
export type { LoadedModule, LoadedStrategy } from './modules/module-loader';
export { collectModuleTables } from './modules/collect-tables';
export type {
  Database,
  DatabaseOptions,
  Transaction,
} from './modules/database';
export { rows, tableExists } from './modules/database';
export { Container, ContractError } from './modules/container';
export { token } from './modules/token';
export type { TokenKind } from './modules/token';
export type { Reaction, Slot } from './modules/slots';
export { Scheduler, ScheduleError } from './modules/schedules';
export type { ScheduleToken, ScheduleHandle } from './modules/schedules';
export { PermissionRegistry } from './modules/permissions';
export type { PermissionsOf } from './modules/permissions';
export type { RegisteredPermission } from './modules/permissions';
export type { Contract } from './modules/container';
export { buildContainer } from './modules/build-container';
export type {
  ModuleState,
  ModuleOrphan,
  Reconciliation,
} from './modules/reconcile-modules';
export type {
  ModuleManifest,
  ResolvedModule,
  ModulePermission,
  PermissionDeclaration,
  PermissionKeysOf,
  ModuleTable,
  ModuleMigrations,
  ModulePattern,
  ModuleGlobField,
} from './modules/module-manifest';
export { Auth, defineAuth } from './core/auth';
export { cacheAuth } from './core/auth-cache';
export type { AuthCacheOptions, CachedAuthResolver } from './core/auth-cache';
export { CorsConfigError } from './core/cors';
export type { CorsConfig } from './core/cors';
export {
  diffSnapshots,
  emptySnapshot,
  liveDrift,
  moduleSnapshot,
  tableOwners,
} from './modules/schema-diff';
export type { SchemaDiff, SchemaSnapshot } from './modules/schema-diff';
export { buildHealth } from './core/health';
export { buildRequestId, currentRequestId } from './core/request-id';
export type { RequestIdConfig } from './core/request-id';
export type {
  HealthCheck,
  HealthConfig,
  HealthReport,
  HealthStatus,
} from './core/health';
export type {
  Actor,
  AuthResult,
  AuthResolver,
  AuthContext,
  PermissionKey,
} from './core/auth';
export * from './templates/endpoint';
export * from './templates/routine';
export * from './templates/provider';
export * from './templates/strategy';
export { Provides } from './decorators/provides.decorator';
export type { ProvidesMetadata } from './decorators/provides.decorator';
export { Fills } from './decorators/fills.decorator';
export type { FillsMetadata } from './decorators/fills.decorator';
export * from './utilities/logger';
export type { LogFiles, LoggerOptions } from './services/log4js';
export * from './utilities/errors';
export * from './utilities/config-service';
export { HttpStatus } from './interfaces/http-status';
export type { UploadedFile } from './interfaces/uploaded-file';
export * from './interfaces/type-error';
export type { SambleOptions, DocsConfig } from './core/samble';
export { Samble };
