import * as vscode from 'vscode';

export const EXTENSION_NAME = 'MewLua';
export const LANGUAGE_ID = 'lua';
export const LANGUAGE_CLIENT_NAME = `${EXTENSION_NAME} Language Server`;

export type LuaDocument = vscode.TextDocument & { languageId: typeof LANGUAGE_ID };

export function commandName(name: string): string {
    return `mewlua.${name}`;
}

export function isLuaDocument(document: vscode.TextDocument): document is LuaDocument {
    return document.uri.scheme === 'file' && document.languageId === LANGUAGE_ID;
}
