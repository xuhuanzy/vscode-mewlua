import * as vscode from 'vscode';
import * as lc from "vscode-languageclient";

import type { Cmd, Ctx, CtxInit } from './ctx';
import type { LanguageClient } from "vscode-languageclient/node";

export function openLogs(ctx: Ctx): Cmd {
    return () => {
        if (ctx.outputChannel) {
            ctx.outputChannel.show();
        }
    };
}

export function showExtensionInfo(ctx: Ctx): Cmd {
    return () => {
        let serverInfo;
        try {
            serverInfo = ctx.serverInfo ?? ctx.getServerInfo();
        } catch {
            return;
        }

        void vscode.window.showInformationMessage(
            [
                `Extension Version: ${ctx.version}`,
                `Server Version: ${serverInfo.version || '<unknown>'}`,
                `Server Path: ${serverInfo.path}`,
            ].join('; '),
        );
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
