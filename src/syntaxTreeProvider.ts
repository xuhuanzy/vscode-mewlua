import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

import { type SyntaxTreeParams, type SyntaxTreeResponse } from './lspExtension';
import { isLuaDocument } from './util';

type LanguageClientGetter = () => LanguageClient | undefined;

export class SyntaxTreeProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    static readonly SCHEME = 'emmylua-syntax-tree';

    private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this.onDidChangeEmitter.event;

    constructor(private readonly getLanguageClient: LanguageClientGetter) { }

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
            return '// Invalid syntax tree document.';
        }

        const client = this.getLanguageClient();
        if (!client?.isRunning()) {
            return '// MewLua language server is not running.';
        }

        try {
            const params: SyntaxTreeParams = {
                uri: sourceUri.toString(),
            };
            const result = await client.sendRequest<SyntaxTreeResponse>('emmy/syntaxTree', params, token);

            if (typeof result === 'string') {
                return result || '// The language server returned an empty syntax tree.';
            }

            if (result && typeof result.content === 'string') {
                return result.content || '// The language server returned an empty syntax tree.';
            }

            return '// The language server did not return syntax tree content.';
        } catch (error) {
            if (token.isCancellationRequested) {
                return '';
            }

            const message = error instanceof Error ? error.message : String(error);
            return `// Failed to request syntax tree.\n// ${message}`;
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

    constructor(getLanguageClient: LanguageClientGetter) {
        this.provider = new SyntaxTreeProvider(getLanguageClient);
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
            void vscode.window.showWarningMessage('Open a Lua file before showing the syntax tree.');
            return;
        }

        if (targetUri.scheme !== 'file') {
            void vscode.window.showWarningMessage('Syntax tree view only supports file-backed Lua documents.');
            return;
        }

        const targetDocument = vscode.workspace.textDocuments.find(
            (document) => document.uri.toString() === targetUri.toString(),
        );
        if (targetDocument && !isLuaDocument(targetDocument)) {
            void vscode.window.showWarningMessage('Syntax tree view only supports Lua documents.');
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
            void vscode.window.showErrorMessage(`Cannot show syntax tree: ${message}`);
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
