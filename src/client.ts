import * as vscode from 'vscode';
import * as lc from 'vscode-languageclient/node';

import { LANGUAGE_CLIENT_NAME, LANGUAGE_ID } from './util';

export interface CreateClientOptions {
    readonly serverOptions: lc.ServerOptions;
    readonly outputChannel: vscode.LogOutputChannel;
}

export function createClient(options: CreateClientOptions): lc.LanguageClient {
    const clientOptions: lc.LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
        initializationOptions: {},
        markdown: {
            isTrusted: false,
            supportHtml: true,
            supportThemeIcons: true,
        },
        outputChannel: options.outputChannel,
    };

    return new lc.LanguageClient(
        LANGUAGE_ID,
        LANGUAGE_CLIENT_NAME,
        options.serverOptions,
        clientOptions,
    );
}
