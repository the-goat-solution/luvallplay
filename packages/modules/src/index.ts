// @luvallplay/modules: the module system skeleton (build plan §6.2).
export {
  PAYMENT_MODES,
  allowedPaymentModes,
  canTurnOff,
  canTurnOn,
  defineModule,
  validateRegistry,
  withRequirements,
  type Availability,
  type ClubModuleState,
  type ModuleGroup,
  type ModuleManifest,
  type ModuleScope,
  type PaymentMode,
  type Payments,
  type SettingsSchema,
  type SwitchContext,
  type SwitchResult,
} from "./define.ts";
export * from "./registry.ts";
