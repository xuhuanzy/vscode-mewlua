import * as vscode from 'vscode';

import * as commands from './commands';
import { type CommandFactory, Ctx, detectServerWorkspace } from './ctx';
import type { SyntaxTreeManager } from './syntaxTreeProvider';
import { EXTENSION_NAME } from './util';

const { t } = vscode.l10n;

let extensionCtx: Ctx | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<Ctx> {
    extensionCtx = new Ctx(context, createCommands(), detectServerWorkspace());

    try {
        await extensionCtx.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(
            t('Cannot activate {0} extension: {1}', EXTENSION_NAME, message),
        );
        throw error;
    }

    return extensionCtx;
}

export async function deactivate(): Promise<void> {
    await extensionCtx?.stopAndDispose();
    extensionCtx = undefined;
}

function createCommands(): Record<string, CommandFactory> {
    let syntaxTreeManager: SyntaxTreeManager | undefined;

    return {
        startServer: {
            enabled: (ctx) => async () => {
                await ctx.start();
            },
            disabled: (ctx) => async () => {
                await ctx.start();
            },
        },
        stopServer: {
            enabled: (ctx) => async () => {
                await ctx.stopAndDispose();
            },
            disabled: (_) => async () => { },
        },
        restartServer: {
            enabled: (ctx) => async () => {
                await ctx.restart();
            },
            disabled: (ctx) => async () => {
                await ctx.start();
            },
        },
        openLogs: {
            enabled: commands.openLogs,
            disabled: commands.openLogs,
        },
        showExtensionInfo: {
            enabled: commands.showExtensionInfo,
            disabled: commands.showExtensionInfo,
        },
        showSyntaxTree: {
            enabled: (ctx) => async (uri?: vscode.Uri) => {
                let manager = syntaxTreeManager;
                if (!manager) {
                    const { SyntaxTreeManager } = await import('./syntaxTreeProvider.js');
                    const nextManager = new SyntaxTreeManager(ctx.client);
                    manager = nextManager;
                    syntaxTreeManager = manager;
                    ctx.pushClientCleanup({
                        dispose: () => {
                            nextManager.dispose();
                            if (syntaxTreeManager === nextManager) {
                                syntaxTreeManager = undefined;
                            }
                        },
                    });
                }

                await manager.show(uri);
            },
        },
        showReferences: {
            command: 'emmy.showReferences',
            enabled: commands.showReferences,
        },
    };
}
