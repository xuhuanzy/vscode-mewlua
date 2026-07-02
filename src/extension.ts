import * as vscode from 'vscode';

import * as commands from './commands';
import { type CommandFactory, Ctx, detectServerWorkspace } from './ctx';
import { SyntaxTreeManager } from './syntaxTreeProvider';
import { EXTENSION_NAME } from './util';

let extensionCtx: Ctx | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<Ctx> {
    const syntaxTreeManager = new SyntaxTreeManager(() => extensionCtx?.client);
    context.subscriptions.push(syntaxTreeManager);

    extensionCtx = new Ctx(context, createCommands(syntaxTreeManager), detectServerWorkspace());

    try {
        await extensionCtx.start();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Cannot activate ${EXTENSION_NAME} extension: ${message}`);
        throw error;
    }

    return extensionCtx;
}

export async function deactivate(): Promise<void> {
    await extensionCtx?.stopAndDispose();
    extensionCtx = undefined;
}

function createCommands(syntaxTreeManager: SyntaxTreeManager): Record<string, CommandFactory> {
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
            disabled: (_) => async () => {},
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
            enabled: (_) => async (uri?: vscode.Uri) => {
                await syntaxTreeManager.show(uri);
            },
        },
        showReferences: {
            command: 'emmy.showReferences',
            enabled: commands.showReferences,
        },
    };
}
