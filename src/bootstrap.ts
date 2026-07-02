import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/node';

import { ConfigurationManager } from './config';

export type ServerInfo =
    | {
        readonly mode: 'debug';
        readonly path: string;
        readonly port: number;
        readonly version?: string;
    }
    | {
        readonly mode: 'process';
        readonly path: string;
        readonly version: string;
    };

export interface ServerLaunch {
    readonly serverInfo: ServerInfo;
    readonly serverOptions: lc.ServerOptions;
}

export function createServerLaunch(
    context: vscode.ExtensionContext,
    config: ConfigurationManager,
    outputChannel: vscode.LogOutputChannel,
): ServerLaunch {
    const serverInfo = resolveServerInfo(context, config, outputChannel);
    if (serverInfo.mode === 'debug') {
        return {
            serverInfo,
            serverOptions: createDebugServerOptions(serverInfo.port, outputChannel),
        };
    }

    const globalConfigPath = config.getGlobalConfigPath()?.trim();
    const env = { ...process.env };

    // 全局配置文件通过 EmmyLua server 约定的环境变量传递给语言服务器.
    if (globalConfigPath) {
        let globalConfigStat: fs.Stats;
        try {
            globalConfigStat = fs.statSync(globalConfigPath);
        } catch (error) {
            throw new Error(
                `Global EmmyLua config was not found at ${globalConfigPath}. ` +
                'Configure mewlua.ls.globalConfigPath to an existing file.',
                { cause: error },
            );
        }

        if (!globalConfigStat.isFile()) {
            throw new Error(
                `Global EmmyLua config path must be a file, but got ${globalConfigPath}. ` +
                'Configure mewlua.ls.globalConfigPath to a file path.',
            );
        }

        env['EMMYLUALS_CONFIG'] = globalConfigPath;
    }

    return {
        serverInfo,
        serverOptions: {
            command: serverInfo.path,
            args: config.getStartParameters(),
            options: { env },
        },
    };
}

export function resolveServerInfo(
    context: vscode.ExtensionContext,
    config: ConfigurationManager,
    outputChannel?: vscode.LogOutputChannel,
): ServerInfo {
    const debugServerPortValue = process.env['__MEWLUA_LS_DEBUG_PORT']?.trim();
    if (debugServerPortValue) {
        const debugServerPort = Number(debugServerPortValue);
        return {
            mode: 'debug',
            path: `tcp://127.0.0.1:${debugServerPort}`,
            port: debugServerPort,
        };
    }

    const configuredPath = config.getExecutablePath()?.trim();
    const executablePath = configuredPath || path.join(context.extensionPath, 'server', getExecutableName());

    let executableStat: fs.Stats;
    try {
        executableStat = fs.statSync(executablePath);
    } catch (error) {
        if (configuredPath) {
            throw new Error(
                `Configured language server executable was not found at ${executablePath}. ` +
                'Configure mewlua.ls.executablePath to an existing file.',
                { cause: error },
            );
        }

        throw new Error(
            `Language server executable was not found at ${executablePath}. ` +
            'Configure mewlua.ls.executablePath or place the bundled server under the extension server directory.',
            { cause: error },
        );
    }

    if (!executableStat.isFile()) {
        throw new Error(
            `Language server executable path must be a file, but got ${executablePath}. ` +
            'Configure mewlua.ls.executablePath to a file path.',
        );
    }

    if (!configuredPath && os.platform() !== 'win32') {
        try {
            fs.chmodSync(executablePath, 0o755);
        } catch (error) {
            outputChannel?.appendLine(`Failed to chmod language server: ${String(error)}`);
        }
    }

    const versionOutput = childProcess.execFileSync(executablePath, ['--version'], {
        encoding: 'utf8',
        windowsHide: true,
    });

    return {
        mode: 'process',
        path: executablePath,
        version: versionOutput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) || '',
    };
}

function createDebugServerOptions(
    port: number,
    outputChannel: vscode.LogOutputChannel,
): lc.ServerOptions {
    return () =>
        new Promise<lc.StreamInfo>((resolve, reject) => {
            // 调试模式由外部 server 监听端口, 插件只负责接入同一条 LSP 流.
            const socket = net.connect({ host: '127.0.0.1', port }, () => {
                resolve({
                    reader: socket,
                    writer: socket,
                });
            });

            socket.on('close', () => {
                outputChannel.appendLine(`Language server socket closed on port ${port}.`);
            });
            socket.on('error', (error) => {
                outputChannel.appendLine(`Language server socket error: ${error.message}`);
                reject(error);
            });
        });
}

function getExecutableName(): string {
    return os.platform() === 'win32'
        ? 'emmylua_ls.exe'
        : 'emmylua_ls';
}
