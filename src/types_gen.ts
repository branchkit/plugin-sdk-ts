// AUTO-GENERATED from contracts/*.json — do not edit.
// Run: python3 contracts/generate_types_ts.py

// ===== Shared types (from components/schemas) =====

export interface AXElementInfo {
  role: string;
  subrole?: string;
  title?: string;
  value?: unknown;
  description?: string;
  position?: number[];
  size?: number[];
  enabled: boolean;
  focused: boolean;
  children_count: number;
  actions: string[];
  attributes: string[];
  path: AXPathSegment[];
}

export interface AXElementNode {
  element: AXElementInfo;
  children: AXElementNode[];
}

export interface AXElementRef {
  pid: number;
  path?: AXPathSegment[];
}

export interface AXPathSegment {
  role: string;
  index: number;
}

export interface AppData {
  name: string;
  bundle_id: string;
  aliases?: string[];
  enabled?: boolean;
}

export interface ApplescriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface AudioDevice {
  id: number;
  uid: string;
  name: string;
  is_input: boolean;
  is_output: boolean;
  is_default_input: boolean;
  is_default_output: boolean;
}

export interface BoolResult {
  result: boolean;
}

export interface ClipboardContents {
  content_type: string;
  text?: string;
  file_urls?: string[];
  image_base64?: string;
  available_types: string[];
}

export interface Command {
  phrase: unknown;
  action: unknown;
  requires_tags?: string[];
  sets_tags?: string[];
  clears_tags?: string[];
}

export interface DiscoveryResult {
  opened: boolean;
  shell_action?: string;
}

