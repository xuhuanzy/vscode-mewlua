import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

import { type SyntaxTreeParams, type SyntaxTreeResponse } from './lspExtension';
import { isLuaDocument } from './util';

const { t } = vscode.l10n;

export class SyntaxTreeProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    static readonly SCHEME = 'emmylua-syntax-tree';

    private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this.onDidChangeEmitter.event;

    constructor(private readonly client: LanguageClient) { }

    static createUri(sourceUri: vscode.Uri): vscode.Uri {
        const fileName = path.basename(sourceUri.fsPath || sourceUri.path);
        return vscode.Uri.from({
            scheme: SyntaxTreeProvider.SCHEME,
            path: `/Syntax Tree [${fileName}]`,
            query: encodeURIComponent(sourceUri.toString()),
        });
    }

    static parseSourceUri(uri: vscode.Uri): vscode.Uri | undefined {
        if (uri.scheme !== SyntaxTreeProvider.SCHEME || !uri.query) {
            return undefined;
        }

        try {
            return vscode.Uri.parse(decodeURIComponent(uri.query));
        } catch {
            return undefined;
        }
    }

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        const sourceUri = SyntaxTreeProvider.parseSourceUri(uri);
        if (!sourceUri) {
            return t('// Invalid syntax tree document.');
        }

        try {
            const params: SyntaxTreeParams = {
                uri: sourceUri.toString(),
            };
            const result = await this.client.sendRequest<SyntaxTreeResponse>('emmy/syntaxTree', params, token);
            const content = typeof result === 'string' ? result : result?.content;

            if (typeof content === 'string') {
                return content || t('// The language server returned an empty syntax tree.');
            }

            return t('// The language server did not return syntax tree content.');
        } catch (error) {
            if (token.isCancellationRequested) {
                return '';
            }

            const message = error instanceof Error ? error.message : String(error);
            return `${t('// Failed to request syntax tree.')}\n// ${message}`;
        }
    }

    refresh(sourceUri: vscode.Uri): void {
        this.onDidChangeEmitter.fire(SyntaxTreeProvider.createUri(sourceUri));
    }

    dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

export class SyntaxTreeManager implements vscode.Disposable {
    private readonly provider: SyntaxTreeProvider;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly refreshTimers = new Map<string, NodeJS.Timeout>();

    constructor(client: LanguageClient) {
        this.provider = new SyntaxTreeProvider(client);
        this.disposables.push(
            vscode.workspace.registerTextDocumentContentProvider(SyntaxTreeProvider.SCHEME, this.provider),
            vscode.workspace.onDidChangeTextDocument((event) => {
                const isSyntaxTreeDocument = event.document.uri.scheme === SyntaxTreeProvider.SCHEME;
                if (isSyntaxTreeDocument || !this.isWatchingDocument(event.document.uri)) {
                    return;
                }

                this.scheduleRefresh(event.document.uri);
            }),
            vscode.window.onDidChangeVisibleTextEditors((editors) => {
                for (const editor of editors) {
                    const sourceUri = SyntaxTreeProvider.parseSourceUri(editor.document.uri);
                    if (sourceUri) {
                        this.provider.refresh(sourceUri);
                    }
                }
            }),
        );
    }

    async show(sourceUri?: vscode.Uri): Promise<void> {
        const activeDocument = vscode.window.activeTextEditor?.document;
        const targetUri = sourceUri
            ?? (activeDocument ? SyntaxTreeProvider.parseSourceUri(activeDocument.uri) ?? activeDocument.uri : undefined);

        if (!targetUri) {
            return;
        }

        if (targetUri.scheme !== 'file') {
            return;
        }

        const targetDocument = vscode.workspace.textDocuments.find(
            (document) => document.uri.toString() === targetUri.toString(),
        );
        if (targetDocument && !isLuaDocument(targetDocument)) {
            return;
        }

        const syntaxTreeUri = SyntaxTreeProvider.createUri(targetUri);

        try {
            const document = await vscode.workspace.openTextDocument(syntaxTreeUri);
            await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false,
                preserveFocus: false,
            });
            this.provider.refresh(targetUri);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(t('Cannot show syntax tree: {0}', message));
        }
    }

    dispose(): void {
        for (const timer of this.refreshTimers.values()) {
            clearTimeout(timer);
        }

        this.refreshTimers.clear();
        this.provider.dispose();
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.length = 0;
    }

    private scheduleRefresh(sourceUri: vscode.Uri): void {
        const key = sourceUri.toString();
        const timer = this.refreshTimers.get(key);
        if (timer) {
            clearTimeout(timer);
        }

        this.refreshTimers.set(key, setTimeout(() => {
            this.refreshTimers.delete(key);
            this.provider.refresh(sourceUri);
        }, 300));
    }

    private isWatchingDocument(sourceUri: vscode.Uri): boolean {
        const sourceKey = sourceUri.toString();
        return vscode.window.visibleTextEditors.some((editor) => {
            const visibleSourceUri = SyntaxTreeProvider.parseSourceUri(editor.document.uri);
            return visibleSourceUri?.toString() === sourceKey;
        });
    }
}
