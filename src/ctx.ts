import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/node';

import { createServerLaunch, resolveServerInfo, type ServerInfo } from './bootstrap';
import { createClient } from './client';
import { Config, getPreferredConfigurationScope } from './config';
import {
    EXTENSION_NAME,
    LANGUAGE_CLIENT_NAME,
    LANGUAGE_ID,
    commandName,
    isLuaDocument,
} from './util';

const { t } = vscode.l10n;

export type Workspace =
    | { kind: 'Empty' }
    | { kind: 'Workspace Folder' }
    | { kind: 'Detached Files'; files: vscode.TextDocument[] };

/** 检测当前 VS Code 窗口是否具备可启动语言服务器的工作区环境. */
export function detectServerWorkspace(): Workspace {
    // 只把本地文件系统工作区视为可启动语言服务器的工作区.
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
        (folder) => folder.uri.scheme === 'file',
    );
    const luaDocuments = vscode.workspace.textDocuments.filter(isLuaDocument);

    if (folders.length > 0) {
        return { kind: 'Workspace Folder' };
    }

    if (luaDocuments.length > 0) {
        return { kind: 'Detached Files', files: luaDocuments };
    }

    return { kind: 'Empty' };
}

export type Cmd = (...args: any[]) => unknown;

export type CommandFactory = {
    /** 完整命令名. 省略时会补 `mewlua.` 前缀. */
    command?: string;
    /** 语言服务器运行时使用的命令回调. */
    enabled: (ctx: CtxInit) => Cmd;
    /** 语言服务器不可用时的降级回调. 省略时显示统一的未运行提示. */
    disabled?: (ctx: Ctx) => Cmd;
};

export type CtxInit = Ctx & {
    readonly client: lc.LanguageClient;
};

export type ServerState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

export interface ServerStatus {
    readonly state: ServerState;
    readonly message?: string;
    readonly details?: string;
}

export class Ctx implements vscode.Disposable {
    readonly languageId = LANGUAGE_ID;
    readonly version: string;
    readonly config: Config;
    /** 语言服务器的状态栏 */
    readonly statusBar: vscode.StatusBarItem;
    /** 右侧的语言项显示 */
    readonly languageStatus: vscode.LanguageStatusItem;
    private _client: lc.LanguageClient | undefined;
    private _serverInfo: ServerInfo | undefined;
    private _workspace: Workspace;
    private _outputChannel: vscode.LogOutputChannel | undefined;
    private serverStatus: ServerStatus = { state: 'stopped' };
    private clientSubscriptions: vscode.Disposable[] = [];
    private commandDisposables: vscode.Disposable[] = [];