export interface DisplayInfo {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  visible_x: number;
  visible_y: number;
  visible_w: number;
  visible_h: number;
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudItem {
  id: string;
  tag?: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface HudResponse {
  title: string;
  footer: string;
  content_html?: string;
  sections?: HudSection[];
}

export interface HudSection {
  title: string;
  items: HudItem[];
}

export interface MatchResult {
  matched: boolean;
  action?: unknown;
  args?: string[];
  consumed_count?: number;
  sets_tags?: string[];
  clears_tags?: string[];
  requires_tags?: string[];
  owner_plugin?: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface RunningApp {
  pid: number;
  bundle_id?: string;
  name: string;
  is_hidden: boolean;
  is_active: boolean;
}

export interface UserSessionInfo {
  username: string;
  full_name: string;
  home_directory: string;
}

export interface WindowDetail {
  window_id: string;
  title?: string;
  subrole?: string;
  is_minimized: boolean;
  is_fullscreen: boolean;
  is_focused: boolean;
  alpha?: number;
  bounds: unknown;
  display_id: number;
}

export interface WindowFrame {
  window_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInfo {
  id: string;
  app_id: string;
  app_name: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  source?: string;
}

export interface WorldModel {
  windows?: WindowInfo[];
  displays?: DisplayInfo[];
  active_window_id?: string;
  active_app?: string;
}

// ===== Plugin → Actuator request/response types =====

export interface StorePushRequest {
  name: string;
  data: unknown;
}

export interface StorePushResponse {
  ok: boolean;
}

export interface StoreGetRequest {
  name: string;
}

export interface StoreGetResponse {
  data?: unknown;
}

export interface TagsGetResponse {
  tags: string[];
}

export interface TagsModifyRequest {
  set?: string[];
  clear?: string[];
  clear_scoped?: boolean;
}

export interface TagsModifyResponse {
  tags: string[];
}

export interface CommandsMatchRequest {
  words: string[];
  active_tags?: string[];
}

export interface CommandsHasPartialRequest {
  words: string[];
  active_tags?: string[];
}

export interface CommandsHasPartialResponse {
  has_partial: boolean;
  next_list?: string;
}

export interface CommandsDiscoverRequest {
  words?: string[];
  require_tag?: string;
  active_tags?: string[];
}

export interface CommandsDiscoverResponse {
  title: string;
  items: unknown[];
}

export interface CommandsListResponse {
  title: string;
  footer: string;
  sections: unknown[];
}

export interface ExecuteRequest {
  action: Record<string, unknown>;
}

export interface ExecuteResponse {
  status?: string;
  shell_action?: unknown;
}

export interface SettingsRulesCreateRequest {
  newrulephrase: string;
  newruleactiontype?: string;
}

export interface SettingsRulesCreateResponse {
  ok: boolean;
}

export interface SettingsRulesUpdateRequest {
  canonical: string;
  newrulephrase: string;
}

export interface SettingsRulesUpdateResponse {
  ok: boolean;
}

export interface ListsGetRequest {
  name: string;
}

export interface ListsGetResponse {
  name?: string;
  entries?: Record<string, unknown>;
}

export interface ListsUpdateRequest {
  name: string;
  entries: Record<string, unknown>;
  merge?: boolean;
  label?: string;
}

export interface ListsUpdateResponse {
  name?: string;
  entries?: Record<string, unknown>;
}

export interface ListsDeleteRequest {
  name: string;
}

export interface ListsDeleteResponse {
  ok: boolean;
}

export interface HUDHideRequest {
  channel: string;
}

export interface HUDHideResponse {
  ok: boolean;
}

export interface HUDPushRequest {
  channel: string;
  fragments: unknown[];
}

export interface HUDPushResponse {
  ok: boolean;
}

export interface HUDCreateChannelRequest {
  channel: string;
  anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  width?: number;
  min_height?: number;
  accepts_input?: boolean;
  description?: string;
}

export interface HUDCreateChannelResponse {
  ok: boolean;
  error?: string;
}

export interface HUDRemoveChannelRequest {
  channel: string;
}

export interface HUDRemoveChannelResponse {
  ok: boolean;
  removed?: boolean;
}

export interface HUDSetSizeRequest {
  channel: string;
  height: number;
}

export interface HUDSetSizeResponse {
  ok: boolean;
}

export interface HUDShowRequest {
  channel: string;
}

export interface HUDShowResponse {
  ok: boolean;
}

export interface SessionEndCleanupResponse {
  ok?: boolean;
  shell_action?: string;
  reset_engine?: boolean;
}

export interface EventsAppendRequest {
  session_id?: string;
  event_type: string;
  data?: Record<string, unknown>;
}

export interface EventsAppendResponse {
  ok: boolean;
}

export interface GrammarPushRequest {
  commands: Command[];
}

export interface GrammarPushResponse {
  ok: boolean;
  count: number;
}

export interface SelectionSetRequest {
  title?: string;
  items?: HudItem[];
}

export interface SelectionSetResponse {
  ok: boolean;
}

export interface SelectionPickRequest {
  index: number;
}

export interface SelectionPickResponse {
  ok?: boolean;
  item_id?: string;
  reset_engine?: boolean;
  shell_action?: string;
}

export interface MatchAliasesSetRequest {
  aliases: Record<string, string>;
}

export interface MatchAliasesSetResponse {
  ok?: boolean;
  count?: number;
}

export interface MatchAliasesGetResponse {
  aliases?: Record<string, string>;
}

export interface KeybindsRegisterRequest {
  snapshot: Record<string, unknown>;
}

export interface KeybindsRegisterResponse {
  ok: boolean;
  count?: number;
}

export interface KeyNamesSetRequest {
  names: Record<string, number>;
}

export interface KeyNamesSetResponse {
  ok: boolean;
  count?: number;
}

export interface NativeWorldModelRequest {
  on_screen?: boolean;
}

export interface NativeBatchSetFramesRequest {
  frames: WindowFrame[];
  readback?: boolean;
}

export interface NativeBatchSetFramesResponse {
  results: WindowFrame[];
}

export interface NativeRaiseWindowRequest {
  window_id: string;
}

export interface NativeBatchIsTileableRequest {
  window_ids: string[];
}

export interface NativeBatchIsTileableResponse {
  results: unknown[];
}

export interface NativeToggleFullscreenRequest {
  window_id: string;
}

export interface NativeWarpCursorRequest {
  x: number;
  y: number;
}

export interface NativeIsAppHiddenRequest {
  bundle_id: string;
}

export interface NativeIsAppHiddenResponse {
  result: boolean;
}

export interface NativeUnhideAppRequest {
  bundle_id: string;
}

export interface NativeBordersRequest {
  frames: unknown;
}

export interface NativeRunApplescriptRequest {
  script: string;
}

export interface NativeAudioDevicesResponse {
  devices: AudioDevice[];
}

export interface NativeSetAudioDeviceRequest {
  uid: string;
  device_type: "input" | "output";
}

export interface NativeKeyboardLayoutResponse {
  layout_id?: string;
  layout_name?: string;
  mappings?: Record<string, unknown>;
}

export interface NativeRunningAppsResponse {
  apps?: RunningApp[];
}

export interface NativeFrontmostAppResponse {
  app?: RunningApp;
}

export interface NativeQuitAppRequest {
  bundle_id: string;
}

export interface NativeQuitAppResponse {
  result?: boolean;
}

export interface NativeForceQuitAppRequest {
  bundle_id: string;
}

export interface NativeForceQuitAppResponse {
  result?: boolean;
}

export interface NativeHideAppRequest {
  bundle_id: string;
}

export interface NativeActivateAppRequest {
  bundle_id: string;
  all_windows?: boolean;
}

export interface NativeMinimizeWindowRequest {
  window_id: string;
}

export interface NativeUnminimizeWindowRequest {
  window_id: string;
}

export interface NativeCloseWindowRequest {
  window_id: string;
}

export interface NativeGetWindowInfoRequest {
  window_id: string;
}

export interface NativeVolumeResponse {
  volume?: number;
  is_muted?: boolean;
}

export interface NativeSetVolumeRequest {
  volume: number;
}

export interface NativeMuteRequest {
  muted: boolean;
}

export interface NativeDarkModeResponse {
  is_dark?: boolean;
}

export interface NativeSetDarkModeRequest {
  dark: boolean;
}

export interface InputDragRequest {
  from_x: number;
  from_y: number;
  to_x: number;
  to_y: number;
  duration_ms?: number;
}

export interface InputClipboardReadRequest {
  content_type: string;
}

export interface InputClipboardWriteRequest {
  content_type: string;
  data: string;
}

export interface InputClipboardWriteResponse {
  ok?: boolean;
}

export interface NativeBatteryResponse {
  level?: number;
  is_charging?: boolean;
  is_plugged_in?: boolean;
  time_remaining_minutes?: number;
  is_present?: boolean;
}

export interface NativeWifiResponse {
  ssid?: string;
  bssid?: string;
  rssi?: number;
  is_connected?: boolean;
  is_enabled?: boolean;
}

export interface NativePlaySoundRequest {
  name: string;
}

export interface NativeSpeakRequest {
  text: string;
  voice?: string;
  rate?: number;
}

export interface NativeDisplaysResponse {
  displays?: Record<string, unknown>[];
}

export interface NativeBrightnessRequest {
  display_id?: number;
}

export interface NativeBrightnessResponse {
  brightness?: number;
}

export interface NativeSetBrightnessRequest {
  brightness: number;
  display_id?: number;
}

export interface NativeScreenshotRequest {
  window_id?: string;
  display_id?: number;
  region?: unknown;
}

export interface NativeScreenshotResponse {
  image_base64?: string;
  format?: string;
}

export interface NativeMenuBarRequest {
  pid: number;
}

export interface NativeMenuBarResponse {
  items?: Record<string, unknown>[];
}

export interface NativeClickMenuItemRequest {
  pid: number;
  path: string[];
}

export interface NativeClickMenuItemResponse {
  result?: boolean;
}

export interface NativeListSpacesResponse {
  spaces?: Record<string, unknown>[];
}

export interface NativeActiveSpaceResponse {
  active?: Record<string, unknown>[];
}

export interface NativeMoveWindowToSpaceRequest {
  window_id: string;
  space_id: number;
}

export interface NativeMoveWindowToSpaceResponse {
  result?: boolean;
}

export interface NativeMoveWindowToDisplayRequest {
  window_id: string;
  display_id: number;
}

export interface NativeCaptureWindowRequest {
  window_id: string;
}

export interface NativeCaptureWindowResponse {
  image_base64?: string;
  format?: string;
}

export interface NativeSetWindowAlphaRequest {
  window_id: string;
  alpha: number;
}

export interface NativeAppIconRequest {
  bundle_id: string;
  size?: number;
}

export interface NativeAppIconResponse {
  image_base64?: string;
  format?: string;
}

export interface InputDoubleClickRequest {
  x?: number;
  y?: number;
}

export interface InputRightClickRequest {
  x?: number;
  y?: number;
}

export interface InputSwitchInputSourceRequest {
  source_id: string;
}

export interface InputSwitchInputSourceResponse {
  result?: boolean;
}

export interface InputListInputSourcesResponse {
  sources?: unknown[];
}

export interface NativeDndResponse {
  enabled?: boolean;
  focus_name?: string;
}

export interface NativeSetDndRequest {
  enabled: boolean;
}

export interface NativeBluetoothDevicesResponse {
  devices?: Record<string, unknown>[];
}

export interface NativePreventSleepRequest {
  reason?: string;
  assertion_id?: string;
}

export interface NativePreventSleepResponse {
  assertion_id?: string;
}

export interface NativeSystemUptimeResponse {
  uptime_seconds?: number;
  formatted?: string;
}

export interface NativeColorAtPointRequest {
  x: number;
  y: number;
}

export interface NativeColorAtPointResponse {
  r?: number;
  g?: number;
  b?: number;
  a?: number;
  hex?: string;
}

export interface NativeCursorInfoResponse {
  cursor_type?: string;
  x?: number;
  y?: number;
}

export interface NativeSpotlightRequest {
  query: string;
  scope?: string[];
  limit?: number;
}

export interface NativeSpotlightResponse {
  results?: Record<string, unknown>[];
}

export interface NativeTrashRequest {
  path: string;
}

export interface NativeTrashResponse {
  result?: boolean;
}

export interface NativeFileTagsRequest {
  path: string;
  tags?: string[];
}

export interface NativeFileTagsResponse {
  path?: string;
  tags?: string[];
}

export interface NativeRevealInFinderRequest {
  path: string;
}

export interface NativeQuickLookRequest {
  path: string;
  size?: number;
}

export interface NativeQuickLookResponse {
  image_base64?: string;
  format?: string;
}

export interface NativeSelectedFinderItemsResponse {
  paths?: string[];
}

export interface NativeNotifyRequest {
  title: string;
  body?: string;
  subtitle?: string;
  sound?: string;
}

export interface NativeNotifyResponse {
  id?: string;
}

export interface NativeListNotificationsResponse {
  notifications?: Record<string, unknown>[];
}

export interface NativeDismissNotificationRequest {
  id: string;
}

export interface NativeDefaultBrowserResponse {
  bundle_id?: string;
}

export interface NativeLoginItemsResponse {
  items?: unknown[];
}

export interface NativeClipboardChangeCountResponse {
  count?: number;
}

export interface InputClipboardReadAllResponse {
  items?: unknown[];
}

export interface InputClipboardWriteItemsRequest {
  items: unknown[];
}

export interface NativeAxElementAtPointRequest {
  pid: number;
  x: number;
  y: number;
}

export interface NativeAxElementTreeRequest {
  element: AXElementRef;
  depth?: number;
}

export interface NativeAxReadAttributesRequest {
  element: AXElementRef;
  attributes: string[];
}

export interface NativeAxSetAttributeRequest {
  element: AXElementRef;
  attribute: string;
  value: unknown;
}

export interface NativeAxPerformActionRequest {
  element: AXElementRef;
  action: string;
}

export interface NativeAxObserveRequest {
  pid: number;
  notifications: string[];
}

export interface NativeAxObserveResponse {
  subscription_id?: string;
}

export interface NativeAxUnobserveRequest {
  subscription_id: string;
}

export interface NativeObserveWindowsRequest {
  pid: number;
}

export interface NativeObserveWindowsResponse {
  subscription_id?: string;
}

export interface NativeUnobserveWindowsRequest {
  subscription_id: string;
}

export interface NativeSetWindowLevelRequest {
  window_id: string;
  level: "floating" | "normal" | "below";
}

export interface ControlSignalRequest {
  signal: string;
}

export interface EventsEmitRequest {
  event_type: string;
  data?: unknown;
  correlation_id?: string;
}

export interface InputTypeTextRequest {
  text: string;
}

export interface InputPressKeyRequest {
  code?: number;
  name?: string;
  modifiers?: string[];
}

export interface InputRawKeyRequest {
  code: number;
  direction: "press" | "release" | "click";
}

export interface InputClickRequest {
  button?: "left" | "right" | "middle";
}

export interface InputScrollRequest {
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}

export interface InputMouseButtonRequest {
  button?: "left" | "right" | "middle";
  direction: "press" | "release";
}

export interface InputClipboardActionRequest {
  action: "copy" | "paste" | "set";
  text?: string;
}

export interface NativeLaunchAppRequest {
  bundle_id: string;
  new_instance?: boolean;
}

export interface NativeOpenTargetRequest {
  target: string;
}

// ===== Actuator → Plugin request/response types =====

export interface RenderSettingsRequest {
  tab_key: string;
  search?: string;
  apps?: AppData[];
  commands?: Record<string, unknown>;
  active_tags?: string[];
}

export interface RenderSettingsResponse {
  html: string;
}

export interface RenderHUDRequest {
  hud_mode: string;
  apps?: AppData[];
  title?: string;
  footer?: string;
  sections?: HudSection[];
}

export interface OnActionRequest {
  action: string;
  params?: Record<string, unknown>;
  active_app?: string;
  active_window_id?: string;
}

export interface OnActionResponse {
  status: "ok" | "error" | "not_handled";
  shell_action?: string;
  control_message?: string;
}

export interface BuildCommandRegistryRequest {
  commands_by_plugin: Record<string, unknown>;
  user_commands?: Record<string, unknown>[];
}

export interface BuildCommandRegistryResponse {
  phonetics_count: number;
}

export interface SpeechPipelineRequest {
  transcript: string;
  is_final: boolean;
  mode: string;
}

export interface SpeechPipelineResponse {
  action: "pass" | "consume";
}

export interface SpeechOrchestrateRequest {
  transcript: string;
  words: string[];
}

export interface SpeechOrchestrateResponse {
  result: string;
  actions_to_execute?: Record<string, unknown>[];
}

export interface CalibrateRequest {
  action: "start" | "speech" | "cancel";
  words?: string[];
}

export interface CalibrateResponse {
  calibration_active: boolean;
}
