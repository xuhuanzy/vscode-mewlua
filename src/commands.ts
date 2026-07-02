import * as vscode from 'vscode';
import * as lc from "vscode-languageclient";

import type { Cmd, Ctx, CtxInit } from './ctx';
import { EXTENSION_NAME } from './util';
import type { LanguageClient } from "vscode-languageclient/node";


export function openLogs(ctx: Ctx): Cmd {
    return () => {
        if (ctx.outputChannel) {
            ctx.outputChannel.show();
            return;
        }

        void vscode.window.showInformationMessage(`${EXTENSION_NAME} output channel has not been initialized yet.`);
    };
}

export function showExtensionInfo(ctx: Ctx): Cmd {
    return () => {
        try {
            const serverInfo = ctx.serverInfo ?? ctx.getServerInfo();
            void vscode.window.showInformationMessage(
                [
                    `Extension Version: ${ctx.version}`,
                    `Server Version: ${serverInfo.version || '<unknown>'}`,
                    `Server Path: ${serverInfo.path}`,
                ].join('; '),
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Cannot resolve ${EXTENSION_NAME} extension info: ${message}`);
        }
    };
}

async function showReferencesImpl(
    client: LanguageClient | undefined,
    uri: string,
    position: lc.Position,
    locations: lc.Location[],
) {
    if (client) {
        await vscode.commands.executeCommand(
            "editor.action.showReferences",
            vscode.Uri.parse(uri),
            client.protocol2CodeConverter.asPosition(position),
            locations.map(client.protocol2CodeConverter.asLocation),
        );
    }
}

export function showReferences(ctx: CtxInit): Cmd {
    return async (uri: string, position: lc.Position, locations: lc.Location[]) => {
        await showReferencesImpl(ctx.client, uri, position, locations);
    };
}