    constructor(
        readonly extCtx: vscode.ExtensionContext,
        private readonly commandFactories: Record<string, CommandFactory>,
        workspace: Workspace,
    ) {
        this._workspace = workspace;
        this.version = extCtx.extension.packageJSON.version ?? '<unknown>';
        this.config = new Config(getPreferredConfigurationScope());

        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

        this.languageStatus = vscode.languages.createLanguageStatusItem('mewlua.serverStatus', {
            language: this.languageId,
        });
        this.languageStatus.name = EXTENSION_NAME;

        extCtx.subscriptions.push(this);
        extCtx.subscriptions.push(
            vscode.commands.registerCommand('type', async (args: { text?: string }) => {
                await this.typeText(args);
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(async () => {
                await this.onWorkspaceFolderChanges();
            }),
            vscode.workspace.onDidChangeConfiguration(async (event) => {
                const scope = getPreferredConfigurationScope();
                if (!event.affectsConfiguration(Config.rootSection, scope)) {
                    return;
                }

                this.config.refresh(scope);
                this.config.configureLanguage();
                if (this._client) {
                    await this.restart();
                }
            }),
        );

        this.updateCommands(true);
        this.setServerStatus({ state: 'stopped' });
    }

    get client(): lc.LanguageClient | undefined {
        return this._client;
    }

    /** 返回语言客户端的主日志输出通道. */
    get outputChannel(): vscode.LogOutputChannel | undefined {
        return this._outputChannel;
    }

    /** 返回本次启动解析出的语言服务器信息. */
    get serverInfo(): ServerInfo | undefined {
        return this._serverInfo;
    }

    /** 返回当前窗口的工作区状态. */
    get workspace(): Workspace {
        return this._workspace;
    }

    /** 返回当前语言服务器状态. */
    get currentServerStatus(): Readonly<ServerStatus> {
        return this.serverStatus;
    }

    /** 返回扩展生命周期订阅集合. */
    get subscriptions(): vscode.Disposable[] {
        return this.extCtx.subscriptions;
    }

    /** 返回扩展安装目录路径. */
    get extensionPath(): string {
        return this.extCtx.extensionPath;
    }

    /** 启动语言服务器并刷新相关 UI 状态. */
    async start(): Promise<void> {
        if (this._client?.isRunning()) {
            return;
        }

        // 每次启动前重新判断当前窗口环境, 避免工作区状态变化后沿用旧结果.
        this._workspace = detectServerWorkspace();
        if (this._workspace.kind === 'Empty') {
            this.setServerStatus({
                state: 'stopped',
                message: t('No file-backed Lua workspace or document is open.'),
            });
            return;
        }

        this.setServerStatus({ state: 'starting' });

        try {
            const client = await this.getOrCreateClient();
            await client.start();
            this.setServerStatus({ state: 'running' });
        } catch (error) {
            // 启动失败时清掉半初始化的 client, 让下一次启动可以重新创建完整实例.
            await this.disposeClient();
            const message = error instanceof Error ? error.message : String(error);
            this.setServerStatus({
                state: 'error',
                message: t('Failed to start {0} language server.', EXTENSION_NAME),
                details: message,
            });
            throw error;
        }
    }

    /** 重启语言服务器并重新应用当前配置. */
    async restart(): Promise<void> {
        await this.stopAndDispose(t('Restarting {0} language server...', EXTENSION_NAME));
        await this.start();
    }

    /** 停止语言服务器并释放当前 client 资源. */
    async stopAndDispose(message?: string): Promise<void> {
        if (!this._client) {
            this.setServerStatus({ state: 'stopped' });
            return;
        }

        this.setServerStatus(message ? { state: 'stopping', message } : { state: 'stopping' });
        try {
            await this._client.stop();
        } finally {
            // 无论 stop 是否正常返回, 都释放 VS Code 侧持有的 client 资源.
            await this.disposeClient();
            this.setServerStatus({ state: 'stopped' });
        }
    }

    /** 释放扩展上下文持有的服务器和 UI 资源. */
    dispose(): void {
        // VS Code 的 dispose 是同步入口, 这里异步关闭服务器并继续释放 UI 资源.
        void this.stopAndDispose();
        this.config.dispose();
        this.statusBar.dispose();
        this.languageStatus.dispose();
        this._outputChannel?.dispose();
        this.commandDisposables.forEach((disposable) => disposable.dispose());
        this.commandDisposables = [];
    }

    /** 记录需要跟随当前 client 一起释放的订阅. */
    pushClientCleanup(disposable: vscode.Disposable): void {
        this.clientSubscriptions.push(disposable);
    }

    /** 处理 VS Code 默认换行规则无法覆盖的 Lua 输入场景. */
    private async typeText(args: { text?: string }): Promise<void> {
        const text = args.text;
        const editor = vscode.window.activeTextEditor;

        // 只接管 Lua 单光标回车, 其它输入保持 VS Code 默认行为.
        if (
            text !== '\n' ||
            !editor ||
            editor.document.languageId !== LANGUAGE_ID ||
            !this.config.typingContinueCommentsOnNewline ||
            editor.selections.length !== 1 ||
            !editor.selection.isEmpty
        ) {
            await vscode.commands.executeCommand('default:type', args);
            return;
        }

        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line).text;
        const beforeText = line.slice(0, position.character);
        const afterText = line.slice(position.character);

        // 只处理 `---@alias Name {|}` 场景, 避免影响普通表字面量或其它注解.
        if (!/^\s*---@alias\s+\S+\s*\{\s*$/.test(beforeText) || !/^\s*\}\s*$/.test(afterText)) {
            await vscode.commands.executeCommand('default:type', args);
            return;
        }

        const indent = /^(\s*)/.exec(beforeText)?.[1] ?? '';
        const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
        const indentUnit = editor.options.insertSpaces ? ' '.repeat(tabSize) : '\t';
        const insertion = `\n${indent}---${indentUnit}\n${indent}---`;

        // 这里保留原有的 `}`, 只补齐 alias 多行注释前缀和编辑位置.
        await editor.edit((edit) => {
            edit.insert(position, insertion);
        });

        editor.selection = new vscode.Selection(
            position.line + 1,
            indent.length + 3 + indentUnit.length,
            position.line + 1,
            indent.length + 3 + indentUnit.length,
        );
    }

    /** 根据当前配置解析语言服务器可执行信息. */
    getServerInfo(config?: Config): ServerInfo {
        return resolveServerInfo(this.extCtx, config ?? this.config, this._outputChannel);
    }

    /** 响应工作区文件夹变化并按需要停止或重启服务器. */
    private async onWorkspaceFolderChanges(): Promise<void> {
        const nextWorkspace = detectServerWorkspace();
        const previousKind = this._workspace.kind;
        this._workspace = nextWorkspace;

        // 没有可分析的 Lua 环境时立即停服, 避免后台服务器继续占用资源.
        if (nextWorkspace.kind === 'Empty') {
            await this.stopAndDispose(
                t('Stopping {0} language server because no Lua workspace is open.', EXTENSION_NAME),
            );
            return;
        }

        // 工作区类型切换会影响初始化参数, 已运行的 client 需要重建.
        if (this._client?.isRunning() && previousKind !== nextWorkspace.kind) {
            await this.restart();
        }
    }

    /** 获取现有 client 或创建一个新的语言客户端实例. */
    private async getOrCreateClient(): Promise<lc.LanguageClient> {
        if (this._client) {
            return this._client;
        }

        if (!this._outputChannel) {
            this._outputChannel = vscode.window.createOutputChannel(LANGUAGE_CLIENT_NAME, {
                log: true,
            });
        }

        // serverInfo 跟随本次启动配置刷新, 菜单和日志命令会读取这个结果.
        this.config.refresh(getPreferredConfigurationScope());
        const serverLaunch = createServerLaunch(this.extCtx, this.config, this._outputChannel);
        this._serverInfo = serverLaunch.serverInfo;
        this._client = createClient({
            serverOptions: serverLaunch.serverOptions,
            outputChannel: this._outputChannel,
        });

        this.pushClientCleanup(
            this._client.onDidChangeState((event: lc.StateChangeEvent) => {
                // 处理服务端自行退出的场景, 让 UI 状态能跟上 client 状态变化.
                if (event.newState === lc.State.Stopped && this.serverStatus.state === 'running') {
                    this.setServerStatus({ state: 'stopped' });
                }
            }),
        );

        return this._client;
    }

    /** 释放当前语言客户端及其关联订阅. */
    private async disposeClient(): Promise<void> {
        // client 级订阅只绑定当前实例, 重建 client 前需要全部注销.
        this.clientSubscriptions.forEach((disposable) => disposable.dispose());
        this.clientSubscriptions = [];
        await this._client?.dispose();
        this._client = undefined;
        this._serverInfo = undefined;
    }

    /** 写入服务器状态并同步命令与 UI. */
    private setServerStatus(status: ServerStatus): void {
        this.serverStatus = status;
        this.updateStatusBar();
        void vscode.commands.executeCommand('setContext', 'mewlua.serverRunning', status.state === 'running');
        // 只有运行态才注册 enabled 命令, 其它状态统一落到 disabled 行为.
        this.updateCommands(status.state !== 'running');
    }

    /** 按当前服务器状态重新注册扩展命令. */
    private updateCommands(forceDisable = false): void {
        // 命令回调捕获当前 client 状态, 状态变化后需要重新注册一轮.
        this.commandDisposables.forEach((disposable) => disposable.dispose());
        this.commandDisposables = [];

        const clientRunning = !forceDisable && this._client?.isRunning() === true;
        const runningCtx = clientRunning ? (this as CtxInit) : undefined;

        for (const [name, factory] of Object.entries(this.commandFactories)) {
            const fullName = factory.command ?? commandName(name);
            let callback: Cmd;
            if (runningCtx) {
                callback = factory.enabled(runningCtx);
            } else if (factory.disabled) {
                callback = factory.disabled(this);
            } else {
                callback = () => {
                    void vscode.window.showWarningMessage(
                        t('Command {0} failed: {1} server is not running.', fullName, EXTENSION_NAME),
                    );
                };
            }

            this.commandDisposables.push(vscode.commands.registerCommand(fullName, callback));
        }
    }

    /** 根据服务器状态刷新状态栏和语言状态项. */
    private updateStatusBar(): void {
        const status = this.serverStatus;
        const tooltip = new vscode.MarkdownString('', true);
        tooltip.isTrusted = true;
        tooltip.appendMarkdown(
            `[${t('Extension Info')}](command:${commandName('showExtensionInfo')})`,
        );
        tooltip.appendText(`: Version ${this.version}, Server Version ${this._serverInfo?.version || '<not running>'}`);
        tooltip.appendMarkdown('\n\n');

        if (status.message) {
            tooltip.appendMarkdown(`${status.message}\n\n`);
        }

        if (status.details) {
            tooltip.appendMarkdown('```text\n');
            tooltip.appendMarkdown(status.details.replace(/```/g, "'''"));
            tooltip.appendMarkdown('\n```\n\n');
        }

        tooltip.appendMarkdown(`[$(terminal) ${t('Open logs')}](command:${commandName('openLogs')})\n\n`);

        if (status.state === 'running') {
            // 运行态提供 stop/restart 快捷入口, 稳定的非运行态提供 start 入口.
            tooltip.appendMarkdown(
                `[$(stop-circle) ${t('Stop server')}](command:${commandName('stopServer')})\n\n`,
            );
            tooltip.appendMarkdown(
                `[$(debug-restart) ${t('Restart server')}](command:${commandName('restartServer')})`,
            );
        } else if (status.state !== 'starting' && status.state !== 'stopping') {
            tooltip.appendMarkdown(`[$(play) ${t('Start server')}](command:${commandName('startServer')})`);
        }

        const configByState: Record<ServerState, { icon: string; severity: vscode.LanguageStatusSeverity; color?: vscode.ThemeColor; backgroundColor?: vscode.ThemeColor }> = {
            starting: {
                icon: '$(sync~spin) ',
                severity: vscode.LanguageStatusSeverity.Information,
            },
            running: {
                icon: '',
                severity: vscode.LanguageStatusSeverity.Information,
            },
            stopping: {
                icon: '$(sync~spin) ',
                severity: vscode.LanguageStatusSeverity.Information,
            },
            stopped: {
                icon: '$(stop-circle) ',
                severity: vscode.LanguageStatusSeverity.Warning,
                color: new vscode.ThemeColor('statusBarItem.warningForeground'),
                backgroundColor: new vscode.ThemeColor('statusBarItem.warningBackground'),
            },
            error: {
                icon: '$(error) ',
                severity: vscode.LanguageStatusSeverity.Error,
                color: new vscode.ThemeColor('statusBarItem.errorForeground'),
                backgroundColor: new vscode.ThemeColor('statusBarItem.errorBackground'),
            },
        };

        const stateConfig = configByState[status.state];
        // 状态栏负责全局可见入口, language status 负责跟随 Lua 文档展示细粒度状态.
        this.statusBar.text = `${stateConfig.icon}${EXTENSION_NAME}`;
        this.statusBar.command = status.state === 'stopped' ? commandName('startServer') : commandName('openLogs');
        this.statusBar.tooltip = tooltip;
        this.statusBar.color = stateConfig.color;
        this.statusBar.backgroundColor = stateConfig.backgroundColor;
        this.statusBar.show();

        this.languageStatus.busy = status.state === 'starting' || status.state === 'stopping';
        this.languageStatus.severity = stateConfig.severity;
    }
}
