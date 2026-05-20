export { Plugin, RpcCallError, apiVersion } from "./plugin.js";
export { Log } from "./log.js";
export { PushCommands } from "./commands.js";
export { ListenLocal, Listener, type ConnectInfo } from "./listen.js";
export { UpstreamClient } from "./upstream.js";
export * from "./contracts_gen.js";
export * from "./types_gen.js";
import "./methods_gen.js"; // module augmentation — side-effect import
import "./collection_log.js"; // module augmentation — log-kind helpers
import "./collection.js"; // module augmentation — state uniform helpers
import "./effects.js"; // module augmentation — capability-mechanism helpers
import "./debug.js"; // module augmentation — per-plugin debug log helper
export { RecordingDisabledError, logListOpts } from "./collection_log.js";
export { listOpts, type CollectionChangedEvent } from "./collection.js";
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
