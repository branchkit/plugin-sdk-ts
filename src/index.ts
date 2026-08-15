import "./proxy.js"; // side-effect: route fetch through BRANCHKIT_PROXY when sandboxed (per-host tier)
export {
  Plugin,
  RpcCallError,
  RecordingDisabledError,
  errorKindOf,
  apiVersion,
} from "./plugin.js";
export type { FaultData } from "./plugin.js";
export { Log } from "./log.js";
export {
  PushCommands,
  command,
  CommandBuilder,
  word,
  oneOf,
  capture,
  text,
  loadCommands,
  pushCommandSpecs,
  pushCommandGroup,
  type PatternSlot,
} from "./commands.js";
export { ListenLocal, Listener, inheritedListenerCount, type ConnectInfo } from "./listen.js";
export { UpstreamClient } from "./upstream.js";
// Closed vocabularies generated from the actuator (error kinds, input
// directives, effect names). Go gets these for free via package `shared`.
export * from "./closed_vocab_gen.js";
export * from "./contracts_gen.js";
export * from "./types_gen.js";
import "./methods_gen.js"; // module augmentation — side-effect import
import "./collection_log.js"; // module augmentation — log-kind helpers
import "./collection.js"; // module augmentation — state uniform helpers
import "./effects.js"; // module augmentation — capability-mechanism helpers
import "./debug.js"; // module augmentation — per-plugin debug log helper
import "./mirror.js"; // module augmentation — consumed-collection mirror
export { CollectionMirror } from "./mirror.js";
import "./settings.js"; // module augmentation — typed settings mirror
export { SettingsMirror } from "./settings.js";
export { methodURL, methodPost } from "./settings_route.js";
export { logListOpts } from "./collection_log.js";
export {
  listOpts,
  scopeCollection,
  scopeGroup,
  type CollectionChangedEvent,
  type ReplaceScope,
  type ReplaceResult,
  type ReplaceDisplay,
} from "./collection.js";
export {
  type AssertEffectResult,
  type RetractEffectResult,
  type IsEffectActiveResult,
  type EffectDisplacedEvent,
} from "./effects.js";
export {
  type PipelineEvent,
  PipelineReader,
  PipelineWriter,
} from "./pipeline.js";
