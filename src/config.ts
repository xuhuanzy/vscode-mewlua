import * as vscode from 'vscode';

import { LANGUAGE_ID } from './util';

export function getPreferredConfigurationScope(uri?: vscode.Uri): vscode.ConfigurationScope | undefined {
    if (uri) {
        return vscode.workspace.getWorkspaceFolder(uri) ?? uri;
    }

    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri) {
        return vscode.workspace.getWorkspaceFolder(activeUri) ?? activeUri;
    }

    return vscode.workspace.workspaceFolders?.[0];
}

export class Config implements vscode.Disposable {
    static readonly rootSection = 'mewlua';

    configureLang: vscode.Disposable | undefined;
    private config: vscode.WorkspaceConfiguration;

    constructor(scope?: vscode.ConfigurationScope) {
        this.config = vscode.workspace.getConfiguration(Config.rootSection, scope);
        this.configureLanguage();
    }

    refresh(scope?: vscode.ConfigurationScope): void {
        this.config = vscode.workspace.getConfiguration(Config.rootSection, scope);
    }

    get<T>(section: string, defaultValue?: T): T | undefined {
        // `this.config` 此时只包含 `mewlua` 下的配置项, 调用方传入不带前缀的业务键名.
        return this.config.get<T>(section, defaultValue as T);
    }

    getExecutablePath(): string | undefined {
        return this.get<string>('ls.executablePath');
    }

    /**
     * 使语言服务器加载指定的全局配置文件, 该配置文件优先级较低, 配置项会被项目级的覆盖.
     */
    getGlobalConfigPath(): string | undefined {
        return this.get<string>('ls.globalConfigPath');
    }

    getStartParameters(): string[] {
        return this.get<string[]>('ls.startParameters', []) || [];
    }

    /** 在换行时自动延续前缀 */
    get typingContinueCommentsOnNewline(): boolean {
        return this.get<boolean>('typing.continueCommentsOnNewline', true) ?? true;
    }

    configureLanguage(): void {
        this.configureLang?.dispose();
        this.configureLang = undefined;

        let onEnterRules: vscode.OnEnterRule[] = [
            {
                // `function ... end` 块内换行时让光标落到函数体缩进层.
                beforeText: /^\s*(?:local\s+)?function(?:\s+[\w.:]+)?\s*\(.*\)\s*$/,
                afterText: /^\s*end\s*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
            {
                // `name = function ... end` 形式和声明式函数保持一致.
                beforeText: /^\s*(?!--).+\s*=\s*function\s*\(.*\)\s*(?:--.*)?$/,
                afterText: /^\s*end\s*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
            {
                beforeText: /^\s*(?:if|elseif)\b.*\bthen\s*$/,
                afterText: /^\s*end\s*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
            {
                beforeText: /^\s*(?:for|while)\b.*\bdo\s*$/,
                afterText: /^\s*end\s*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
            {
                beforeText: /^\s*(?:do|else)\s*$/,
                afterText: /^\s*end\s*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
            {
                beforeText: /^\s*repeat\s*$/,
                afterText: /^\s*until\b.*$/,
                action: {
                    indentAction: vscode.IndentAction.IndentOutdent,
                    appendText: '\t',
                },
            },
        ];

        if (this.typingContinueCommentsOnNewline) {
            const indentAction = vscode.IndentAction.None;

            onEnterRules = [
                {
                    // EmmyLua alias 的 `---|` 续行需要保留竖线前缀.
                    beforeText: /^\s*---\|.*$/,
                    action: { indentAction, appendText: '---| ' },
                },
                {
                    // 常见 EmmyLua 注解后继续给出注解前缀.
                    beforeText: /^\s*---@(?:class|field|param|generic|overload|alias|type|return|enum|diagnostic|module|operator|async|cast|deprecated|private|protected|public|package)\b.*$/,
                    action: { indentAction, appendText: '---@' },
                },
                {
                    beforeText: /^\s*---\s+.*$/,
                    action: { indentAction, appendText: '--- ' },
                },
                {
                    beforeText: /^\s*---$/,
                    action: { indentAction, appendText: '---' },
                },
                {
                    beforeText: /^\s*--\s+.*$/,
                    action: { indentAction, appendText: '-- ' },
                },
                {
                    beforeText: /^\s*--$/,
                    action: { indentAction, appendText: '--' },
                },
                ...onEnterRules,
            ];
        }

        this.configureLang = vscode.languages.setLanguageConfiguration(LANGUAGE_ID, {
            onEnterRules,
        });
    }

    dispose(): void {
        this.configureLang?.dispose();
    }
}
