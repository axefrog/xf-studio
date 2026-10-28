/** Explicit production-product adapters for released behavior tests. Neutral services have no makeup defaults. */
import { EYE_MAKEUP_PRODUCT as product } from "../../src/features/eye-makeup/product";
export { EYE_ARTISTRY_REQUIREMENTS, XBOX_UNSUPPORTED_MESSAGE } from "../../src/features/eye-makeup/product";
import * as catalogue from "../../src/installation/framework-catalogue";
import * as versions from "../../src/installation/framework-versions";
import * as detection from "../../src/installation/install-detection";
import * as server from "../../src/installation/host/install-detection-server";
import * as transport from "../../src/installation/host/mod-install-transport";
import * as host from "../../src/installation/host/mod-install-host";
import * as stage from "../../src/installation/host/runtime-diagnostic-stage";
import * as promotion from "../../src/installation/host/runtime-diagnostic-promotion";
import * as setup from "../../src/setup/wolvenkit-setup";
import * as preview from "../../src/preview/preview-setup";

export const requirementsForProducts = (products: readonly catalogue.FrameworkProduct[] = []) => catalogue.requirementsForProducts([{ name: product.modName, requirements: product.requirements }, ...products]);
export const frameworkVerdicts = (frameworks: Parameters<typeof catalogue.frameworkVerdicts>[0], route: "direct" | "mo2", requirements = product.requirements) => catalogue.frameworkVerdicts(frameworks, route, requirements, product.modName);
export const frameworkRouteReport = (...args: Parameters<typeof catalogue.frameworkRouteReport>) => catalogue.frameworkRouteReport(args[0], args[1], args[2], args[3], args[4] ?? product.requirements, product.modName);
export const checkFrameworkVersions = (port: versions.FrameworkHostPort, input: versions.FrameworkCheckInput) => versions.checkFrameworkVersions(port, input, product);
export const detectGameInstalls = (port: detection.DetectionHostPort, mo2?: detection.Mo2Detection | null) => detection.detectGameInstalls(port, mo2, product);
export const hostFrameworkCheck = (settings: versions.FrameworkCheckInput, port?: () => versions.FrameworkHostPort) => server.hostFrameworkCheck(settings, port, product);
export const profileFrameworkMods = (settings: versions.FrameworkCheckInput, port?: () => versions.FrameworkHostPort) => server.profileFrameworkMods(settings, port, product);
export const createInstallDetectionHandler = (host?: Parameters<typeof server.createInstallDetectionHandler>[0], frameworks?: server.FrameworkCheckSource | null) => server.createInstallDetectionHandler(host, frameworks ? { ...frameworks, product } : frameworks, product);
export const createModInstallTransport = (config: transport.InstallTransportConfig) => transport.createModInstallTransport({ defaults: product, ...config });
export const inspectLocalPackageCandidate = (store: string, candidate: string) => transport.inspectLocalPackageCandidate(store, candidate, product);
export class ModInstallHost extends host.ModInstallHost { constructor(ports: host.ModInstallPorts) { super({ defaults: product, ...ports }); } }
export const profileFrameworks = (game: string, mo2: string, profile: string) => stage.profileFrameworks(game, mo2, profile, product);
export const diagnosticPlacement = (source: string, frameworks?: Iterable<string>, name?: string) => stage.diagnosticPlacement(source, frameworks, name, product);
export const diagnosticModlist = (source: string, frameworks?: Iterable<string>, name?: string) => stage.diagnosticModlist(source, frameworks, name, product);
export const candidateModName = (manifest: { modName?: string }) => stage.candidateModName(manifest, product);
export const legacyModFolder = (folder: string) => stage.legacyModFolder(folder, product);
export const planRuntimeDiagnostic = (options: stage.RuntimeDiagnosticOptions) => stage.planRuntimeDiagnostic({ defaults: product, ...options });
export const stageRuntimeDiagnostic = (options: stage.RuntimeDiagnosticOptions) => stage.stageRuntimeDiagnostic({ defaults: product, ...options });
export const planRuntimePromotion = (options: promotion.PromotionOptions) => promotion.planRuntimePromotion({ defaults: product, ...options });
export const promoteRuntimeDiagnostic = (options: promotion.PromotionOptions) => promotion.promoteRuntimeDiagnostic({ defaults: product, ...options });
export const recoverRuntimePromotion = (options: promotion.PromotionOptions) => promotion.recoverRuntimePromotion({ defaults: product, ...options });
export const rollbackRuntimePromotion = (options: promotion.PromotionOptions) => promotion.rollbackRuntimePromotion({ defaults: product, ...options });
export const wolvenKitConsent = (state: setup.WolvenKitSetupState) => setup.wolvenKitConsent(state, product.modName);
export class PreviewSetupActions extends preview.PreviewSetupActions { constructor(port: preview.PreviewSetupPort) { super({ modName: product.modName, ...port }); } }
