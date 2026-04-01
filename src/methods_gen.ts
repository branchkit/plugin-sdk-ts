// AUTO-GENERATED from contracts/actuator-rpc.json — do not edit.
// Run: python3 contracts/generate_methods_ts.py

import { Plugin } from "./plugin.js";
import type { AXElementInfo, AXElementNode, AXElementRef, ApplescriptResult, AudioDevice, ClipboardContents, Command, CommandsDiscoverResponse, CommandsHasPartialResponse, CommandsListResponse, ExecuteResponse, GrammarPushResponse, HUDCreateChannelResponse, HUDRemoveChannelResponse, HudItem, InputClipboardReadAllResponse, KeyNamesSetResponse, KeybindsRegisterResponse, ListsGetResponse, ListsUpdateResponse, MatchAliasesGetResponse, MatchAliasesSetResponse, MatchResult, NativeAppIconResponse, NativeAxObserveResponse, NativeBatteryResponse, NativeBrightnessResponse, NativeCaptureWindowResponse, NativeClipboardChangeCountResponse, NativeColorAtPointResponse, NativeCursorInfoResponse, NativeDarkModeResponse, NativeDefaultBrowserResponse, NativeDndResponse, NativeFileTagsResponse, NativeKeyboardLayoutResponse, NativeLoginItemsResponse, NativeNotifyResponse, NativeObserveWindowsResponse, NativePreventSleepResponse, NativeQuickLookResponse, NativeScreenshotResponse, NativeSystemUptimeResponse, NativeVolumeResponse, NativeWifiResponse, Point, RunningApp, SelectionPickResponse, SessionEndCleanupResponse, StoreGetResponse, UserSessionInfo, WindowDetail, WindowFrame, WorldModel } from "./types_gen.js";
import {
  MethodCommandsDiscover,
  MethodCommandsHasPartial,
  MethodCommandsList,
  MethodCommandsMatch,
  MethodControlSignal,
  MethodEventsAppend,
  MethodEventsEmit,
  MethodExecute,
  MethodGrammarPush,
  MethodHudCreateChannel,
  MethodHudHide,
  MethodHudPush,
  MethodHudRemoveChannel,
  MethodHudSetSize,
  MethodHudShow,
  MethodInputClipboardRead,
  MethodInputClipboardReadAll,
  MethodInputClipboardWrite,
  MethodInputClipboardWriteItems,
  MethodInputDoubleClick,
  MethodInputDrag,
  MethodInputListInputSources,
  MethodInputRightClick,
  MethodInputSwitchInputSource,
  MethodKeyNamesSet,
  MethodKeybindsRegister,
  MethodListsDelete,
  MethodListsGet,
  MethodListsUpdate,
  MethodMatchAliasesGet,
  MethodMatchAliasesSet,
  MethodNativeActivateApp,
  MethodNativeActiveSpace,
  MethodNativeAppIcon,
  MethodNativeAudioDevices,
  MethodNativeAxElementAtPoint,
  MethodNativeAxElementTree,
  MethodNativeAxObserve,
  MethodNativeAxPerformAction,
  MethodNativeAxReadAttributes,
  MethodNativeAxSetAttribute,
  MethodNativeAxUnobserve,
  MethodNativeBatchIsTileable,
  MethodNativeBatchSetFrames,
  MethodNativeBattery,
  MethodNativeBluetoothDevices,
  MethodNativeBorders,
  MethodNativeBrightness,
  MethodNativeCaptureWindow,
  MethodNativeClickMenuItem,
  MethodNativeClipboardChangeCount,
  MethodNativeCloseWindow,
  MethodNativeColorAtPoint,
  MethodNativeCurrentUser,
  MethodNativeCursor,
  MethodNativeCursorInfo,
  MethodNativeDarkMode,
  MethodNativeDefaultBrowser,
  MethodNativeDismissNotification,
  MethodNativeDisplays,
  MethodNativeDnd,
  MethodNativeFileTags,
  MethodNativeForceQuitApp,
  MethodNativeFrontmostApp,
  MethodNativeGetWindowInfo,
  MethodNativeHideApp,
  MethodNativeIsAppHidden,
  MethodNativeKeyboardLayout,
  MethodNativeListNotifications,
  MethodNativeListSpaces,
  MethodNativeLoginItems,
  MethodNativeMenuBar,
  MethodNativeMinimizeWindow,
  MethodNativeMoveWindowToDisplay,
  MethodNativeMoveWindowToSpace,
  MethodNativeMute,
  MethodNativeNotify,
  MethodNativeObserveWindows,
  MethodNativePlaySound,
  MethodNativePollBurst,
  MethodNativePreventSleep,
  MethodNativeQuickLook,
  MethodNativeQuitApp,
  MethodNativeRaiseWindow,
  MethodNativeRevealInFinder,
  MethodNativeRunApplescript,
  MethodNativeRunningApps,
  MethodNativeScreenLock,
  MethodNativeScreenshot,
  MethodNativeSelectedFinderItems,
  MethodNativeSetAudioDevice,
  MethodNativeSetBrightness,
  MethodNativeSetDarkMode,
  MethodNativeSetDnd,
  MethodNativeSetVolume,
  MethodNativeSetWindowAlpha,
  MethodNativeSetWindowLevel,
  MethodNativeSpeak,
  MethodNativeSpotlight,
  MethodNativeSystemUptime,
  MethodNativeToggleFullscreen,
  MethodNativeTrash,
  MethodNativeUnhideApp,
  MethodNativeUnminimizeWindow,
  MethodNativeUnobserveWindows,
  MethodNativeVolume,
  MethodNativeWarpCursor,
  MethodNativeWifi,
  MethodNativeWorldModel,
  MethodSelectionPick,
  MethodSelectionSet,
  MethodSessionEndCleanup,
  MethodSettingsRulesCreate,
  MethodSettingsRulesUpdate,
  MethodStoreGet,
  MethodStorePush,
  MethodTagsGet,
  MethodTagsModify,
} from "./contracts_gen.js";

