import * as vscode from 'vscode';

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

export class ConfigurationManager {
    static readonly rootSection = 'mewlua';

    private readonly config: vscode.WorkspaceConfiguration;

    constructor(scope?: vscode.ConfigurationScope) {
        this.config = vscode.workspace.getConfiguration(ConfigurationManager.rootSection, scope);
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

    affectsLanguageServer(event: vscode.ConfigurationChangeEvent): boolean {
        return event.affectsConfiguration(`${ConfigurationManager.rootSection}.ls`);
    }
}