declare module "./plugin.js" {
  interface Plugin {
    storePush(name: string, data: unknown): Promise<void>;
    storeGet(name: string): Promise<StoreGetResponse>;
    tagsGet(): Promise<string[]>;
    tagsModify(set?: string[], clear?: string[], clearScoped?: boolean): Promise<string[]>;
    commandsMatch(words: string[], activeTags?: string[]): Promise<MatchResult>;
    commandsHasPartial(words: string[], activeTags?: string[]): Promise<CommandsHasPartialResponse>;
    commandsDiscover(words?: string[], requireTag?: string, activeTags?: string[]): Promise<CommandsDiscoverResponse>;
    commandsList(): Promise<CommandsListResponse>;
    execute(action: Record<string, unknown>): Promise<ExecuteResponse>;
    settingsRulesCreate(newrulephrase: string, newruleactiontype?: string): Promise<void>;
    settingsRulesUpdate(canonical: string, newrulephrase: string): Promise<void>;
    listsGet(name: string): Promise<ListsGetResponse>;
    listsUpdate(name: string, entries: Record<string, unknown>, merge?: boolean, label?: string): Promise<ListsUpdateResponse>;
    listsDelete(name: string): Promise<void>;
    hudHide(channel: string): Promise<void>;
    hudPush(channel: string, fragments: unknown[]): Promise<void>;
    hudCreateChannel(channel: string, anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center", width?: number, minHeight?: number, acceptsInput?: boolean, description?: string): Promise<HUDCreateChannelResponse>;
    hudRemoveChannel(channel: string): Promise<HUDRemoveChannelResponse>;
    hudSetSize(channel: string, height: number): Promise<void>;
    hudShow(channel: string): Promise<void>;
    sessionEndCleanup(): Promise<SessionEndCleanupResponse>;
    eventsAppend(eventType: string, sessionId?: string, data?: Record<string, unknown>): Promise<void>;
    grammarPush(commands: Command[]): Promise<GrammarPushResponse>;
    selectionSet(title?: string, items?: HudItem[]): Promise<void>;
    selectionPick(index: number): Promise<SelectionPickResponse>;
    matchAliasesSet(aliases: Record<string, string>): Promise<MatchAliasesSetResponse>;
    matchAliasesGet(): Promise<MatchAliasesGetResponse>;
    keybindsRegister(snapshot: Record<string, unknown>): Promise<KeybindsRegisterResponse>;
    keyNamesSet(names: Record<string, number>): Promise<KeyNamesSetResponse>;
    nativeWorldModel(onScreen?: boolean): Promise<WorldModel>;
    nativeBatchSetFrames(frames: WindowFrame[], readback?: boolean): Promise<WindowFrame[]>;
    nativeRaiseWindow(windowId: string): Promise<void>;
    nativeBatchIsTileable(windowIds: string[]): Promise<unknown[]>;
    nativeToggleFullscreen(windowId: string): Promise<void>;
    nativeCursor(): Promise<Point>;
    nativeWarpCursor(x: number, y: number): Promise<void>;
    nativeIsAppHidden(bundleId: string): Promise<boolean>;
    nativeUnhideApp(bundleId: string): Promise<void>;
    nativeBorders(frames: unknown): Promise<void>;
    nativeRunApplescript(script: string): Promise<ApplescriptResult>;
    nativePollBurst(): Promise<void>;
    nativeAudioDevices(): Promise<AudioDevice[]>;
    nativeSetAudioDevice(uid: string, deviceType: "input" | "output"): Promise<void>;
    nativeKeyboardLayout(): Promise<NativeKeyboardLayoutResponse>;
    nativeRunningApps(): Promise<RunningApp[]>;
    nativeFrontmostApp(): Promise<RunningApp | undefined>;
    nativeQuitApp(bundleId: string): Promise<boolean>;
    nativeForceQuitApp(bundleId: string): Promise<boolean>;
    nativeHideApp(bundleId: string): Promise<void>;
    nativeActivateApp(bundleId: string, allWindows?: boolean): Promise<void>;
    nativeMinimizeWindow(windowId: string): Promise<void>;
    nativeUnminimizeWindow(windowId: string): Promise<void>;
    nativeCloseWindow(windowId: string): Promise<void>;
    nativeGetWindowInfo(windowId: string): Promise<WindowDetail>;
    nativeVolume(): Promise<NativeVolumeResponse>;
    nativeSetVolume(volume: number): Promise<void>;
    nativeMute(muted: boolean): Promise<void>;
    nativeDarkMode(): Promise<NativeDarkModeResponse>;
    nativeSetDarkMode(dark: boolean): Promise<void>;
    inputDrag(fromX: number, fromY: number, toX: number, toY: number, durationMs?: number): Promise<void>;
    inputClipboardRead(contentType: string): Promise<ClipboardContents>;
    inputClipboardWrite(contentType: string, data: string): Promise<void>;
    nativeBattery(): Promise<NativeBatteryResponse>;
    nativeWifi(): Promise<NativeWifiResponse>;
    nativePlaySound(name: string): Promise<void>;
    nativeSpeak(text: string, voice?: string, rate?: number): Promise<void>;
    nativeDisplays(): Promise<unknown[]>;
    nativeBrightness(displayId?: number): Promise<NativeBrightnessResponse>;
    nativeSetBrightness(brightness: number, displayId?: number): Promise<void>;
    nativeScreenshot(windowId?: string, displayId?: number, region?: unknown): Promise<NativeScreenshotResponse>;
    nativeMenuBar(pid: number): Promise<unknown[]>;
    nativeClickMenuItem(pid: number, path: string[]): Promise<boolean>;
    nativeListSpaces(): Promise<unknown[]>;
    nativeActiveSpace(): Promise<unknown[]>;
    nativeMoveWindowToSpace(windowId: string, spaceId: number): Promise<boolean>;
    nativeMoveWindowToDisplay(windowId: string, displayId: number): Promise<void>;
    nativeCaptureWindow(windowId: string): Promise<NativeCaptureWindowResponse>;
    nativeSetWindowAlpha(windowId: string, alpha: number): Promise<void>;
    nativeAppIcon(bundleId: string, size?: number): Promise<NativeAppIconResponse>;
    inputDoubleClick(x?: number, y?: number): Promise<void>;
    inputRightClick(x?: number, y?: number): Promise<void>;
    inputSwitchInputSource(sourceId: string): Promise<boolean>;
    inputListInputSources(): Promise<unknown[]>;
    nativeDnd(): Promise<NativeDndResponse>;
    nativeSetDnd(enabled: boolean): Promise<void>;
    nativeBluetoothDevices(): Promise<unknown[]>;
    nativePreventSleep(reason?: string, assertionId?: string): Promise<NativePreventSleepResponse>;
    nativeSystemUptime(): Promise<NativeSystemUptimeResponse>;
    nativeScreenLock(): Promise<void>;
    nativeColorAtPoint(x: number, y: number): Promise<NativeColorAtPointResponse>;
    nativeCursorInfo(): Promise<NativeCursorInfoResponse>;
    nativeSpotlight(query: string, scope?: string[], limit?: number): Promise<unknown[]>;
    nativeTrash(path: string): Promise<boolean>;
    nativeFileTags(path: string, tags?: string[]): Promise<NativeFileTagsResponse>;
    nativeRevealInFinder(path: string): Promise<void>;
    nativeQuickLook(path: string, size?: number): Promise<NativeQuickLookResponse>;
    nativeSelectedFinderItems(): Promise<string[]>;
    nativeNotify(title: string, body?: string, subtitle?: string, sound?: string): Promise<NativeNotifyResponse>;
    nativeListNotifications(): Promise<unknown[]>;
    nativeDismissNotification(id: string): Promise<void>;
    nativeCurrentUser(): Promise<UserSessionInfo>;
    nativeDefaultBrowser(): Promise<NativeDefaultBrowserResponse>;
    nativeLoginItems(): Promise<NativeLoginItemsResponse>;
    nativeClipboardChangeCount(): Promise<NativeClipboardChangeCountResponse>;
    inputClipboardReadAll(): Promise<InputClipboardReadAllResponse>;
    inputClipboardWriteItems(items: unknown[]): Promise<void>;
    nativeAxElementAtPoint(pid: number, x: number, y: number): Promise<AXElementInfo>;
    nativeAxElementTree(element: AXElementRef, depth?: number): Promise<AXElementNode>;
    nativeAxReadAttributes(element: AXElementRef, attributes: string[]): Promise<void>;
    nativeAxSetAttribute(element: AXElementRef, attribute: string, value: unknown): Promise<boolean>;
    nativeAxPerformAction(element: AXElementRef, action: string): Promise<boolean>;
    nativeAxObserve(pid: number, notifications: string[]): Promise<NativeAxObserveResponse>;
    nativeAxUnobserve(subscriptionId: string): Promise<boolean>;
    nativeObserveWindows(pid: number): Promise<NativeObserveWindowsResponse>;
    nativeUnobserveWindows(subscriptionId: string): Promise<boolean>;
    nativeSetWindowLevel(windowId: string, level: "floating" | "normal" | "below"): Promise<boolean>;
    controlSignal(signal: string): Promise<void>;
    eventsEmit(eventType: string, data?: unknown, correlationId?: string): Promise<void>;
  }
}

Plugin.prototype.storePush = async function(name: string, data: unknown) {
  const result = await this.call(
    MethodStorePush,
    {
      name,
      data,
    },
  );
};

Plugin.prototype.storeGet = async function(name: string) {
  const result = await this.call(
    MethodStoreGet,
    {
      name,
    },
  );
  return result as StoreGetResponse;
};

Plugin.prototype.tagsGet = async function() {
  const result = await this.call(MethodTagsGet);
  return (result as any).tags;
};

Plugin.prototype.tagsModify = async function(set?: string[], clear?: string[], clearScoped?: boolean) {
  const result = await this.call(
    MethodTagsModify,
    {
      set,
      clear,
      clear_scoped: clearScoped,
    },
  );
  return (result as any).tags;
};

Plugin.prototype.commandsMatch = async function(words: string[], activeTags?: string[]) {
  const result = await this.call(
    MethodCommandsMatch,
    {
      words,
      active_tags: activeTags,
    },
  );
  return result as MatchResult;
};

Plugin.prototype.commandsHasPartial = async function(words: string[], activeTags?: string[]) {
  const result = await this.call(
    MethodCommandsHasPartial,
    {
      words,
      active_tags: activeTags,
    },
  );
  return result as CommandsHasPartialResponse;
};

Plugin.prototype.commandsDiscover = async function(words?: string[], requireTag?: string, activeTags?: string[]) {
  const result = await this.call(
    MethodCommandsDiscover,
    {
      words,
      require_tag: requireTag,
      active_tags: activeTags,
    },
  );
  return result as CommandsDiscoverResponse;
};

Plugin.prototype.commandsList = async function() {
  const result = await this.call(MethodCommandsList);
  return result as CommandsListResponse;
};

Plugin.prototype.execute = async function(action: Record<string, unknown>) {
  const result = await this.call(
    MethodExecute,
    {
      action,
    },
  );
  return result as ExecuteResponse;
};

Plugin.prototype.settingsRulesCreate = async function(newrulephrase: string, newruleactiontype?: string) {
  const result = await this.call(
    MethodSettingsRulesCreate,
    {
      newrulephrase,
      newruleactiontype,
    },
  );
};

Plugin.prototype.settingsRulesUpdate = async function(canonical: string, newrulephrase: string) {
  const result = await this.call(
    MethodSettingsRulesUpdate,
    {
      canonical,
      newrulephrase,
    },
  );
};

Plugin.prototype.listsGet = async function(name: string) {
  const result = await this.call(
    MethodListsGet,
    {
      name,
    },
  );
  return result as ListsGetResponse;
};

Plugin.prototype.listsUpdate = async function(name: string, entries: Record<string, unknown>, merge?: boolean, label?: string) {
  const result = await this.call(
    MethodListsUpdate,
    {
      name,
      entries,
      merge,
      label,
    },
  );
  return result as ListsUpdateResponse;
};

Plugin.prototype.listsDelete = async function(name: string) {
  const result = await this.call(
    MethodListsDelete,
    {
      name,
    },
  );
};

Plugin.prototype.hudHide = async function(channel: string) {
  const result = await this.call(
    MethodHudHide,
    {
      channel,
    },
  );
};

Plugin.prototype.hudPush = async function(channel: string, fragments: unknown[]) {
  const result = await this.call(
    MethodHudPush,
    {
      channel,
      fragments,
    },
  );
};

Plugin.prototype.hudCreateChannel = async function(channel: string, anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center", width?: number, minHeight?: number, acceptsInput?: boolean, description?: string) {
  const result = await this.call(
    MethodHudCreateChannel,
    {
      channel,
      anchor,
      width,
      min_height: minHeight,
      accepts_input: acceptsInput,
      description,
    },
  );
  return result as HUDCreateChannelResponse;
};

Plugin.prototype.hudRemoveChannel = async function(channel: string) {
  const result = await this.call(
    MethodHudRemoveChannel,
    {
      channel,
    },
  );
  return result as HUDRemoveChannelResponse;
};

Plugin.prototype.hudSetSize = async function(channel: string, height: number) {
  const result = await this.call(
    MethodHudSetSize,
    {
      channel,
      height,
    },
  );
};

Plugin.prototype.hudShow = async function(channel: string) {
  const result = await this.call(
    MethodHudShow,
    {
      channel,
    },
  );
};

Plugin.prototype.sessionEndCleanup = async function() {
  const result = await this.call(MethodSessionEndCleanup);
  return result as SessionEndCleanupResponse;
};

Plugin.prototype.eventsAppend = async function(eventType: string, sessionId?: string, data?: Record<string, unknown>) {
  const result = await this.call(
    MethodEventsAppend,
    {
      event_type: eventType,
      session_id: sessionId,
      data,
    },
  );
};

Plugin.prototype.grammarPush = async function(commands: Command[]) {
  const result = await this.call(
    MethodGrammarPush,
    {
      commands,
    },
  );
  return result as GrammarPushResponse;
};

Plugin.prototype.selectionSet = async function(title?: string, items?: HudItem[]) {
  const result = await this.call(
    MethodSelectionSet,
    {
      title,
      items,
    },
  );
};

Plugin.prototype.selectionPick = async function(index: number) {
  const result = await this.call(
    MethodSelectionPick,
    {
      index,
    },
  );
  return result as SelectionPickResponse;
};

Plugin.prototype.matchAliasesSet = async function(aliases: Record<string, string>) {
  const result = await this.call(
    MethodMatchAliasesSet,
    {
      aliases,
    },
  );
  return result as MatchAliasesSetResponse;
};

Plugin.prototype.matchAliasesGet = async function() {
  const result = await this.call(MethodMatchAliasesGet);
  return result as MatchAliasesGetResponse;
};

Plugin.prototype.keybindsRegister = async function(snapshot: Record<string, unknown>) {
  const result = await this.call(
    MethodKeybindsRegister,
    {
      snapshot,
    },
  );
  return result as KeybindsRegisterResponse;
};

Plugin.prototype.keyNamesSet = async function(names: Record<string, number>) {
  const result = await this.call(
    MethodKeyNamesSet,
    {
      names,
    },
  );
  return result as KeyNamesSetResponse;
};

Plugin.prototype.nativeWorldModel = async function(onScreen?: boolean) {
  const result = await this.call(
    MethodNativeWorldModel,
    {
      on_screen: onScreen,
    },
  );
  return result as WorldModel;
};

Plugin.prototype.nativeBatchSetFrames = async function(frames: WindowFrame[], readback?: boolean) {
  const result = await this.call(
    MethodNativeBatchSetFrames,
    {
      frames,
      readback,
    },
  );
  return (result as any).results;
};

Plugin.prototype.nativeRaiseWindow = async function(windowId: string) {
  const result = await this.call(
    MethodNativeRaiseWindow,
    {
      window_id: windowId,
    },
  );
};

Plugin.prototype.nativeBatchIsTileable = async function(windowIds: string[]) {
  const result = await this.call(
    MethodNativeBatchIsTileable,
    {
      window_ids: windowIds,
    },
  );
  return (result as any).results;
};

Plugin.prototype.nativeToggleFullscreen = async function(windowId: string) {
  const result = await this.call(
    MethodNativeToggleFullscreen,
    {
      window_id: windowId,
    },
  );
};

Plugin.prototype.nativeCursor = async function() {
  const result = await this.call(MethodNativeCursor);
  return result as Point;
};

Plugin.prototype.nativeWarpCursor = async function(x: number, y: number) {
  const result = await this.call(
    MethodNativeWarpCursor,
    {
      x,
      y,
    },
  );
};

Plugin.prototype.nativeIsAppHidden = async function(bundleId: string) {
  const result = await this.call(
    MethodNativeIsAppHidden,
    {
      bundle_id: bundleId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeUnhideApp = async function(bundleId: string) {
  const result = await this.call(
    MethodNativeUnhideApp,
    {
      bundle_id: bundleId,
    },
  );
};

Plugin.prototype.nativeBorders = async function(frames: unknown) {
  const result = await this.call(
    MethodNativeBorders,
    {
      frames,
    },
  );
};

Plugin.prototype.nativeRunApplescript = async function(script: string) {
  const result = await this.call(
    MethodNativeRunApplescript,
    {
      script,
    },
  );
  return result as ApplescriptResult;
};

Plugin.prototype.nativePollBurst = async function() {
  const result = await this.call(MethodNativePollBurst);
};

Plugin.prototype.nativeAudioDevices = async function() {
  const result = await this.call(MethodNativeAudioDevices);
  return (result as any).devices;
};

Plugin.prototype.nativeSetAudioDevice = async function(uid: string, deviceType: "input" | "output") {
  const result = await this.call(
    MethodNativeSetAudioDevice,
    {
      uid,
      device_type: deviceType,
    },
  );
};

Plugin.prototype.nativeKeyboardLayout = async function() {
  const result = await this.call(MethodNativeKeyboardLayout);
  return result as NativeKeyboardLayoutResponse;
};

Plugin.prototype.nativeRunningApps = async function() {
  const result = await this.call(MethodNativeRunningApps);
  return (result as any).apps;
};

Plugin.prototype.nativeFrontmostApp = async function() {
  const result = await this.call(MethodNativeFrontmostApp);
  return (result as any).app;
};

Plugin.prototype.nativeQuitApp = async function(bundleId: string) {
  const result = await this.call(
    MethodNativeQuitApp,
    {
      bundle_id: bundleId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeForceQuitApp = async function(bundleId: string) {
  const result = await this.call(
    MethodNativeForceQuitApp,
    {
      bundle_id: bundleId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeHideApp = async function(bundleId: string) {
  const result = await this.call(
    MethodNativeHideApp,
    {
      bundle_id: bundleId,
    },
  );
};

Plugin.prototype.nativeActivateApp = async function(bundleId: string, allWindows?: boolean) {
  const result = await this.call(
    MethodNativeActivateApp,
    {
      bundle_id: bundleId,
      all_windows: allWindows,
    },
  );
};

Plugin.prototype.nativeMinimizeWindow = async function(windowId: string) {
  const result = await this.call(
    MethodNativeMinimizeWindow,
    {
      window_id: windowId,
    },
  );
};

Plugin.prototype.nativeUnminimizeWindow = async function(windowId: string) {
  const result = await this.call(
    MethodNativeUnminimizeWindow,
    {
      window_id: windowId,
    },
  );
};

Plugin.prototype.nativeCloseWindow = async function(windowId: string) {
  const result = await this.call(
    MethodNativeCloseWindow,
    {
      window_id: windowId,
    },
  );
};

Plugin.prototype.nativeGetWindowInfo = async function(windowId: string) {
  const result = await this.call(
    MethodNativeGetWindowInfo,
    {
      window_id: windowId,
    },
  );
  return result as WindowDetail;
};

Plugin.prototype.nativeVolume = async function() {
  const result = await this.call(MethodNativeVolume);
  return result as NativeVolumeResponse;
};

Plugin.prototype.nativeSetVolume = async function(volume: number) {
  const result = await this.call(
    MethodNativeSetVolume,
    {
      volume,
    },
  );
};

Plugin.prototype.nativeMute = async function(muted: boolean) {
  const result = await this.call(
    MethodNativeMute,
    {
      muted,
    },
  );
};

Plugin.prototype.nativeDarkMode = async function() {
  const result = await this.call(MethodNativeDarkMode);
  return result as NativeDarkModeResponse;
};

Plugin.prototype.nativeSetDarkMode = async function(dark: boolean) {
  const result = await this.call(
    MethodNativeSetDarkMode,
    {
      dark,
    },
  );
};

Plugin.prototype.inputDrag = async function(fromX: number, fromY: number, toX: number, toY: number, durationMs?: number) {
  const result = await this.call(
    MethodInputDrag,
    {
      from_x: fromX,
      from_y: fromY,
      to_x: toX,
      to_y: toY,
      duration_ms: durationMs,
    },
  );
};

Plugin.prototype.inputClipboardRead = async function(contentType: string) {
  const result = await this.call(
    MethodInputClipboardRead,
    {
      content_type: contentType,
    },
  );
  return result as ClipboardContents;
};

Plugin.prototype.inputClipboardWrite = async function(contentType: string, data: string) {
  const result = await this.call(
    MethodInputClipboardWrite,
    {
      content_type: contentType,
      data,
    },
  );
};

Plugin.prototype.nativeBattery = async function() {
  const result = await this.call(MethodNativeBattery);
  return result as NativeBatteryResponse;
};

Plugin.prototype.nativeWifi = async function() {
  const result = await this.call(MethodNativeWifi);
  return result as NativeWifiResponse;
};

Plugin.prototype.nativePlaySound = async function(name: string) {
  const result = await this.call(
    MethodNativePlaySound,
    {
      name,
    },
  );
};

Plugin.prototype.nativeSpeak = async function(text: string, voice?: string, rate?: number) {
  const result = await this.call(
    MethodNativeSpeak,
    {
      text,
      voice,
      rate,
    },
  );
};

Plugin.prototype.nativeDisplays = async function() {
  const result = await this.call(MethodNativeDisplays);
  return (result as any).displays;
};

Plugin.prototype.nativeBrightness = async function(displayId?: number) {
  const result = await this.call(
    MethodNativeBrightness,
    {
      display_id: displayId,
    },
  );
  return result as NativeBrightnessResponse;
};

Plugin.prototype.nativeSetBrightness = async function(brightness: number, displayId?: number) {
  const result = await this.call(
    MethodNativeSetBrightness,
    {
      brightness,
      display_id: displayId,
    },
  );
};

Plugin.prototype.nativeScreenshot = async function(windowId?: string, displayId?: number, region?: unknown) {
  const result = await this.call(
    MethodNativeScreenshot,
    {
      window_id: windowId,
      display_id: displayId,
      region,
    },
  );
  return result as NativeScreenshotResponse;
};

Plugin.prototype.nativeMenuBar = async function(pid: number) {
  const result = await this.call(
    MethodNativeMenuBar,
    {
      pid,
    },
  );
  return (result as any).items;
};

Plugin.prototype.nativeClickMenuItem = async function(pid: number, path: string[]) {
  const result = await this.call(
    MethodNativeClickMenuItem,
    {
      pid,
      path,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeListSpaces = async function() {
  const result = await this.call(MethodNativeListSpaces);
  return (result as any).spaces;
};

Plugin.prototype.nativeActiveSpace = async function() {
  const result = await this.call(MethodNativeActiveSpace);
  return (result as any).active;
};

Plugin.prototype.nativeMoveWindowToSpace = async function(windowId: string, spaceId: number) {
  const result = await this.call(
    MethodNativeMoveWindowToSpace,
    {
      window_id: windowId,
      space_id: spaceId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeMoveWindowToDisplay = async function(windowId: string, displayId: number) {
  const result = await this.call(
    MethodNativeMoveWindowToDisplay,
    {
      window_id: windowId,
      display_id: displayId,
    },
  );
};

Plugin.prototype.nativeCaptureWindow = async function(windowId: string) {
  const result = await this.call(
    MethodNativeCaptureWindow,
    {
      window_id: windowId,
    },
  );
  return result as NativeCaptureWindowResponse;
};

Plugin.prototype.nativeSetWindowAlpha = async function(windowId: string, alpha: number) {
  const result = await this.call(
    MethodNativeSetWindowAlpha,
    {
      window_id: windowId,
      alpha,
    },
  );
};

Plugin.prototype.nativeAppIcon = async function(bundleId: string, size?: number) {
  const result = await this.call(
    MethodNativeAppIcon,
    {
      bundle_id: bundleId,
      size,
    },
  );
  return result as NativeAppIconResponse;
};

Plugin.prototype.inputDoubleClick = async function(x?: number, y?: number) {
  const result = await this.call(
    MethodInputDoubleClick,
    {
      x,
      y,
    },
  );
};

Plugin.prototype.inputRightClick = async function(x?: number, y?: number) {
  const result = await this.call(
    MethodInputRightClick,
    {
      x,
      y,
    },
  );
};

Plugin.prototype.inputSwitchInputSource = async function(sourceId: string) {
  const result = await this.call(
    MethodInputSwitchInputSource,
    {
      source_id: sourceId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.inputListInputSources = async function() {
  const result = await this.call(MethodInputListInputSources);
  return (result as any).sources;
};

Plugin.prototype.nativeDnd = async function() {
  const result = await this.call(MethodNativeDnd);
  return result as NativeDndResponse;
};

Plugin.prototype.nativeSetDnd = async function(enabled: boolean) {
  const result = await this.call(
    MethodNativeSetDnd,
    {
      enabled,
    },
  );
};

Plugin.prototype.nativeBluetoothDevices = async function() {
  const result = await this.call(MethodNativeBluetoothDevices);
  return (result as any).devices;
};

Plugin.prototype.nativePreventSleep = async function(reason?: string, assertionId?: string) {
  const result = await this.call(
    MethodNativePreventSleep,
    {
      reason,
      assertion_id: assertionId,
    },
  );
  return result as NativePreventSleepResponse;
};

Plugin.prototype.nativeSystemUptime = async function() {
  const result = await this.call(MethodNativeSystemUptime);
  return result as NativeSystemUptimeResponse;
};

Plugin.prototype.nativeScreenLock = async function() {
  const result = await this.call(MethodNativeScreenLock);
};

Plugin.prototype.nativeColorAtPoint = async function(x: number, y: number) {
  const result = await this.call(
    MethodNativeColorAtPoint,
    {
      x,
      y,
    },
  );
  return result as NativeColorAtPointResponse;
};

Plugin.prototype.nativeCursorInfo = async function() {
  const result = await this.call(MethodNativeCursorInfo);
  return result as NativeCursorInfoResponse;
};

Plugin.prototype.nativeSpotlight = async function(query: string, scope?: string[], limit?: number) {
  const result = await this.call(
    MethodNativeSpotlight,
    {
      query,
      scope,
      limit,
    },
  );
  return (result as any).results;
};

Plugin.prototype.nativeTrash = async function(path: string) {
  const result = await this.call(
    MethodNativeTrash,
    {
      path,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeFileTags = async function(path: string, tags?: string[]) {
  const result = await this.call(
    MethodNativeFileTags,
    {
      path,
      tags,
    },
  );
  return result as NativeFileTagsResponse;
};

Plugin.prototype.nativeRevealInFinder = async function(path: string) {
  const result = await this.call(
    MethodNativeRevealInFinder,
    {
      path,
    },
  );
};

Plugin.prototype.nativeQuickLook = async function(path: string, size?: number) {
  const result = await this.call(
    MethodNativeQuickLook,
    {
      path,
      size,
    },
  );
  return result as NativeQuickLookResponse;
};

Plugin.prototype.nativeSelectedFinderItems = async function() {
  const result = await this.call(MethodNativeSelectedFinderItems);
  return (result as any).paths;
};

Plugin.prototype.nativeNotify = async function(title: string, body?: string, subtitle?: string, sound?: string) {
  const result = await this.call(
    MethodNativeNotify,
    {
      title,
      body,
      subtitle,
      sound,
    },
  );
  return result as NativeNotifyResponse;
};

Plugin.prototype.nativeListNotifications = async function() {
  const result = await this.call(MethodNativeListNotifications);
  return (result as any).notifications;
};

Plugin.prototype.nativeDismissNotification = async function(id: string) {
  const result = await this.call(
    MethodNativeDismissNotification,
    {
      id,
    },
  );
};

Plugin.prototype.nativeCurrentUser = async function() {
  const result = await this.call(MethodNativeCurrentUser);
  return result as UserSessionInfo;
};

Plugin.prototype.nativeDefaultBrowser = async function() {
  const result = await this.call(MethodNativeDefaultBrowser);
  return result as NativeDefaultBrowserResponse;
};

Plugin.prototype.nativeLoginItems = async function() {
  const result = await this.call(MethodNativeLoginItems);
  return result as NativeLoginItemsResponse;
};

Plugin.prototype.nativeClipboardChangeCount = async function() {
  const result = await this.call(MethodNativeClipboardChangeCount);
  return result as NativeClipboardChangeCountResponse;
};

Plugin.prototype.inputClipboardReadAll = async function() {
  const result = await this.call(MethodInputClipboardReadAll);
  return result as InputClipboardReadAllResponse;
};

Plugin.prototype.inputClipboardWriteItems = async function(items: unknown[]) {
  const result = await this.call(
    MethodInputClipboardWriteItems,
    {
      items,
    },
  );
};

Plugin.prototype.nativeAxElementAtPoint = async function(pid: number, x: number, y: number) {
  const result = await this.call(
    MethodNativeAxElementAtPoint,
    {
      pid,
      x,
      y,
    },
  );
  return result as AXElementInfo;
};

Plugin.prototype.nativeAxElementTree = async function(element: AXElementRef, depth?: number) {
  const result = await this.call(
    MethodNativeAxElementTree,
    {
      element,
      depth,
    },
  );
  return result as AXElementNode;
};

Plugin.prototype.nativeAxReadAttributes = async function(element: AXElementRef, attributes: string[]) {
  const result = await this.call(
    MethodNativeAxReadAttributes,
    {
      element,
      attributes,
    },
  );
};

Plugin.prototype.nativeAxSetAttribute = async function(element: AXElementRef, attribute: string, value: unknown) {
  const result = await this.call(
    MethodNativeAxSetAttribute,
    {
      element,
      attribute,
      value,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeAxPerformAction = async function(element: AXElementRef, action: string) {
  const result = await this.call(
    MethodNativeAxPerformAction,
    {
      element,
      action,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeAxObserve = async function(pid: number, notifications: string[]) {
  const result = await this.call(
    MethodNativeAxObserve,
    {
      pid,
      notifications,
    },
  );
  return result as NativeAxObserveResponse;
};

Plugin.prototype.nativeAxUnobserve = async function(subscriptionId: string) {
  const result = await this.call(
    MethodNativeAxUnobserve,
    {
      subscription_id: subscriptionId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeObserveWindows = async function(pid: number) {
  const result = await this.call(
    MethodNativeObserveWindows,
    {
      pid,
    },
  );
  return result as NativeObserveWindowsResponse;
};

Plugin.prototype.nativeUnobserveWindows = async function(subscriptionId: string) {
  const result = await this.call(
    MethodNativeUnobserveWindows,
    {
      subscription_id: subscriptionId,
    },
  );
  return (result as any).result;
};

Plugin.prototype.nativeSetWindowLevel = async function(windowId: string, level: "floating" | "normal" | "below") {
  const result = await this.call(
    MethodNativeSetWindowLevel,
    {
      window_id: windowId,
      level,
    },
  );
  return (result as any).result;
};

Plugin.prototype.controlSignal = async function(signal: string) {
  const result = await this.call(
    MethodControlSignal,
    {
      signal,
    },
  );
};

Plugin.prototype.eventsEmit = async function(eventType: string, data?: unknown, correlationId?: string) {
  const result = await this.call(
    MethodEventsEmit,
    {
      event_type: eventType,
      data,
      correlation_id: correlationId,
    },
  );
};
